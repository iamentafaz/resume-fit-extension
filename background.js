const DEFAULT_SETTINGS = {
  endpoint: 'http://localhost:11434/api/chat',
  model: 'llama3',
  apiStyle: 'ollama', // 'ollama' | 'openai'
  timeoutSec: 120
};

const MAX_OUTPUT_TOKENS = 700;
const MAX_RETRY_ATTEMPTS = 1; // one retry with a fix-up prompt

let currentController = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ANALYZE') {
    handleAnalyze(msg.tabId)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'TEST_CONNECTION') {
    testConnection(msg.settings)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'CANCEL') {
    if (currentController) currentController.abort();
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'DELETE_HISTORY_ITEM') {
    deleteHistoryItem(msg.url)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'CLEAR_HISTORY') {
    chrome.storage.local.set({ history: {} }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function getSettings() {
  const stored = await chrome.storage.local.get(['endpoint', 'model', 'apiStyle', 'timeoutSec']);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function deleteHistoryItem(url) {
  const { history = {} } = await chrome.storage.local.get(['history']);
  delete history[url];
  await chrome.storage.local.set({ history });
  return { ok: true };
}

async function handleAnalyze(tabId) {
  const injectionResults = await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-script.js']
  });

  const jdResult = injectionResults?.[0]?.result;

  if (!jdResult || !jdResult.text || jdResult.text.length < 50) {
    return {
      error:
        'Could not find a job description on this page. Try selecting the JD text and re-running.'
    };
  }

  const { resume, activeResumeId = 'default', resumes = {} } =
    await chrome.storage.local.get(['resume', 'activeResumeId', 'resumes']);

  // Support both legacy single-resume and new multi-resume storage
  let resumeText = '';
  if (Object.keys(resumes).length > 0 && resumes[activeResumeId]) {
    resumeText = resumes[activeResumeId].text;
  } else if (resume) {
    resumeText = resume;
  }

  if (!resumeText || resumeText.trim().length < 20) {
    return { error: 'No resume saved yet. Add it in the Resume tab first.' };
  }

  const settings = await getSettings();
  const result = await callLocalLLMWithRetry(settings, jdResult.text, resumeText);

  const tab = await chrome.tabs.get(tabId);
  const record = { ...result, jdTitle: jdResult.title, url: tab.url, timestamp: Date.now() };

  const { history = {} } = await chrome.storage.local.get(['history']);
  history[tab.url] = record;
  await chrome.storage.local.set({ history });

  return record;
}

function buildPrompt(jdText, resumeText) {
  const system = `You are a precise, honest career-fit evaluator. Compare the resume against the job description and respond with ONLY a JSON object (no markdown, no commentary) with exactly these fields:
{
  "score": <integer 0-100>,
  "verdict": <one of "Strong fit", "Good fit", "Partial fit", "Weak fit">,
  "matches": [<strings - qualifications or experience that clearly match>],
  "gaps": [<strings - requirements the resume does not clearly cover>],
  "suggestions": [<strings - concrete edits or talking points to improve fit>]
}
Be honest about gaps rather than generous. Keep each list to 3-6 items. Do not include any text before or after the JSON object.`;

  const user = `JOB DESCRIPTION:\n${jdText.slice(0, 6000)}\n\nRESUME:\n${resumeText.slice(0, 6000)}`;
  return { system, user };
}

function buildRetryPrompt(originalResponse) {
  return `Your previous response was not valid JSON. Here is what you returned:\n\n${originalResponse.slice(0, 2000)}\n\nPlease return ONLY a valid JSON object with these fields: score (integer 0-100), verdict (string), matches (array of strings), gaps (array of strings), suggestions (array of strings). No markdown, no commentary, just the JSON.`;
}

function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    // fall through to substring extraction
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      return null;
    }
  }
  return null;
}

async function callLocalLLMWithRetry(settings, jdText, resumeText) {
  const { system, user } = buildPrompt(jdText, resumeText);
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];

  const rawContent = await callLocalLLM(settings, messages);
  const parsed = extractJson(rawContent || '');
  if (parsed) return parsed;

  // Retry: ask the model to fix its output
  messages.push({ role: 'assistant', content: rawContent || '' });
  messages.push({ role: 'user', content: buildRetryPrompt(rawContent || '') });

  const retryContent = await callLocalLLM(settings, messages);
  const retryParsed = extractJson(retryContent || '');
  if (retryParsed) return retryParsed;

  throw new Error(
    'The model responded but not with valid JSON even after a retry. Try a different model, lower the temperature, or re-run — smaller local models are less consistent at following format instructions.'
  );
}

async function callLocalLLM(settings, messages) {
  const isOpenAiStyle = settings.apiStyle === 'openai';

  const body = isOpenAiStyle
    ? {
        model: settings.model,
        messages,
        temperature: 0.2,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: true
      }
    : {
        model: settings.model,
        messages,
        stream: true,
        options: { temperature: 0.2, num_predict: MAX_OUTPUT_TOKENS }
      };

  const timeoutMs = (Number(settings.timeoutSec) || DEFAULT_SETTINGS.timeoutSec) * 1000;
  const controller = new AbortController();
  currentController = controller;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(settings.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timeoutId);
    currentController = null;
    if (e.name === 'AbortError') {
      throw new Error(
        `The local model didn't respond within ${timeoutMs / 1000}s. It may still be loading into memory, or your hardware is too slow for this prompt length. Try again (the model may already be warm), pick a smaller/faster model, or raise the timeout in Settings.`
      );
    }
    throw new Error(
      `Couldn't reach ${settings.endpoint}. Is your local LLM server running, and does it allow requests from this extension (CORS)?`
    );
  }

  if (!res.ok) {
    currentController = null;
    const bodyText = await res.text().catch(() => '');
    throw new Error(
      `Local LLM server returned ${res.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}. Check the model name and endpoint in Settings.`
    );
  }

  // Stream the response
  let fullContent = '';
  try {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;

        const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
        try {
          const chunk = JSON.parse(jsonStr);
          const token = isOpenAiStyle
            ? chunk?.choices?.[0]?.delta?.content || ''
            : chunk?.message?.content || '';
          fullContent += token;

          // Notify popup of streaming progress
          chrome.runtime.sendMessage({ type: 'STREAM_TOKEN', content: fullContent }).catch(() => {});
        } catch (e) {
          // not a JSON line (e.g. empty line), skip
        }
      }
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('Analysis was cancelled.');
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
    currentController = null;
  }

  // For Ollama: if streaming produced no content, the response may have been
  // non-streaming after all (some older Ollama versions). Fall back to reading
  // the full body, but since we already consumed the stream, fullContent should
  // have the data. If empty, it means the model returned nothing.
  if (!fullContent.trim()) {
    throw new Error('The model returned an empty response. Try a different model or re-run.');
  }

  return fullContent;
}

async function testConnection(settings) {
  const messages = [
    { role: 'system', content: 'Respond with exactly: {"ok":true}' },
    { role: 'user', content: 'Test' }
  ];
  await callLocalLLM(settings, messages);
  return { ok: true };
}
