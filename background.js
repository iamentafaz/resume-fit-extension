const DEFAULT_SETTINGS = {
  endpoint: 'http://localhost:11434/api/chat',
  model: 'llama3',
  apiStyle: 'ollama', // 'ollama' | 'openai'
  timeoutSec: 120
};

const MAX_OUTPUT_TOKENS = 700; // keeps generation bounded so slow/local models still return in reasonable time

let currentController = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ANALYZE') {
    handleAnalyze(msg.tabId)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep the message channel open for the async response
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
});

async function getSettings() {
  const stored = await chrome.storage.local.get(['endpoint', 'model', 'apiStyle', 'timeoutSec']);
  return { ...DEFAULT_SETTINGS, ...stored };
}

// Injected into the active page — runs in page context, not extension context.
function extractJDFromPage() {
  function fromJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const type = item['@type'];
          const isJobPosting = type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
          if (isJobPosting) {
            const title = item.title || '';
            const desc = item.description || '';
            const plain = String(desc).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            return { title, text: plain, source: 'json-ld' };
          }
        }
      } catch (e) {
        // not valid JSON-LD, skip
      }
    }
    return null;
  }

  function fromHeuristic() {
    const candidates = Array.from(document.querySelectorAll('main, article, [role="main"]'));
    let best = null;
    let bestLen = 0;
    for (const el of candidates) {
      const len = (el.innerText || '').length;
      if (len > bestLen) {
        bestLen = len;
        best = el;
      }
    }
    const el = best || document.body;
    return { title: document.title, text: (el.innerText || '').replace(/\s+/g, ' ').trim(), source: 'heuristic' };
  }

  const jsonLd = fromJsonLd();
  if (jsonLd && jsonLd.text.length > 200) return jsonLd;

  const selection = window.getSelection ? window.getSelection().toString().trim() : '';
  if (selection.length > 200) return { title: document.title, text: selection, source: 'selection' };

  return fromHeuristic();
}

async function handleAnalyze(tabId) {
  const [{ result: jd }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractJDFromPage
  });

  if (!jd || !jd.text || jd.text.length < 50) {
    return { error: 'Could not find a job description on this page. Try selecting the JD text and re-running.' };
  }

  const { resume } = await chrome.storage.local.get(['resume']);
  if (!resume || resume.trim().length < 20) {
    return { error: 'No resume saved yet. Add it in the Resume tab first.' };
  }

  const settings = await getSettings();
  const result = await callLocalLLM(settings, jd.text, resume);

  const tab = await chrome.tabs.get(tabId);
  const record = { ...result, jdTitle: jd.title, url: tab.url, timestamp: Date.now() };

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

async function callLocalLLM(settings, jdText, resumeText) {
  const { system, user } = buildPrompt(jdText, resumeText);
  const isOpenAiStyle = settings.apiStyle === 'openai';

  const body = isOpenAiStyle
    ? {
        model: settings.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.2,
        max_tokens: MAX_OUTPUT_TOKENS
      }
    : {
        model: settings.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        stream: false,
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
    if (e.name === 'AbortError') {
      throw new Error(
        `The local model didn't respond within ${timeoutMs / 1000}s. It may still be loading into memory, or your hardware is too slow for this prompt length. Try again (the model may already be warm), pick a smaller/faster model, or raise the timeout in Settings.`
      );
    }
    throw new Error(`Couldn't reach ${settings.endpoint}. Is your local LLM server running, and does it allow requests from this extension (CORS)?`);
  } finally {
    clearTimeout(timeoutId);
    currentController = null;
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Local LLM server returned ${res.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}. Check the model name and endpoint in Settings.`);
  }

  const data = await res.json();
  const content = isOpenAiStyle ? data?.choices?.[0]?.message?.content : data?.message?.content;

  const parsed = extractJson(content || '');
  if (!parsed) {
    throw new Error('The model responded but not with valid JSON. Try a different model, lower the temperature, or re-run — smaller local models are less consistent at following format instructions.');
  }
  return parsed;
}

async function testConnection(settings) {
  await callLocalLLM(settings, 'Test job description: requires basic communication skills.', 'Test resume: has basic communication skills.');
  return { ok: true };
}
