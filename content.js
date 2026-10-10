// ============================================
// FLIPKART SORT BY RATINGS - v11 (LAYOUT FIXED)
// Cards এখন সরাসরি grid এ বসে (কোনো wrapper না)
// তাই original Flipkart এর মতোই সুন্দর দেখায়
// ============================================

(function () {
  "use strict";

  if (window.__flipSortLoaded) return;
  window.__flipSortLoaded = true;

  const RENDER_CHUNK = 240; // একবারে DOM এ কতগুলো card দেখাবে

  const state = {
    sorted: false,
    scanning: false,
    stop: false,
    products: [],         // {id, html, ratings, sponsored}
    grid: null,
    ourSection: null,
    savedSections: [],    // original Flipkart row sections
    savedParent: null,
    savedAnchor: null,
    savedSummaryHTML: null,
    summaryEl: null,
    paginationEl: null,
    renderedCount: 0,
    btn: null,
    stopBtn: null,
  };

  // ─── Utils ───
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function parseNum(t) {
    const d = String(t == null ? "" : t).replace(/[^0-9]/g, "");
    if (!d || d.length > 8) return 0;
    const n = parseInt(d, 10);
    return (isFinite(n) && n >= 0) ? n : 0;
  }

  function fmt(n) {
    n = +n || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  // ─── Toast ───
  function toast(msg) {
    let t = document.getElementById("fs-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "fs-toast";
      t.style.cssText =
        "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
        "background:#212121;color:#fff;padding:12px 22px;border-radius:10px;" +
        "font:500 13px/1.4 Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);" +
        "max-width:80vw;text-align:center;white-space:pre-line;transition:opacity .3s;";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = "0"; }, 3500);
  }

  // ─── Extract product cards from a parsed page ───
  function extractCards(doc) {
    const out = [];
    doc.querySelectorAll("div[data-id]").forEach((el) => {
      if (el.querySelector("div[data-id]")) return;          // nested বাদ
      if (!el.querySelector('a[href*="/p/"]')) return;       // product link নেই
      const txt = el.textContent || "";
      if (txt.indexOf("₹") === -1) return;                   // price নেই
      if (!el.querySelector("img")) return;                  // image নেই

      const id = el.getAttribute("data-id");

      // Ratings count: <span class="PvbNMB">(23,030)</span>
      let ratings = 0;
      const rs = el.querySelector("span.PvbNMB");
      if (rs) ratings = parseNum(rs.textContent);
      if (!ratings) {
        const m = el.innerHTML.match(/class="PvbNMB">\(?([\d,]+)\)?</);
        if (m) ratings = parseNum(m[1]);
      }

      // Sponsored: grey "Sponsored" logo container (class IxWX8O)
      const sponsored = !!el.querySelector(".IxWX8O") ||
        />\s*Sponsored\s*</i.test(el.innerHTML);

      out.push({ id, html: el.outerHTML, ratings, sponsored });
    });
    return out;
  }

  // ─── Scan all pages ───
  async function scan(maxPages) {
    state.scanning = true;
    state.stop = false;
    state.products = [];
    const seen = new Set();

    const base = location.href
      .replace(/([?&])page=\d+&?/g, "$1")
      .replace(/[?&]$/, "");
    const sep = base.indexOf("?") !== -1 ? "&" : "?";

    let totalPages = maxPages;

    for (let p = 1; p <= totalPages; p++) {
      if (state.stop) break;

      showStopBtn();
      toast("🔍 Page " + p + "/" + (totalPages === Infinity ? "?" : totalPages) +
        " scanning...\n📦 Collected: " + state.products.length);

      let doc = null;
      try {
        const res = await fetch(base + sep + "page=" + p, { credentials: "include" });
        if (!res.ok) break;
        const html = await res.text();
        doc = new DOMParser().parseFromString(html, "text/html");
      } catch (e) { break; }

      const cards = extractCards(doc);
      if (!cards.length) break;

      let fresh = 0;
      for (const c of cards) {
        if (!seen.has(c.id)) { seen.add(c.id); state.products.push(c); fresh++; }
      }
      if (!fresh) break;

      // প্রথম page এ মোট page সংখ্যা জেনে নাও
      if (p === 1) {
        const m = (doc.body.textContent || "").match(/Page\s+1\s+of\s+([\d,]+)/i);
        if (m) {
          const tp = parseNum(m[1]);
          if (tp > 0) totalPages = (maxPages === Infinity) ? tp : Math.min(maxPages, tp);
        }
      }

      // Safety: অনেক বেশি হয়ে গেলে জিজ্ঞেস করো
      if (state.products.length >= 12000 && state.products.length % 4000 < 40) {
        if (!confirm(state.products.length + " products হয়ে গেছে।\nআরো scan করবে?")) break;
      }

      await sleep(700);
    }

    state.scanning = false;
    hideStopBtn();
  }

  // ─── Sort: sponsored শেষে, বাকিরা ratings কম→বেসি নয়, বেশি→কম ───
  function sortProducts() {
    state.products.sort((a, b) => {
      if (a.sponsored !== b.sponsored) return a.sponsored ? 1 : -1;
      return b.ratings - a.ratings;
    });
  }

  // ─── Card element বানাও (সরাসরি, কোনো wrapper ছাড়া!) ───
  function makeCardEl(p) {
    const tpl = document.createElement("template");
    tpl.innerHTML = p.html.trim();
    const card = tpl.content.firstElementChild;
    if (!card) return null;

    // 🔑 FIX: card টা নিজেই 25% width রাখবে, সরাসরি grid এর child হবে
    card.style.width = "25%";
    card.style.position = "relative";

    const b = document.createElement("div");
    b.textContent = p.sponsored ? "📢 Ad" : "⭐ " + fmt(p.ratings);
    b.style.cssText =
      "position:absolute;top:8px;right:8px;z-index:5;color:#fff;" +
      "font:700 12px/1 Arial,sans-serif;padding:5px 9px;border-radius:12px;" +
      "box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:none;" +
      "background:" + (p.sponsored ? "#9e9e9e" : "linear-gradient(135deg,#ff9800,#f57c00)") + ";";
    card.appendChild(b);
    return card;
  }

  // ─── Render: original rows সরিয়ে নিজের grid বসাও ───
  function render() {
    const rows = Array.from(document.querySelectorAll("div.nZIRY7"))
      .filter((r) => r.querySelector('div[data-id] a[href*="/p/"]'));
    if (!rows.length) { alert("❌ Product rows পাওয়া যায়নি!"); return false; }

    const sections = [];
    rows.forEach((r) => {
      const s = r.parentElement;
      if (s && sections.indexOf(s) === -1) sections.push(s);
    });

    state.savedSections = sections;
    state.savedParent = sections[0].parentNode;
    state.savedAnchor = sections[sections.length - 1].nextSibling;

    // Summary line
    state.summaryEl = document.querySelector("span._Omnvo");
    if (!state.summaryEl) {
      state.summaryEl = Array.from(document.querySelectorAll("span"))
        .find((s) => /Showing\s+\d/.test(s.textContent || ""));
    }
    if (state.summaryEl) state.savedSummaryHTML = state.summaryEl.innerHTML;

    // Pagination bar লুকাও
    state.paginationEl = Array.from(document.querySelectorAll("div.lvJbLV"))
      .find((d) => /Page\s+\d+\s+of\s+\d+/i.test(d.textContent || "") && d.querySelector("nav"));

    // নিজের section + grid (Flipkart এর row class এর মতোই flex-wrap)
    const sec = document.createElement("div");
    sec.className = "lvJbLV col-12-12";
    const grid = document.createElement("div");
    grid.className = "nZIRY7";
    grid.style.cssText = "display:flex;flex-wrap:wrap;width:100%;";
    sec.appendChild(grid);

    state.ourSection = sec;
    state.grid = grid;
    state.renderedCount = 0;

    state.savedParent.insertBefore(sec, sections[0]);
    sections.forEach((s) => s.remove());
    if (state.paginationEl) state.paginationEl.style.display = "none";

    appendChunk();
    updateSummary();
    return true;
  }

  function appendChunk() {
    const end = Math.min(state.renderedCount + RENDER_CHUNK, state.products.length);
    const frag = document.createDocumentFragment();
    for (let i = state.renderedCount; i < end; i++) {
      const el = makeCardEl(state.products[i]);
      if (el) frag.appendChild(el);
    }
    state.renderedCount = end;

    const old = state.ourSection.querySelector(".fs-loadmore");
    if (old) old.remove();
    state.grid.appendChild(frag);

    if (state.renderedCount < state.products.length) {
      const b = document.createElement("button");
      b.className = "fs-loadmore";
      b.textContent = "⬇️ Load more (" + state.renderedCount + "/" + state.products.length + " shown)";
      b.style.cssText =
        "display:block;margin:18px auto;padding:12px 30px;background:#2874f0;color:#fff;" +
        "border:none;border-radius:22px;font:600 14px Arial,sans-serif;cursor:pointer;" +
        "box-shadow:0 3px 10px rgba(40,116,240,.4);";
      b.onclick = () => { appendChunk(); updateSummary(); };
      state.ourSection.appendChild(b);
    }
  }

  function updateSummary() {
    if (!state.summaryEl) return;
    state.summaryEl.textContent =
      "Showing 1 – " + state.renderedCount + " of " + state.products.length +
      " results  (⭐ sorted by most rated)";
  }

  // ─── Restore original page ───
  function restore() {
    if (state.ourSection) { state.ourSection.remove(); state.ourSection = null; state.grid = null; }
    if (state.savedParent && state.savedSections.length) {
      state.savedSections.forEach((s) => {
        if (!s.isConnected) state.savedParent.insertBefore(s, state.savedAnchor);
      });
    }
    if (state.paginationEl) state.paginationEl.style.display = "";
    if (state.summaryEl && state.savedSummaryHTML != null) {
      state.summaryEl.innerHTML = state.savedSummaryHTML;
    }
    state.savedSections = [];
    state.products = [];
    state.renderedCount = 0;
    state.sorted = false;
    updateBtn();
    toast("🔄 Original Flipkart page restored!");
  }

  // ─── Buttons ───
  function createBtn() {
    if (state.btn) return;
    const b = document.createElement("div");
    b.style.cssText =
      "position:fixed;right:26px;bottom:30px;z-index:2147483647;cursor:pointer;" +
      "background:linear-gradient(135deg,#2874f0,#1a4fb7);color:#fff;border-radius:30px;" +
      "padding:13px 22px;font:700 14px Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35);" +
      "user-select:none;transition:transform .15s;";
    b.addEventListener("click", onMainClick);
    document.body.appendChild(b);
    state.btn = b;
    updateBtn();
  }

  function updateBtn() {
    if (!state.btn) return;
    if (state.sorted) {
      state.btn.textContent = "🔄 Restore Original";
      state.btn.style.background = "linear-gradient(135deg,#2e7d32,#1b5e20)";
    } else {
      state.btn.textContent = "⭐ Sort by Ratings";
      state.btn.style.background = "linear-gradient(135deg,#2874f0,#1a4fb7)";
    }
  }

  function showStopBtn() {
    if (state.stopBtn) return;
    const s = document.createElement("div");
    s.textContent = "🛑 STOP";
    s.style.cssText =
      "position:fixed;right:26px;bottom:86px;z-index:2147483647;cursor:pointer;" +
      "background:#d32f2f;color:#fff;border-radius:20px;padding:9px 18px;" +
      "font:700 13px Arial,sans-serif;box-shadow:0 3px 10px rgba(0,0,0,.3);";
    s.onclick = () => { state.stop = true; };
    document.body.appendChild(s);
    state.stopBtn = s;
  }

  function hideStopBtn() {
    if (state.stopBtn) { state.stopBtn.remove(); state.stopBtn = null; }
  }

  // ─── Main click ───
  async function onMainClick() {
    if (state.scanning) return;
    if (state.sorted) { restore(); return; }

    const input = prompt(
      "কতগুলো PAGE scan করবে?\n\n" +
      "• খালি রেখে OK চাপো = ALL pages (সব product, সময় লাগবে)\n" +
      "• সংখ্যা লেখো (যেমন 20) = শুধু প্রথম 20 page",
      ""
    );
    if (input === null) return;

    const n = input.trim() === "" ? Infinity : (parseInt(input, 10) || Infinity);

    await scan(n);

    if (!state.products.length) { alert("❌ কোনো product collect হয়নি!"); return; }

    sortProducts();
    if (!render()) return;

    state.sorted = true;
    updateBtn();
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast("✅ " + state.products.length + " products sorted!\n(সবচেয়ে বেশি rating উপরে, Ads একদম শেষে)");
  }

  // ─── SPA page change হলে reset ───
  (function watchURL() {
    let last = location.href;
    new MutationObserver(() => {
      if (location.href !== last) {
        last = location.href;
        if (state.ourSection && state.ourSection.isConnected) state.ourSection.remove();
        state.ourSection = null; state.grid = null;
        state.savedSections = []; state.products = [];
        state.sorted = false; state.scanning = false;
        hideStopBtn(); updateBtn();
      }
    }).observe(document.body, { childList: true, subtree: true });
  })();

  // ─── Init ───
  function init() {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const has = document.querySelector('div[data-id] a[href*="/p/"]');
      if (has || Date.now() - t0 > 20000) {
        clearInterval(iv);
        createBtn();
      }
    }, 1000);
  }

  if (location.hostname.indexOf("flipkart.com") !== -1) init();
})();
