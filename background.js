// background.js v20 - delay + retry + auto-stop soho tab scanner
let job = null;
const TAB_DELAY = 1800;

function finishJob(stoppedEarly) {
  if (!job) return;
  const req = job.requester, id = job.scanId, res = job.results;
  job = null;
  chrome.tabs.sendMessage(req, {
    type: "FS_SCAN_DONE", scanId: id, products: res, stoppedEarly: !!stoppedEarly,
  }, () => { void chrome.runtime.lastError; });
}

function progress() {
  if (!job) return;
  chrome.tabs.sendMessage(job.requester, {
    type: "FS_PROGRESS", scanId: job.scanId,
    done: job.doneCount, total: job.total, collected: job.results.length,
  }, () => { if (chrome.runtime.lastError) { finishJob(false); } });
}

function openNext() {
  if (!job) return;
  if (!job.urls.length) { finishJob(false); return; }
  const url = job.urls.shift();
  job.currentUrl = url;
  chrome.tabs.create({ url: url, active: false }, (tab) => {
    if (chrome.runtime.lastError || !tab || !job) { setTimeout(openNext, 800); return; }
    job.activeTab = tab.id;
    job.tabTimer = setTimeout(() => {
      if (job && job.activeTab === tab.id) {
        job.activeTab = null;
        chrome.tabs.remove(tab.id, () => { void chrome.runtime.lastError; });
        job.doneCount++;
        progress();
        setTimeout(openNext, TAB_DELAY);
      }
    }, 30000);
  });
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
      retried: {},
    };
    openNext();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "FS_WORKER_DONE") {
    if (job && msg.scanId === job.scanId && sender.tab && sender.tab.id === job.activeTab) {
      clearTimeout(job.tabTimer);
      const prods = msg.products || [];
      const url = job.currentUrl;
      job.activeTab = null;
      chrome.tabs.remove(sender.tab.id, () => { void chrome.runtime.lastError; });

      if (prods.length === 0 && !job.retried[url] && job.emptyStreak < 2) {
        // Khali page → ekbar retry koro (delay soho)
        job.retried[url] = 1;
        job.urls.unshift(url);
        setTimeout(openNext, TAB_DELAY + 2500);
        sendResponse({ ok: true });
        return false;
      }

      job.doneCount++;
      if (prods.length === 0) {
        job.emptyStreak++;
      } else {
        job.emptyStreak = 0;
        job.results = job.results.concat(prods);
      }

      // Porpor 3 khali page = site block korche → thambo
      if (job.emptyStreak >= 3) {
        progress();
        finishJob(true);
        sendResponse({ ok: true });
        return false;
      }

      progress();
      setTimeout(openNext, TAB_DELAY + (prods.length === 0 ? 2500 : 0));
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
