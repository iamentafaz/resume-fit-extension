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
  cancelBtn: document.getElementById('cancelBtn'),
  errorState: document.getElementById('errorState'),
  resultState: document.getElementById('resultState'),

  gaugeFill: document.getElementById('gaugeFill'),
  gaugeScore: document.getElementById('gaugeScore'),
  verdictPill: document.getElementById('verdictPill'),
  jdTitle: document.getElementById('jdTitle'),
  matchesList: document.getElementById('matchesList'),
  gapsList: document.getElementById('gapsList'),
  suggestionsList: document.getElementById('suggestionsList'),
  timestamp: document.getElementById('timestamp'),

  resumeText: document.getElementById('resumeText'),
  saveResumeBtn: document.getElementById('saveResumeBtn'),
  resumeSaveStatus: document.getElementById('resumeSaveStatus'),

  apiStyle: document.getElementById('apiStyle'),
  endpoint: document.getElementById('endpoint'),
  model: document.getElementById('model'),
  timeoutSec: document.getElementById('timeoutSec'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  testConnectionBtn: document.getElementById('testConnectionBtn'),
  settingsSaveStatus: document.getElementById('settingsSaveStatus')
};

function switchTab(name) {
  el.tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  el.panels.forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
}

el.tabs.forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
el.settingsShortcut.addEventListener('click', () => switchTab('settings'));

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

let elapsedTimer = null;
let elapsedSeconds = 0;

function startElapsedTimer() {
  elapsedSeconds = 0;
  el.loadingMessage.textContent = 'Reading the page and asking your local model…';
  el.loadingElapsed.textContent = '0s';
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

function renderResult(record) {
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

let userCancelled = false;

el.analyzeBtn.addEventListener('click', async () => {
  userCancelled = false;
  setLoading(true);
  try {
    const tab = await getActiveTab();
    if (!tab) throw new Error('No active tab found.');
    const response = await chrome.runtime.sendMessage({ type: 'ANALYZE', tabId: tab.id });
    if (response.error) {
      showError(userCancelled ? 'Cancelled.' : response.error);
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

async function loadResume() {
  const { resume = '' } = await chrome.storage.local.get(['resume']);
  el.resumeText.value = resume;
}

el.saveResumeBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ resume: el.resumeText.value });
  el.resumeSaveStatus.textContent = 'Saved';
  setTimeout(() => (el.resumeSaveStatus.textContent = ''), 1800);
});

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

function readSettingsFromForm() {
  const timeoutSec = parseInt(el.timeoutSec.value, 10);
  return {
    endpoint: el.endpoint.value.trim(),
    model: el.model.value.trim(),
    apiStyle: el.apiStyle.value,
    timeoutSec: Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec : 120
  };
}

el.saveSettingsBtn.addEventListener('click', async () => {
  await chrome.storage.local.set(readSettingsFromForm());
  el.settingsSaveStatus.textContent = 'Saved';
  el.settingsSaveStatus.style.color = 'var(--good)';
  setTimeout(() => (el.settingsSaveStatus.textContent = ''), 1800);
});

el.testConnectionBtn.addEventListener('click', async () => {
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

(async function init() {
  await Promise.all([loadResume(), loadSettings(), loadExistingResultForTab()]);
})();
