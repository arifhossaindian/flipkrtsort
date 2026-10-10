// ============================================
// SORT BY RATINGS v13 - FLIPKART + MYNTRA
// Flipkart: div[data-id] cards, (1,234) ratings, IxWX8O = sponsored
// Myntra:   li.product-base cards, "33.5k" ratings, .product-waterMark = AD
// ============================================

(function () {
  "use strict";
  if (window.__flipSortLoaded) return;
  window.__flipSortLoaded = true;

  const HOST = location.hostname.replace(/^www\./, "");
  const IS_FLIPKART = HOST.indexOf("flipkart.com") !== -1;
  const IS_MYNTRA = HOST.indexOf("myntra.com") !== -1;
  if (!IS_FLIPKART && !IS_MYNTRA) return;

  const LS_KEY = "sortratings_enabled_v13";
  const CHUNK = 240;

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

  function parseDigits(t) {
    const d = String(t == null ? "" : t).replace(/[^0-9]/g, "");
    if (!d || d.length > 8) return 0;
    const n = parseInt(d, 10);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  // Myntra: "33.5k" → 33500, "1.2L" → 120000, "447" → 447
  function parseMyntraCount(t) {
    const s = String(t || "").trim().toLowerCase();
    const m = s.match(/^([\d.]+)\s*(k|m)?/);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    if (!isFinite(n)) return 0;
    if (m[2] === "k") n *= 1000;
    if (m[2] === "m") n *= 1000000;
    n = Math.round(n);
    return n >= 0 && n <= 99999999 ? n : 0;
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

  // ============================================
  // SITE ADAPTERS
  // ============================================
  const ADAPTER = {
    flipkart: {
      pageParam: "page",
      cards(doc) {
        return Array.from(doc.querySelectorAll("div[data-id]")).filter((el) => {
          if (el.querySelector("div[data-id]")) return false;
          if (!el.querySelector('a[href*="/p/"]')) return false;
          const txt = el.textContent || "";
          return txt.indexOf("₹") !== -1 && !!el.querySelector("img");
        });
      },
      id(el) { return el.getAttribute("data-id") || ""; },
      ratings(el) {
        const s = el.querySelector("span.PvbNMB");
        if (s) { const n = parseDigits(s.textContent); if (n > 0) return n; }
        const m = (el.textContent || "").match(/\(([\d,]+)\)/);
        return m ? parseDigits(m[1]) : 0;
      },
      sponsored(el) { return !!el.querySelector(".IxWX8O"); },
      rows() {
        return Array.from(document.querySelectorAll("div.nZIRY7"))
          .filter((r) => r.querySelector('div[data-id] a[href*="/p/"]'));
      },
      gridClass: "nZIRY7",
      summary() { return document.querySelector("span._Omnvo"); },
    },

    myntra: {
      pageParam: "p",
      cards(doc) {
        return Array.from(doc.querySelectorAll("li.product-base")).filter((el) => {
          const txt = el.textContent || "";
          return txt.indexOf("Rs.") !== -1 || txt.indexOf("₹") !== -1;
        });
      },
      id(el) { return el.getAttribute("id") || ""; },
      ratings(el) {
        const rc = el.querySelector(".product-ratingsCount");
        if (rc) {
          // separator div bad diye baki text = "33.5k"
          let txt = "";
          rc.childNodes.forEach((n) => {
            if (n.nodeType === 3) txt += n.textContent;
            else if (!n.classList || !n.classList.contains("product-separator")) txt += n.textContent;
          });
          txt = txt.replace(/[|]/g, "").trim();
          const n = parseMyntraCount(txt);
          if (n > 0) return n;
        }
        const m = (el.textContent || "").match(/\|\s*([\d.]+[kKmM]?)/);
        return m ? parseMyntraCount(m[1]) : 0;
      },
      sponsored(el) {
        const w = el.querySelector(".product-waterMark");
        if (w && /AD/i.test(w.textContent || "")) return true;
        return /\bAD\b/.test((el.querySelector(".product-imageSliderContainer") || {}).textContent || "");
      },
      rows() {
        const uls = Array.from(document.querySelectorAll("ul.results-base"));
        if (uls.length) return uls;
        // fallback: product-base er common parent
        const first = document.querySelector("li.product-base");
        return first && first.parentElement ? [first.parentElement] : [];
      },
      gridClass: "results-base",
      summary() {
        return Array.from(document.querySelectorAll("h1, span, div"))
          .find((s) => /items?$/.test((s.textContent || "").trim().split(" - ").pop() || "") && /\d/.test(s.textContent || ""));
      },
    },
  };

  const SITE = IS_FLIPKART ? ADAPTER.flipkart : ADAPTER.myntra;

  // ─── Extract from parsed page ───
  function extractFromDoc(doc) {
    const out = [];
    SITE.cards(doc).forEach((el) => {
      out.push({
        id: SITE.id(el),
        html: el.outerHTML,
        ratings: SITE.ratings(el),
        sponsored: SITE.sponsored(el),
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

    const base = location.href
      .replace(/([?&])(page|p)=\d+&?/g, "$1")
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
        const res = await fetch(base + sep + SITE.pageParam + "=" + p, { credentials: "include" });
        if (!res.ok) break;
        doc = new DOMParser().parseFromString(await res.text(), "text/html");
      } catch (e) { break; }

      const cards = extractFromDoc(doc);
      if (!cards.length) break;

      let fresh = 0;
      for (const c of cards) {
        if (c.id && !seen.has(c.id)) { seen.add(c.id); state.products.push(c); fresh++; }
      }
      if (!fresh) break;

      // Myntra: next-page link theke total page jano
      if (p === 1 && IS_MYNTRA) {
        const nl = doc.querySelector('link[rel="next"]');
        if (nl) {
          const m = (nl.getAttribute("href") || "").match(/[?&]p=(\d+)/);
          if (m) { /* atleast 2 pages ache */ }
        }
      }
      await sleep(600);
    }
    state.scanning = false;
    hideStopBtn();
  }

  // ─── Hide originals (remove KORBO NA) ───
  function hideOriginals() {
    const sections = [];
    SITE.rows().forEach((r) => {
      const s = r.closest(".lvJbLV.col-12-12") || r.parentElement;
      if (s && sections.indexOf(s) === -1) sections.push(s);
    });
    // pagination bar
    const pag = Array.from(document.querySelectorAll("div, nav"))
      .find((d) => /Page\s+\d+\s+of\s+\d+/i.test(d.textContent || "") && d.querySelector("nav, a"));
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

  // ─── Card + badge ───
  function makeCard(p, rank) {
    const tpl = document.createElement("template");
    tpl.innerHTML = p.html.trim();
    const card = tpl.content.firstElementChild;
    if (!card) return null;
    card.style.position = "relative";
    card.style.listStyle = "none";

    const b = document.createElement("div");
    b.style.cssText =
      "position:absolute;top:8px;right:8px;z-index:5;color:#fff;font:700 12px/1 Arial,sans-serif;" +
      "padding:5px 9px;border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:none;" +
      "background:" + (p.sponsored ? "#9e9e9e" : "linear-gradient(135deg,#ff9800,#f57c00)") + ";";
    b.textContent = p.sponsored ? "📢 AD" : "⭐ " + fmt(p.ratings);
    b.title = "Ratings: " + p.ratings.toLocaleString("en-IN") + " • Rank #" + (rank + 1);
    card.appendChild(b);
    return card;
  }

  function appendChunk() {
    if (!state.ourSection) return;
    const grid = state.ourSection.querySelector("[data-fs-grid]");
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

  // ─── Restore ───
  function restore(silent) {
    if (state.ourSection) { state.ourSection.remove(); state.ourSection = null; }
    unhideAll();
    if (state.summaryEl && state.savedSummary != null) state.summaryEl.innerHTML = state.savedSummary;
    state.summaryEl = null; state.savedSummary = null;
    state.products = []; state.rendered = 0; state.sorted = false;
    hideStopBtn();
    updateSortBtn();
    if (!silent) toast("🔄 Original page restored!");
  }

  // ─── Main sort ───
  async function sortByRatings() {
    if (!state.enabled || state.scanning) return;
    if (state.sorted) { restore(false); return; }

    const siteName = IS_FLIPKART ? "Flipkart" : "Myntra";
    const input = prompt(
      siteName + ": কতগুলো PAGE scan করবে?\n\n" +
      "• খালি রেখে OK = যতগুলো page আছে সব (Myntra te onek page, time lagbe!)\n" +
      "• সংখ্যা লেখো (যেমন 20) = প্রথম 20 page (50×20 = 1000 products)",
      IS_MYNTRA ? "20" : ""
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

    state.summaryEl = SITE.summary();
    if (state.summaryEl && state.savedSummary == null) state.savedSummary = state.summaryEl.innerHTML;

    const sec = document.createElement("div");
    sec.className = "lvJbLV col-12-12";
    const grid = document.createElement(IS_MYNTRA ? "ul" : "div");
    grid.className = SITE.gridClass;
    grid.setAttribute("data-fs-grid", "1");
    grid.style.cssText = IS_MYNTRA
      ? "display:flex;flex-wrap:wrap;width:100%;margin:0;padding:0;list-style:none;gap:0;"
      : "display:flex;flex-wrap:wrap;width:100%;";
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

    const ad = state.products.filter((p) => p.sponsored).length;
    toast("✅ " + state.products.length + " products sorted!\n📢 AD: " + ad + " (last e)");
  }

  // ─── ON/OFF pill ───
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
      state.pill.textContent = "🟢 Sort ON";
      state.pill.style.background = "linear-gradient(135deg,#2e7d32,#1b5e20)";
    } else {
      state.pill.textContent = "🔴 Sort OFF";
      state.pill.style.background = "linear-gradient(135deg,#c62828,#8e0000)";
    }
  }

  function setEnabled(on) {
    state.enabled = on;
    try { localStorage.setItem(LS_KEY, on ? "1" : "0"); } catch (e) {}
    if (!on) {
      if (state.sorted) restore(true);
      if (state.sortBtn) { state.sortBtn.remove(); state.sortBtn = null; }
      hideStopBtn();
      toast("🔴 OFF — page ekhon pure " + (IS_FLIPKART ? "Flipkart" : "Myntra"));
    } else {
      createSortButton();
      toast("🟢 ON");
    }
    updatePill();
  }

  // ─── Sort button ───
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

  // ─── SPA navigation cleanup ───
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
    if (!state.enabled) return;
    const t0 = Date.now();
    const iv = setInterval(() => {
      const has = IS_FLIPKART
        ? document.querySelector('div[data-id] a[href*="/p/"]')
        : document.querySelector("li.product-base");
      if (has || Date.now() - t0 > 20000) {
        clearInterval(iv);
        createSortButton();
      }
    }, 1000);
  }

  init();
})();
