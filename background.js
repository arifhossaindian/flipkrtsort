// background.js - background tab khule pages scan kore
let job = null;

function progress() {
  if (!job) return;
  chrome.tabs.sendMessage(job.requester, {
    type: "FS_PROGRESS",
    scanId: job.scanId,
    done: job.doneCount,
    total: job.total,
    collected: job.results.length,
  }, () => {
    if (chrome.runtime.lastError) abortJob(false);
  });
}

function openNext() {
  if (!job) return;
  if (!job.urls.length) {
    const req = job.requester, id = job.scanId, res = job.results;
    job = null;
    chrome.tabs.sendMessage(req, { type: "FS_SCAN_DONE", scanId: id, products: res },
      () => { void chrome.runtime.lastError; });
    return;
  }
  const url = job.urls.shift();
  chrome.tabs.create({ url: url, active: false }, (tab) => {
    if (chrome.runtime.lastError || !tab || !job) { openNext(); return; }
    job.activeTab = tab.id;
    // Safety: 30s e response na ele tab bandho kore next e jao
    setTimeout(() => {
      if (job && job.activeTab === tab.id) {
        job.doneCount++;
        const tid = tab.id;
        job.activeTab = null;
        chrome.tabs.remove(tid, () => { void chrome.runtime.lastError; });
        progress();
        openNext();
      }
    }, 30000);
  });
}

function abortJob(notify) {
  if (!job) return;
  if (job.activeTab) chrome.tabs.remove(job.activeTab, () => { void chrome.runtime.lastError; });
  const req = job.requester, id = job.scanId, res = job.results;
  job = null;
  if (notify) {
    chrome.tabs.sendMessage(req, { type: "FS_SCAN_DONE", scanId: id, products: res, aborted: true },
      () => { void chrome.runtime.lastError; });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FS_WORKER_READY") {
    const isWorker = !!(job && sender.tab && sender.tab.id === job.activeTab);
    sendResponse({ isWorker: isWorker, scanId: job ? job.scanId : null });
    return false;
  }
  if (msg.type === "FS_SCAN_START") {
    if (job) abortJob(false);
    job = {
      scanId: msg.scanId,
      urls: (msg.urls || []).slice(),
      results: [],
      requester: sender.tab.id,
      total: (msg.urls || []).length,
      doneCount: 0,
      activeTab: null,
    };
    openNext();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === "FS_WORKER_DONE") {
    if (job && msg.scanId === job.scanId && sender.tab && sender.tab.id === job.activeTab) {
      job.results = job.results.concat(msg.products || []);
      job.doneCount++;
      const tid = job.activeTab;
      job.activeTab = null;
      chrome.tabs.remove(tid, () => { void chrome.runtime.lastError; });
      progress();
      openNext();
    }
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === "FS_SCAN_ABORT") {
    if (job && msg.scanId === msg.scanId && job && msg.scanId === job.scanId) abortJob(true);
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
