// ============================================
// FLIPKART SORT BY RATINGS v12
// - ON/OFF toggle (tap e off, page pure Flipkart)
// - Original DOM remove kore na (hide kore) → React safe
// - All pages scan → ratings order → sponsored last
// ============================================

(function () {
  "use strict";
  if (window.__flipSortLoaded) return;
  window.__flipSortLoaded = true;

  const LS_KEY = "flipsort_enabled_v12";
  const CHUNK = 240; // ekbare kotogulo card dekhabe

  const state = {
    enabled: localStorage.getItem(LS_KEY) !== "0",
    sorted: false,
    scanning: false,
    stop: false,
    products: [],
    rendered: 0,
    ourSection: null,
    hiddenEls: [],
    pill: null,
    sortBtn: null,
    stopBtn: null,
    summaryEl: null,
    savedSummary: null,
  };

  // ─── Utils ───
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function parseNum(t) {
    const d = String(t == null ? "" : t).replace(/[^0-9]/g, "");
    if (!d || d.length > 8) return 0;
    const n = parseInt(d, 10);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  function fmt(n) {
    n = +n || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  function toast(msg) {
    let t = document.getElementById("fs-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "fs-toast";
      t.style.cssText =
        "position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
        "background:#212121;color:#fff;padding:12px 22px;border-radius:10px;" +
        "font:500 13px/1.4 Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);" +
        "max-width:80vw;text-align:center;white-space:pre-line;transition:opacity .3s;opacity:0;";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(t._timer);
    t._timer = setTimeout(() => (t.style.opacity = "0"), 3500);
  }

  // ─── Card data extract ───
  function ratingOf(el) {
    const s = el.querySelector("span.PvbNMB");
    if (s) { const n = parseNum(s.textContent); if (n > 0) return n; }
    const m = (el.textContent || "").match(/\(([\d,]+)\)/);
    return m ? parseNum(m[1]) : 0;
  }
  function sponsoredOf(el) {
    return !!el.querySelector(".IxWX8O");
  }

  function extractFromDoc(doc) {
    const out = [];
    doc.querySelectorAll("div[data-id]").forEach((el) => {
      if (el.querySelector("div[data-id]")) return;
      if (!el.querySelector('a[href*="/p/"]')) return;
      const txt = el.textContent || "";
      if (txt.indexOf("₹") === -1 || !el.querySelector("img")) return;
      out.push({
        id: el.getAttribute("data-id"),
        html: el.outerHTML,
        ratings: ratingOf(el),
        sponsored: sponsoredOf(el),
      });
    });
    return out;
  }

  // ─── Scan pages ───
  async function scan(maxPages) {
    state.scanning = true;
    state.stop = false;
    state.products = [];
    const seen = new Set();
    const base = location.href.replace(/([?&])page=\d+&?/g, "$1").replace(/[?&]$/, "");
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
        doc = new DOMParser().parseFromString(await res.text(), "text/html");
      } catch (e) { break; }

      const cards = extractFromDoc(doc);
      if (!cards.length) break;
      let fresh = 0;
      for (const c of cards) if (!seen.has(c.id)) { seen.add(c.id); state.products.push(c); fresh++; }
      if (!fresh) break;

      if (p === 1) {
        const m = (doc.body.textContent || "").match(/Page\s+1\s+of\s+([\d,]+)/i);
        if (m) {
          const tp = parseNum(m[1]);
          if (tp > 0) totalPages = maxPages === Infinity ? tp : Math.min(maxPages, tp);
        }
      }
      await sleep(600);
    }
    state.scanning = false;
    hideStopBtn();
  }

  // ─── Hide originals (REMOVE KORBO NA!) ───
  function hideOriginals() {
    const rows = Array.from(document.querySelectorAll("div.nZIRY7"))
      .filter((r) => r.querySelector('div[data-id] a[href*="/p/"]'));
    const sections = [];
    rows.forEach((r) => {
      const s = r.closest(".lvJbLV.col-12-12") || r.parentElement;
      if (s && sections.indexOf(s) === -1) sections.push(s);
    });
    const pag = Array.from(document.querySelectorAll("div.lvJbLV"))
      .find((d) => /Page\s+\d+\s+of\s+\d+/i.test(d.textContent || "") && d.querySelector("nav"));
    if (pag && sections.indexOf(pag) === -1) sections.push(pag);

    sections.forEach((s) => {
      if (s && s.style.display !== "none") {
        s.style.display = "none";
        state.hiddenEls.push(s);
      }
    });
    return sections[0] || null;
  }

  function unhideAll() {
    state.hiddenEls.forEach((s) => { if (s.isConnected) s.style.display = ""; });
    state.hiddenEls = [];
  }

  // ─── Grid render ───
  function makeCard(p, rank) {
    const tpl = document.createElement("template");
    tpl.innerHTML = p.html.trim();
    const card = tpl.content.firstElementChild;
    if (!card) return null;
    card.style.width = "25%";
    card.style.position = "relative";

    const b = document.createElement("div");
    b.style.cssText =
      "position:absolute;top:8px;right:8px;z-index:5;color:#fff;font:700 12px/1 Arial,sans-serif;" +
      "padding:5px 9px;border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:none;" +
      "background:" + (p.sponsored ? "#9e9e9e" : "linear-gradient(135deg,#ff9800,#f57c00)") + ";";
    b.textContent = p.sponsored ? "📢 Ad" : "⭐ " + fmt(p.ratings);
    b.title = "Ratings: " + p.ratings.toLocaleString("en-IN") + " • Rank #" + (rank + 1);
    card.appendChild(b);
    return card;
  }

  function appendChunk() {
    if (!state.ourSection) return;
    const grid = state.ourSection.querySelector(".nZIRY7");
    const end = Math.min(state.rendered + CHUNK, state.products.length);
    const frag = document.createDocumentFragment();
    for (let i = state.rendered; i < end; i++) {
      const el = makeCard(state.products[i], i);
      if (el) frag.appendChild(el);
    }
    state.rendered = end;

    const old = state.ourSection.querySelector(".fs-loadmore");
    if (old) old.remove();
    grid.appendChild(frag);

    if (state.rendered < state.products.length) {
      const b = document.createElement("button");
      b.className = "fs-loadmore";
      b.textContent = "⬇️ Load more (" + state.rendered + "/" + state.products.length + " shown)";
      b.style.cssText =
        "display:block;margin:18px auto;padding:12px 30px;background:#2874f0;color:#fff;border:none;" +
        "border-radius:22px;font:600 14px Arial,sans-serif;cursor:pointer;";
      b.onclick = () => { appendChunk(); updateSummary(); };
      state.ourSection.appendChild(b);
    }
  }

  function updateSummary() {
    if (!state.summaryEl) return;
    state.summaryEl.textContent =
      "Showing 1 – " + state.rendered + " of " + state.products.length +
      " results  (⭐ sorted by most rated)";
  }

  // ─── Restore / Cleanup ───
  function restore(silent) {
    if (state.ourSection) { state.ourSection.remove(); state.ourSection = null; }
    unhideAll();
    if (state.summaryEl && state.savedSummary != null) {
      state.summaryEl.innerHTML = state.savedSummary;
    }
    state.summaryEl = null; state.savedSummary = null;
    state.products = []; state.rendered = 0; state.sorted = false;
    hideStopBtn();
    updateSortBtn();
    if (!silent) toast("🔄 Original Flipkart page restored!");
  }

  // ─── Main sort ───
  async function sortByRatings() {
    if (!state.enabled || state.scanning) return;
    if (state.sorted) { restore(false); return; }

    const input = prompt(
      "কতগুলো PAGE scan করবে?\n\n" +
      "• খালি রেখে OK = ALL pages (সব product)\n" +
      "• সংখ্যা লেখো (যেমন 20) = প্রথম 20 page",
      ""
    );
    if (input === null) return;
    const maxPages = input.trim() === "" ? Infinity : (parseInt(input, 10) || Infinity);

    await scan(maxPages);
    if (!state.products.length) { alert("❌ কোনো product collect হয়নি!"); return; }

    state.products.sort((a, b) => {
      if (a.sponsored !== b.sponsored) return a.sponsored ? 1 : -1;
      return b.ratings - a.ratings;
    });

    const anchor = hideOriginals();

    state.summaryEl = document.querySelector("span._Omnvo");
    if (state.summaryEl && state.savedSummary == null) state.savedSummary = state.summaryEl.innerHTML;

    const sec = document.createElement("div");
    sec.className = "lvJbLV col-12-12";
    const grid = document.createElement("div");
    grid.className = "nZIRY7";
    grid.style.cssText = "display:flex;flex-wrap:wrap;width:100%;";
    sec.appendChild(grid);
    state.ourSection = sec;
    state.rendered = 0;

    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sec, anchor);
    else document.body.appendChild(sec);

    appendChunk();
    updateSummary();
    state.sorted = true;
    updateSortBtn();
    window.scrollTo({ top: 0, behavior: "smooth" });

    const sp = state.products.filter((p) => p.sponsored).length;
    toast("✅ " + state.products.length + " products sorted!\n📢 Sponsored: " + sp + " (last e)");
  }

  // ─── UI: ON/OFF pill (top right) ───
  function createPill() {
    if (state.pill) return;
    const pill = document.createElement("div");
    pill.style.cssText =
      "position:fixed;top:64px;right:14px;z-index:2147483647;cursor:pointer;user-select:none;" +
      "padding:8px 14px;border-radius:20px;font:700 12px Arial,sans-serif;color:#fff;" +
      "box-shadow:0 3px 10px rgba(0,0,0,.3);";
    pill.onclick = () => setEnabled(!state.enabled);
    document.body.appendChild(pill);
    state.pill = pill;
    updatePill();
  }

  function updatePill() {
    if (!state.pill) return;
    if (state.enabled) {
      state.pill.textContent = "🟢 FlipSort ON";
      state.pill.style.background = "linear-gradient(135deg,#2e7d32,#1b5e20)";
      state.pill.title = "Click to OFF (page pure Flipkart hoye jabe)";
    } else {
      state.pill.textContent = "🔴 FlipSort OFF";
      state.pill.style.background = "linear-gradient(135deg,#c62828,#8e0000)";
      state.pill.title = "Click to ON";
    }
  }

  function setEnabled(on) {
    state.enabled = on;
    try { localStorage.setItem(LS_KEY, on ? "1" : "0"); } catch (e) {}
    if (!on) {
      if (state.sorted) restore(true);
      if (state.sortBtn) { state.sortBtn.remove(); state.sortBtn = null; }
      hideStopBtn();
      toast("🔴 FlipSort OFF — page ekhon pure Flipkart");
    } else {
      createSortButton();
      toast("🟢 FlipSort ON");
    }
    updatePill();
  }

  // ─── UI: sort button ───
  function createSortButton() {
    if (state.sortBtn || !state.enabled) return;
    const b = document.createElement("div");
    b.style.cssText =
      "position:fixed;right:26px;bottom:30px;z-index:2147483647;cursor:pointer;user-select:none;" +
      "color:#fff;border-radius:30px;padding:13px 22px;font:700 14px Arial,sans-serif;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.35);transition:transform .15s;";
    b.addEventListener("click", sortByRatings);
    document.body.appendChild(b);
    state.sortBtn = b;
    updateSortBtn();
  }

  function updateSortBtn() {
    if (!state.sortBtn) return;
    if (state.sorted) {
      state.sortBtn.textContent = "🔄 Restore Default";
      state.sortBtn.style.background = "linear-gradient(135deg,#2e7d32,#1b5e20)";
    } else {
      state.sortBtn.textContent = "⭐ Sort by Ratings";
      state.sortBtn.style.background = "linear-gradient(135deg,#2874f0,#1a4fb7)";
    }
  }

  function showStopBtn() {
    if (state.stopBtn) return;
    const s = document.createElement("div");
    s.textContent = "🛑 STOP";
    s.style.cssText =
      "position:fixed;right:26px;bottom:88px;z-index:2147483647;cursor:pointer;background:#d32f2f;" +
      "color:#fff;border-radius:20px;padding:9px 18px;font:700 13px Arial,sans-serif;";
    s.onclick = () => { state.stop = true; };
    document.body.appendChild(s);
    state.stopBtn = s;
  }
  function hideStopBtn() {
    if (state.stopBtn) { state.stopBtn.remove(); state.stopBtn = null; }
  }

  // ─── SPA navigation e cleanup (jaiye page break hoy na) ───
  (function watchURL() {
    let last = location.href;
    new MutationObserver(() => {
      if (location.href !== last) {
        last = location.href;
        if (state.ourSection || state.hiddenEls.length) restore(true);
      }
    }).observe(document.body, { childList: true, subtree: true });
  })();

  // ─── Keyboard ───
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (state.enabled) sortByRatings();
    }
  });

  // ─── Init ───
  function init() {
    createPill();
    if (!state.enabled) return; // OFF thakle kichu korbe na
    const t0 = Date.now();
    const iv = setInterval(() => {
      const has = document.querySelector('div[data-id] a[href*="/p/"]');
      if (has || Date.now() - t0 > 20000) {
        clearInterval(iv);
        createSortButton();
      }
    }, 1000);
  }

  if (location.hostname.indexOf("flipkart.com") !== -1) init();
})();
