const GAUGE_CIRCUMFERENCE = 326.7;

const el = {
  tabs: document.querySelectorAll('.tab'),
  panels: document.querySelectorAll('.panel'),
  settingsShortcut: document.getElementById('settingsShortcut'),

  analyzeBtn: document.getElementById('analyzeBtn'),
  analyzeHint: document.getElementById('analyzeHint'),
  loadingState: document.getElementById('loadingState'),
  loadingMessage: document.getElementById('loadingMessage'),
  loadingElapsed: document.getElementById('loadingElapsed'),
  streamPreview: document.getElementById('streamPreview'),
  cancelBtn: document.getElementById('cancelBtn'),
  errorState: document.getElementById('errorState'),
  resultState: document.getElementById('resultState'),

  copyResultBtn: document.getElementById('copyResultBtn'),
  copyLabel: document.getElementById('copyLabel'),
  gaugeFill: document.getElementById('gaugeFill'),
  gaugeScore: document.getElementById('gaugeScore'),
  verdictPill: document.getElementById('verdictPill'),
  jdTitle: document.getElementById('jdTitle'),
  matchesList: document.getElementById('matchesList'),
  gapsList: document.getElementById('gapsList'),
  suggestionsList: document.getElementById('suggestionsList'),
  timestamp: document.getElementById('timestamp'),

  historyEmpty: document.getElementById('historyEmpty'),
  historyList: document.getElementById('historyList'),
  historyActions: document.getElementById('historyActions'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),

  resumeSelect: document.getElementById('resumeSelect'),
  addResumeBtn: document.getElementById('addResumeBtn'),
  deleteResumeBtn: document.getElementById('deleteResumeBtn'),
  resumeText: document.getElementById('resumeText'),
  resumeFileInput: document.getElementById('resumeFileInput'),
  saveResumeBtn: document.getElementById('saveResumeBtn'),
  resumeSaveStatus: document.getElementById('resumeSaveStatus'),

  apiStyle: document.getElementById('apiStyle'),
  endpoint: document.getElementById('endpoint'),
  endpointError: document.getElementById('endpointError'),
  model: document.getElementById('model'),
  timeoutSec: document.getElementById('timeoutSec'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  testConnectionBtn: document.getElementById('testConnectionBtn'),
  settingsSaveStatus: document.getElementById('settingsSaveStatus')
};

// ── Tabs ──

function switchTab(name) {
  el.tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  el.panels.forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
  if (name === 'history') loadHistory();
}

el.tabs.forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
el.settingsShortcut.addEventListener('click', () => switchTab('settings'));

// ── Helpers ──

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// ── Streaming listener ──

let lastStreamContent = '';
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STREAM_TOKEN') {
    lastStreamContent = msg.content || '';
    if (el.streamPreview) {
      el.streamPreview.classList.remove('hidden');
      // Show last 200 chars of the stream
      const preview = lastStreamContent.length > 200
        ? '…' + lastStreamContent.slice(-200)
        : lastStreamContent;
      el.streamPreview.textContent = preview;
    }
  }
});

// ── Loading / elapsed timer ──

let elapsedTimer = null;
let elapsedSeconds = 0;

function startElapsedTimer() {
  elapsedSeconds = 0;
  el.loadingMessage.textContent = 'Reading the page and asking your local model…';
  el.loadingElapsed.textContent = '0s';
  el.streamPreview.textContent = '';
  el.streamPreview.classList.add('hidden');
  lastStreamContent = '';
  elapsedTimer = setInterval(() => {
    elapsedSeconds += 1;
    el.loadingElapsed.textContent = `${elapsedSeconds}s`;
    if (elapsedSeconds === 15) {
      el.loadingMessage.textContent = 'Still working — local models can take a while, especially on CPU.';
    } else if (elapsedSeconds === 45) {
      el.loadingMessage.textContent = 'Still going. If this feels stuck, try Cancel and check your model/hardware.';
    }
  }, 1000);
}

function stopElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function setLoading(isLoading) {
  el.analyzeBtn.disabled = isLoading;
  el.loadingState.classList.toggle('hidden', !isLoading);
  if (isLoading) {
    el.errorState.classList.add('hidden');
    el.resultState.classList.add('hidden');
    startElapsedTimer();
  } else {
    stopElapsedTimer();
  }
}

function showError(message) {
  el.errorState.textContent = message;
  el.errorState.classList.remove('hidden');
  el.resultState.classList.add('hidden');
}

// ── Result rendering ──

function verdictClass(score) {
  if (score >= 75) return 'good';
  if (score >= 50) return 'warn';
  return 'bad';
}

function gaugeColor(score) {
  if (score >= 75) return 'var(--good)';
  if (score >= 50) return 'var(--warn)';
  return 'var(--bad)';
}

function renderList(ulEl, items) {
  ulEl.innerHTML = '';
  (items || []).forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    ulEl.appendChild(li);
  });
}

let lastRenderedResult = null;

function renderResult(record) {
  lastRenderedResult = record;
  el.errorState.classList.add('hidden');
  el.resultState.classList.remove('hidden');

  const score = Math.max(0, Math.min(100, Number(record.score) || 0));
  const offset = GAUGE_CIRCUMFERENCE - (GAUGE_CIRCUMFERENCE * score) / 100;

  el.gaugeFill.style.strokeDashoffset = String(offset);
  el.gaugeFill.style.stroke = gaugeColor(score);
  el.gaugeScore.textContent = String(score);

  el.verdictPill.textContent = record.verdict || '--';
  el.verdictPill.className = `verdict-pill ${verdictClass(score)}`;
  el.jdTitle.textContent = record.jdTitle || '';

  renderList(el.matchesList, record.matches);
  renderList(el.gapsList, record.gaps);
  renderList(el.suggestionsList, record.suggestions);

  el.timestamp.textContent = record.timestamp
    ? `Analyzed ${new Date(record.timestamp).toLocaleString()}`
    : '';
}

async function loadExistingResultForTab() {
  const tab = await getActiveTab();
  if (!tab || !tab.url) return;
  const { history = {} } = await chrome.storage.local.get(['history']);
  const record = history[tab.url];
  if (record) renderResult(record);
}

// ── Copy results ──

function formatResultAsText(record) {
  if (!record) return '';
  const lines = [];
  lines.push(`Fit Score: ${record.score}/100 — ${record.verdict}`);
  if (record.jdTitle) lines.push(`Job: ${record.jdTitle}`);
  lines.push('');
  if (record.matches?.length) {
    lines.push('Matched Strengths:');
    record.matches.forEach((m) => lines.push(`  + ${m}`));
    lines.push('');
  }
  if (record.gaps?.length) {
    lines.push('Gaps:');
    record.gaps.forEach((g) => lines.push(`  - ${g}`));
    lines.push('');
  }
  if (record.suggestions?.length) {
    lines.push('Suggestions:');
    record.suggestions.forEach((s) => lines.push(`  * ${s}`));
  }
  return lines.join('\n');
}

el.copyResultBtn.addEventListener('click', async () => {
  const text = formatResultAsText(lastRenderedResult);
  if (!text) return;
  await navigator.clipboard.writeText(text);
  el.copyLabel.textContent = 'Copied!';
  setTimeout(() => (el.copyLabel.textContent = 'Copy'), 1500);
});

// ── Analyze ──

let userCancelled = false;

el.analyzeBtn.addEventListener('click', async () => {
  userCancelled = false;
  setLoading(true);
  try {
    const tab = await getActiveTab();
    if (!tab) throw new Error('No active tab found.');
    const response = await chrome.runtime.sendMessage({ type: 'ANALYZE', tabId: tab.id });
    if (!response || response.error) {
      showError(userCancelled ? 'Cancelled.' : (response?.error || 'No response from background worker. Try again.'));
    } else {
      renderResult(response);
    }
  } catch (e) {
    showError(userCancelled ? 'Cancelled.' : e.message || 'Something went wrong.');
  } finally {
    setLoading(false);
  }
});

el.cancelBtn.addEventListener('click', async () => {
  userCancelled = true;
  await chrome.runtime.sendMessage({ type: 'CANCEL' });
});

// ── History ──

async function loadHistory() {
  const { history = {} } = await chrome.storage.local.get(['history']);
  const entries = Object.values(history).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (entries.length === 0) {
    el.historyEmpty.classList.remove('hidden');
    el.historyList.classList.add('hidden');
    el.historyActions.classList.add('hidden');
    return;
  }

  el.historyEmpty.classList.add('hidden');
  el.historyList.classList.remove('hidden');
  el.historyActions.classList.remove('hidden');

  el.historyList.innerHTML = '';
  for (const record of entries) {
    const item = document.createElement('div');
    item.className = 'history-item';

    const score = Math.max(0, Math.min(100, Number(record.score) || 0));
    const cls = verdictClass(score);

    item.innerHTML = `
      <div class="history-item-header">
        <span class="history-score ${cls}">${score}</span>
        <span class="history-title">${escapeHtml(record.jdTitle || 'Untitled')}</span>
        <button class="icon-btn history-delete" data-url="${escapeAttr(record.url)}" title="Delete">
          <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z"/>
          </svg>
        </button>
      </div>
      <div class="history-meta">
        <span>${record.verdict || '--'}</span>
        <span>${record.timestamp ? new Date(record.timestamp).toLocaleDateString() : ''}</span>
      </div>
    `;

    // Click to view the result
    item.addEventListener('click', (e) => {
      if (e.target.closest('.history-delete')) return;
      switchTab('analyze');
      renderResult(record);
    });

    // Delete button
    const deleteBtn = item.querySelector('.history-delete');
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await chrome.runtime.sendMessage({ type: 'DELETE_HISTORY_ITEM', url: record.url });
      loadHistory();
    });

    el.historyList.appendChild(item);
  }
}

el.clearHistoryBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
  loadHistory();
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// ── Resume (multiple resumes) ──

async function loadResumes() {
  const { resume = '', resumes = {}, activeResumeId = 'default' } =
    await chrome.storage.local.get(['resume', 'resumes', 'activeResumeId']);

  // Migrate legacy single resume to multi-resume format
  if (Object.keys(resumes).length === 0 && resume) {
    resumes['default'] = { name: 'Default', text: resume };
    await chrome.storage.local.set({ resumes, activeResumeId: 'default' });
  } else if (Object.keys(resumes).length === 0) {
    resumes['default'] = { name: 'Default', text: '' };
    await chrome.storage.local.set({ resumes, activeResumeId: 'default' });
  }

  populateResumeSelect(resumes, activeResumeId);
  el.resumeText.value = resumes[activeResumeId]?.text || '';
}

function populateResumeSelect(resumes, activeId) {
  el.resumeSelect.innerHTML = '';
  for (const [id, data] of Object.entries(resumes)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = data.name;
    if (id === activeId) opt.selected = true;
    el.resumeSelect.appendChild(opt);
  }
}

el.resumeSelect.addEventListener('change', async () => {
  const id = el.resumeSelect.value;
  await chrome.storage.local.set({ activeResumeId: id });
  const { resumes = {} } = await chrome.storage.local.get(['resumes']);
  el.resumeText.value = resumes[id]?.text || '';
});

el.addResumeBtn.addEventListener('click', async () => {
  const name = prompt('Name for the new resume:');
  if (!name || !name.trim()) return;
  const id = 'resume_' + Date.now();
  const { resumes = {} } = await chrome.storage.local.get(['resumes']);
  resumes[id] = { name: name.trim(), text: '' };
  await chrome.storage.local.set({ resumes, activeResumeId: id });
  populateResumeSelect(resumes, id);
  el.resumeText.value = '';
});

el.deleteResumeBtn.addEventListener('click', async () => {
  const { resumes = {}, activeResumeId } = await chrome.storage.local.get([
    'resumes',
    'activeResumeId'
  ]);
  const keys = Object.keys(resumes);
  if (keys.length <= 1) {
    alert('You must have at least one resume.');
    return;
  }
  if (!confirm(`Delete "${resumes[activeResumeId]?.name}"?`)) return;
  delete resumes[activeResumeId];
  const newActiveId = Object.keys(resumes)[0];
  await chrome.storage.local.set({ resumes, activeResumeId: newActiveId });
  populateResumeSelect(resumes, newActiveId);
  el.resumeText.value = resumes[newActiveId]?.text || '';
});

el.saveResumeBtn.addEventListener('click', async () => {
  const { resumes = {}, activeResumeId = 'default' } = await chrome.storage.local.get([
    'resumes',
    'activeResumeId'
  ]);
  if (!resumes[activeResumeId]) resumes[activeResumeId] = { name: 'Default', text: '' };
  resumes[activeResumeId].text = el.resumeText.value;
  await chrome.storage.local.set({ resumes });
  el.resumeSaveStatus.textContent = 'Saved';
  setTimeout(() => (el.resumeSaveStatus.textContent = ''), 1800);
});

// ── Resume file upload ──

el.resumeFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    el.resumeText.value = reader.result;
    el.resumeSaveStatus.textContent = 'File loaded — click Save';
    el.resumeSaveStatus.style.color = 'var(--warn)';
    setTimeout(() => {
      el.resumeSaveStatus.textContent = '';
      el.resumeSaveStatus.style.color = '';
    }, 3000);
  };
  reader.readAsText(file);
  e.target.value = ''; // reset so same file can be re-selected
});

// ── Settings ──

async function loadSettings() {
  const {
    endpoint = 'http://localhost:11434/api/chat',
    model = 'llama3',
    apiStyle = 'ollama',
    timeoutSec = 120
  } = await chrome.storage.local.get(['endpoint', 'model', 'apiStyle', 'timeoutSec']);
  el.endpoint.value = endpoint;
  el.model.value = model;
  el.apiStyle.value = apiStyle;
  el.timeoutSec.value = timeoutSec;
}

el.apiStyle.addEventListener('change', () => {
  if (el.apiStyle.value === 'openai' && el.endpoint.value.includes('11434')) {
    el.endpoint.value = 'http://localhost:1234/v1/chat/completions';
  }
  if (el.apiStyle.value === 'ollama' && el.endpoint.value.includes('1234')) {
    el.endpoint.value = 'http://localhost:11434/api/chat';
  }
});

function isValidEndpoint(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function readSettingsFromForm() {
  const timeoutSec = parseInt(el.timeoutSec.value, 10);
  return {
    endpoint: el.endpoint.value.trim(),
    model: el.model.value.trim(),
    apiStyle: el.apiStyle.value,
    timeoutSec: Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 120
  };
}

function validateSettings() {
  const endpoint = el.endpoint.value.trim();
  if (!isValidEndpoint(endpoint)) {
    el.endpointError.classList.remove('hidden');
    return false;
  }
  el.endpointError.classList.add('hidden');
  return true;
}

el.endpoint.addEventListener('input', () => {
  if (el.endpoint.value.trim()) validateSettings();
});

el.saveSettingsBtn.addEventListener('click', async () => {
  if (!validateSettings()) return;
  await chrome.storage.local.set(readSettingsFromForm());
  el.settingsSaveStatus.textContent = 'Saved';
  el.settingsSaveStatus.style.color = 'var(--good)';
  setTimeout(() => (el.settingsSaveStatus.textContent = ''), 1800);
});

el.testConnectionBtn.addEventListener('click', async () => {
  if (!validateSettings()) return;
  el.settingsSaveStatus.textContent = 'Testing…';
  el.settingsSaveStatus.style.color = 'var(--text-muted)';
  const settings = readSettingsFromForm();
  const response = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION', settings });
  if (response.error) {
    el.settingsSaveStatus.textContent = response.error;
    el.settingsSaveStatus.style.color = 'var(--bad)';
  } else {
    el.settingsSaveStatus.textContent = 'Connected';
    el.settingsSaveStatus.style.color = 'var(--good)';
  }
});

// ── Init ──

(async function init() {
  await Promise.all([loadResumes(), loadSettings(), loadExistingResultForTab()]);
})();
