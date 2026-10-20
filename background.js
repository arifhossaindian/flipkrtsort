// ============================================
// background.js  —  Sort by Ratings v21
// ============================================
// Anti-block strategy:
//  1) Sequential tab scanning (NO parallel tabs — looks human)
//  2) Random delay 1.5s–4s between pages
//  3) Empty page → retry once after 3–6s
//  4) 3 consecutive empty pages OR captcha → stop & report "blocked"
//  5) Content script then auto-switches to Method 2 (infinite scroll)
//
// Real collected count is reported (deduped) — no "false scans".
// ============================================

const SCAN = {
  id: null,
  urls: [],
  collected: [],
  seen: new Set(),
  abort: false,
  originTabId: null,
  done: 0,
  total: 0,
  blocked: false,
  consecutiveEmpty: 0,
  blockedReason: "",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

// Single pending worker resolver (scanning is sequential)
let workerResolve = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Main page asks to start a scan
  if (msg.type === "FS_SCAN_START") {
    SCAN.id = msg.scanId;
    SCAN.urls = msg.urls || [];
    SCAN.collected = [];
    SCAN.seen = new Set();
    SCAN.abort = false;
    SCAN.originTabId = sender.tab ? sender.tab.id : null;
    SCAN.done = 0;
    SCAN.total = SCAN.urls.length;
    SCAN.blocked = false;
    SCAN.consecutiveEmpty = 0;
    SCAN.blockedReason = "";
    runScan();
    sendResponse({ ok: true });
    return false;
  }

  // Main page asks to abort
  if (msg.type === "FS_SCAN_ABORT") {
    if (msg.scanId === SCAN.id) {
      SCAN.abort = true;
      // If a worker tab is currently open, close it
      if (workerResolve) workerResolve({ products: [], blocked: false, noResults: true, aborted: true });
    }
    sendResponse({ ok: true });
    return false;
  }

  // Worker tab checks if it should run in worker mode
  if (msg.type === "FS_WORKER_READY") {
    const isWorker = SCAN.id !== null && SCAN.originTabId !== sender.tab.id;
    sendResponse({ isWorker: isWorker, scanId: SCAN.id });
    return false;
  }

  // Worker tab reports extracted products
  if (msg.type === "FS_WORKER_DONE") {
    if (workerResolve) {
      const r = workerResolve;
      workerResolve = null;
      r(msg);
    }
    // Close the worker tab (handled by scanViaTab, but also ensure here)
    if (sender.tab && sender.tab.id && sender.tab.id !== SCAN.originTabId) {
      try { chrome.tabs.remove(sender.tab.id); } catch (e) {}
    }
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

function sendProgress(done, total, collected, addedLast) {
  if (SCAN.originTabId == null) return;
  try {
    chrome.tabs.sendMessage(SCAN.originTabId, {
      type: "FS_PROGRESS",
      scanId: SCAN.id,
      done: done,
      total: total,
      collected: collected,
      addedLast: addedLast,
    });
  } catch (e) {}
}

function sendDone(products, stoppedEarly, method, reason) {
  if (SCAN.originTabId == null) return;
  try {
    chrome.tabs.sendMessage(SCAN.originTabId, {
      type: "FS_SCAN_DONE",
      scanId: SCAN.id,
      products: products,
      stoppedEarly: stoppedEarly,
      method: method,
      reason: reason || "",
    });
  } catch (e) {}
}

async function runScan() {
  for (let i = 0; i < SCAN.urls.length; i++) {
    if (SCAN.abort) break;
    if (SCAN.blocked) break;

    const url = SCAN.urls[i];
    SCAN.done = i + 1;

    let result = await scanViaTab(url);

    // Retry once if empty (and not explicitly blocked/noResults)
    if (
      result &&
      !(result.products && result.products.length) &&
      !result.blocked &&
      !result.noResults &&
      !result.aborted
    ) {
      await sleep(rand(3000, 6000));
      if (SCAN.abort) break;
      result = await scanViaTab(url);
    }

    const products = (result && result.products) || [];
    const blocked = result ? !!result.blocked : false;
    const noResults = result ? !!result.noResults : false;

    if (blocked) {
      SCAN.blocked = true;
      SCAN.blockedReason = "captcha / bot block detected";
      break;
    }

    if (!products.length && !noResults) {
      SCAN.consecutiveEmpty++;
      if (SCAN.consecutiveEmpty >= 3) {
        SCAN.blocked = true;
        SCAN.blockedReason = "3 consecutive empty pages (likely soft-blocked)";
        break;
      }
    } else {
      SCAN.consecutiveEmpty = 0;
    }

    // Dedupe + collect
    let added = 0;
    for (const p of products) {
      if (p.id && !SCAN.seen.has(p.id)) {
        SCAN.seen.add(p.id);
        SCAN.collected.push(p);
        added++;
      }
    }

    sendProgress(SCAN.done, SCAN.total, SCAN.collected.length, added);

    // Random delay between pages (anti-block) — skip after last page
    if (i < SCAN.urls.length - 1 && !SCAN.abort && !SCAN.blocked) {
      await sleep(rand(1500, 4000));
    }
  }

  sendDone(
    SCAN.collected,
    SCAN.blocked,
    SCAN.blocked ? "scroll" : "tab",
    SCAN.blockedReason
  );
  SCAN.id = null;
}

function scanViaTab(url) {
  return new Promise(async (resolve) => {
    let settled = false;
    let tabId = null;

    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (workerResolve === finish) workerResolve = null;
      if (tabId != null) {
        try { chrome.tabs.remove(tabId); } catch (e) {}
      }
      resolve(val);
    };

    const timer = setTimeout(() => finish(null), 30000);
    workerResolve = finish; // FS_WORKER_DONE will call finish(msg)

    try {
      const tab = await chrome.tabs.create({ url: url, active: false });
      tabId = tab.id;

      // If the tab is closed before worker reports (e.g. redirect to captcha), resolve null
      const removedListener = (removedId) => {
        if (removedId === tabId) {
          chrome.tabs.onRemoved.removeListener(removedListener);
          finish(null);
        }
      };
      chrome.tabs.onRemoved.addListener(removedListener);
    } catch (e) {
      finish(null);
    }
  });
}
