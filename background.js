// background.js v21 - smart backoff + cooldown resume
let job = null;
const BASE_DELAY = 1800;

function pace() {
  const extra = Math.min((job ? job.doneCount : 0) * 150, 4000);
  return BASE_DELAY + extra + Math.floor(Math.random() * 1500);
}

function note(msg) {
  if (!job) return;
  chrome.tabs.sendMessage(job.requester, {
    type: "FS_PROGRESS", scanId: job.scanId,
    done: job.doneCount, total: job.total,
    collected: job.results.length, note: msg || null,
  }, () => { void chrome.runtime.lastError; });
}

function progress() { note(null); }

function finishJob(stoppedEarly) {
  if (!job) return;
  const req = job.requester, id = job.scanId, res = job.results;
  job = null;
  chrome.tabs.sendMessage(req, {
    type: "FS_SCAN_DONE", scanId: id, products: res, stoppedEarly: !!stoppedEarly,
  }, () => { void chrome.runtime.lastError; });
}

function openNext() {
  if (!job) return;
  if (!job.urls.length) { finishJob(false); return; }
  const url = job.urls.shift();
  job.currentUrl = url;
  chrome.tabs.create({ url: url, active: false }, (tab) => {
    if (chrome.runtime.lastError || !tab || !job) { setTimeout(openNext, 1000); return; }
    job.activeTab = tab.id;
    job.tabTimer = setTimeout(() => {
      if (job && job.activeTab === tab.id) {
        job.activeTab = null;
        chrome.tabs.remove(tab.id, () => { void chrome.runtime.lastError; });
        handleEmpty(false, false); // timeout = khali dhora hobe
      }
    }, 30000);
  });
}

function handleEmpty(blocked, noResults) {
  if (!job) return;
  const url = job.currentUrl;

  // Sotti last page → normal finish
  if (noResults) { job.doneCount++; progress(); finishJob(false); return; }

  job.urlRetries = job.urlRetries || {};
  const attempt = job.urlRetries[url] || 0;

  // 🔁 0 products → wait kore retry (3 bar)
  if (attempt < 3) {
    job.urlRetries[url] = attempt + 1;
    const delays = [8000, 20000, 45000];
    const d = delays[attempt] + (blocked ? 15000 : 0);
    note("⏳ 0 products — retry " + (attempt + 1) + "/3 after " + Math.round(d / 1000) + "s");
    job.urls.unshift(url);
    setTimeout(openNext, d);
    return;
  }

  // Retry sesh → empty streak count
  job.doneCount++;
  job.emptyStreak++;

  // 😴 60s BREAK → abar start (2 bar break nite parbe)
  if (job.emptyStreak === 1 && job.cooldowns < 2) {
    job.cooldowns++;
    note("😴 Site block korche — 60s BREAK, tarpor abar start hobe");
    setTimeout(openNext, 60000);
    return;
  }

  // 3 consecutive dead page → thami
  if (job.emptyStreak >= 3) { progress(); finishJob(true); return; }

  progress();
  setTimeout(openNext, pace());
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FS_WORKER_READY") {
    const isWorker = !!(job && sender.tab && sender.tab.id === job.activeTab);
    sendResponse({ isWorker: isWorker, scanId: job ? job.scanId : null });
    return false;
  }

  if (msg.type === "FS_SCAN_START") {
    if (job) finishJob(false);
    job = {
      scanId: msg.scanId,
      urls: (msg.urls || []).slice(),
      results: [],
      requester: sender.tab.id,
      total: (msg.urls || []).length,
      doneCount: 0,
      activeTab: null,
      currentUrl: null,
      tabTimer: null,
      emptyStreak: 0,
      cooldowns: 0,
      urlRetries: {},
    };
    openNext();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "FS_WORKER_DONE") {
    if (job && msg.scanId === job.scanId && sender.tab && sender.tab.id === job.activeTab) {
      clearTimeout(job.tabTimer);
      const prods = msg.products || [];
      job.activeTab = null;
      chrome.tabs.remove(sender.tab.id, () => { void chrome.runtime.lastError; });

      if (prods.length) {
        job.doneCount++;
        job.emptyStreak = 0;
        job.results = job.results.concat(prods);
        progress();
        setTimeout(openNext, pace());
      } else {
        handleEmpty(!!msg.blocked, !!msg.noResults);
      }
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "FS_SCAN_ABORT") {
    if (job && msg.scanId === job.scanId) {
      if (job.tabTimer) clearTimeout(job.tabTimer);
      if (job.activeTab) chrome.tabs.remove(job.activeTab, () => { void chrome.runtime.lastError; });
      finishJob(true);
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
