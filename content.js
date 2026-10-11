// ============================================
// SORT BY RATINGS v17 - rel=next PAGINATION CRAWL
// Myntra/Flipkart er official next-page link follow kore
// Retry + debug logs soho
// ============================================

(function () {
  "use strict";
  if (window.__flipSortLoaded) return;
  window.__flipSortLoaded = true;

  const HOST = location.hostname.replace(/^www\./, "");
  const IS_FLIPKART = HOST.indexOf("flipkart.com") !== -1;
  const IS_MYNTRA = HOST.indexOf("myntra.com") !== -1;
  if (!IS_FLIPKART && !IS_MYNTRA) return;

  const LS_KEY = "sortratings_enabled_v17";

  const state = {
    enabled: localStorage.getItem(LS_KEY) !== "0",
    sorted: false,
    scanning: false,
    stop: false,
    originalOrder: [],
    allProducts: [],
    pill: null,
    sortBtn: null,
    stopBtn: null,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function parseDigits(t) {
    const d = String(t == null ? "" : t).replace(/[^0-9]/g, "");
    if (!d || d.length > 8) return 0;
    const n = parseInt(d, 10);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  function parseMyntraCount(t) {
    let s = String(t || "").trim().toLowerCase();
    s = s.replace(/^[^0-9]+/, "");
    const m = s.match(/^([\d.]+)\s*(k|m|l)?/);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    if (!isFinite(n) || n < 0) return 0;
    if (m[2] === "k") n *= 1000;
    else if (m[2] === "m") n *= 1000000;
    else if (m[2] === "l") n *= 100000;
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

  // ─── Products from DOM ───
  function getProductsFromDOM() {
    if (IS_FLIPKART) {
      return Array.from(document.querySelectorAll("div[data-id]")).filter((el) => {
        if (el.querySelector("div[data-id]")) return false;
        if (!el.querySelector('a[href*="/p/"]')) return false;
        const txt = el.textContent || "";
        return txt.indexOf("₹") !== -1 && !!el.querySelector("img");
      });
    }
    return Array.from(document.querySelectorAll("li.product-base")).filter((el) =>
      !!el.querySelector(".product-ratingsContainer")
    );
  }

  function getRatings(el) {
    if (IS_FLIPKART) {
      const s = el.querySelector("span.PvbNMB");
      if (s) { const n = parseDigits(s.textContent); if (n > 0) return n; }
      const m = (el.textContent || "").match(/\(([\d,]+)\)/);
      return m ? parseDigits(m[1]) : 0;
    }
    const rc = el.querySelector(".product-ratingsCount");
    return rc ? parseMyntraCount(rc.textContent || "") : 0;
  }

  function isSponsored(el) {
    if (IS_FLIPKART) return !!el.querySelector(".IxWX8O");
    const w = el.querySelector(".product-waterMark");
    return w ? /AD/i.test(w.textContent || "") : false;
  }

  // ─── Extract from parsed HTML doc ───
  function extractFromDoc(doc) {
    const out = [];
    const nodes = IS_FLIPKART
      ? doc.querySelectorAll("div[data-id]")
      : doc.querySelectorAll("li.product-base");

    nodes.forEach((el) => {
      if (IS_FLIPKART) {
        if (el.querySelector("div[data-id]")) return;
        if (!el.querySelector('a[href*="/p/"]')) return;
        const txt = el.textContent || "";
        if (txt.indexOf("₹") === -1 || !el.querySelector("img")) return;
      } else {
        if (!el.querySelector(".product-ratingsContainer")) return;
      }
      const tpl = document.createElement("template");
      tpl.innerHTML = el.outerHTML.trim();
      const node = tpl.content.firstElementChild;
      if (!node) return;
      out.push({
        id: IS_FLIPKART ? el.getAttribute("data-id") : el.getAttribute("id"),
        node,
        ratings: getRatings(node),
        sponsored: isSponsored(node),
      });
    });
    return out;
  }

  // ─── 🔑 Official next-page link khuje ber kora ───
  function getNextLink(doc) {
    const l = doc.querySelector('link[rel="next"]');
    if (!l) return null;
    const href = l.getAttribute("href");
    if (!href || href.indexOf("http") !== 0 && href.indexOf("/") !== 0) return null;
    try { return new URL(href, doc.baseURI || location.href).href; } catch (e) { return null; }
  }

  // ─── Fetch with retry ───
  async function fetchPage(url) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, {
          credentials: "include",
          redirect: "follow",
          headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
        });
        if (!res.ok) {
          console.warn("[SortRatings] HTTP " + res.status + " → " + url);
          if (attempt === 1) { await sleep(1500); continue; }
          return null;
        }
        return await res.text();
      } catch (e) {
        console.warn("[SortRatings] fetch error:", e);
        if (attempt === 1) { await sleep(1500); continue; }
        return null;
      }
    }
    return null;
  }

  // ─── Multi-page collect ───
  async function fetchAllPages(maxPages) {
    state.scanning = true;
    state.stop = false;
    state.allProducts = [];
    const seen = new Set();
    showStopBtn();

    // Page 1 = current DOM
    getProductsFromDOM().forEach((el) => {
      const id = IS_FLIPKART ? el.getAttribute("data-id") : el.getAttribute("id");
      if (id && !seen.has(id)) {
        seen.add(id);
        state.allProducts.push({ id, node: el, ratings: getRatings(el), sponsored: isSponsored(el) });
      }
    });
    console.log("[SortRatings] page 1 (current DOM):", state.allProducts.length);

    // Fallback URL builder
    const base = location.href.replace(/([?&])(page|p)=\d+&?/g, "$1").replace(/[?&]$/, "");
    const sep = base.indexOf("?") !== -1 ? "&" : "?";
    const param = IS_FLIPKART ? "page" : "p";

    let nextUrl = getNextLink(document) || (base + sep + param + "=2");
    let pageNum = 2;
    let pagesOk = 0, pagesFail = 0, dupStreak = 0;

    while (nextUrl && pageNum <= maxPages && !state.stop && dupStreak < 2) {
      toast("🔍 Page " + pageNum + "/" + maxPages + " fetching...\n📦 Total: " + state.allProducts.length);

      const html = await fetchPage(nextUrl);
      if (!html) {
        pagesFail++;
        nextUrl = base + sep + param + "=" + (pageNum + 1);
        pageNum++;
        continue;
      }

      const doc = new DOMParser().parseFromString(html, "text/html");
      const products = extractFromDoc(doc);

      let fresh = 0;
      products.forEach((p) => {
        if (p.id && !seen.has(p.id)) { seen.add(p.id); state.allProducts.push(p); fresh++; }
      });

      console.log("[SortRatings] page", pageNum, "→ products:", products.length, "fresh:", fresh);

      if (!products.length || !fresh) {
        pagesFail++;
        dupStreak++;
      } else {
        pagesOk++;
        dupStreak = 0;
      }

      // 🔑 Next page: official rel=next, na thakle constructed URL
      nextUrl = getNextLink(doc) || (fresh ? base + sep + param + "=" + (pageNum + 1) : null);
      pageNum++;
      await sleep(700);
    }

    state.scanning = false;
    hideStopBtn();
    console.log("[SortRatings] DONE. pagesOk:", pagesOk, "pagesFail:", pagesFail, "total:", state.allProducts.length);
    return state.allProducts;
  }

  // ─── Sort + rearrange (DOM node move) ───
  function sortAndRearrange(products) {
    if (!products.length) return;

    const data = products.map((p, idx) => ({ node: p.node, idx, ratings: p.ratings, sponsored: p.sponsored }));
    state.originalOrder = products.map((p) => p.node);

    data.sort((a, b) => {
      if (a.sponsored !== b.sponsored) return a.sponsored ? 1 : -1;
      if (b.ratings !== a.ratings) return b.ratings - a.ratings;
      return a.idx - b.idx;
    });

    const parent = products[0].node.parentElement;
    if (!parent) { alert("❌ Parent container not found!"); return; }

    data.forEach((d, rank) => addBadge(d.node, d.ratings, rank, d.sponsored));
    data.forEach((d) => parent.appendChild(d.node));

    state.sorted = true;
    updateSortBtn();

    const ads = data.filter((d) => d.sponsored).length;
    toast("✅ " + data.length + " products sorted!\n🏆 Top: " + fmt(data[0].ratings) + " ratings\n📢 AD: " + ads + " (last e)");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function restoreOriginal() {
    if (!state.originalOrder.length) return;
    document.querySelectorAll(".fs-badge").forEach((el) => el.remove());
    const parent = state.originalOrder[0].parentElement;
    if (!parent) return;
    state.originalOrder.forEach((node) => parent.appendChild(node));
    state.sorted = false;
    state.originalOrder = [];
    state.allProducts = [];
    updateSortBtn();
    toast("🔄 Original order restored!");
  }

  function addBadge(node, ratings, rank, sponsored) {
    const old = node.querySelector(".fs-badge");
    if (old) old.remove();
    const b = document.createElement("div");
    b.className = "fs-badge";
    b.style.cssText =
      "position:absolute;top:8px;right:8px;z-index:9999;color:#fff;font:700 12px/1 Arial,sans-serif;" +
      "padding:5px 9px;border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:none;" +
      "background:" + (sponsored ? "#9e9e9e" : "linear-gradient(135deg,#ff9800,#f57c00)") + ";";
    b.textContent = sponsored ? "📢 AD" : "⭐ " + fmt(ratings);
    b.title = "Ratings: " + ratings.toLocaleString("en-IN") + " • Rank #" + (rank + 1);
    node.style.position = "relative";
    node.appendChild(b);
  }

  // ─── Main ───
  async function sortByRatings() {
    if (!state.enabled || state.scanning) return;
    if (state.sorted) { restoreOriginal(); return; }

    const perPage = IS_FLIPKART ? 40 : 50;
    const input = prompt(
      (IS_FLIPKART ? "Flipkart" : "Myntra") + ": কত PAGE scan করবে?\n\n" +
      "প্রতি page = " + perPage + " products\n" +
      "10 page = " + (perPage * 10) + " | 50 page = " + (perPage * 50) + "\n\nসংখ্যা লেখো:",
      "10"
    );
    if (input === null) return;
    const maxPages = parseInt(input.trim(), 10);
    if (!maxPages || maxPages < 1) { alert("❌ সঠিক সংখ্যা দাও!"); return; }

    const products = await fetchAllPages(maxPages);
    if (!products.length) { alert("❌ কোনো product collect হয়নি!"); return; }

    if (products.length <= perPage) {
      toast("⚠️ শুধু current page collect হয়েছে (" + products.length + ")\nSite multi-page block করছে। Console log দেখো (F12)");
    }

    sortAndRearrange(products);
  }

  // ─── UI ───
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
      if (state.sorted) restoreOriginal();
      if (state.sortBtn) { state.sortBtn.remove(); state.sortBtn = null; }
      hideStopBtn();
      toast("🔴 OFF");
    } else { createSortButton(); toast("🟢 ON"); }
    updatePill();
  }

  function createSortButton() {
    if (state.sortBtn || !state.enabled) return;
    const b = document.createElement("div");
    b.style.cssText =
      "position:fixed;right:26px;bottom:30px;z-index:2147483647;cursor:pointer;user-select:none;" +
      "color:#fff;border-radius:30px;padding:13px 22px;font:700 14px Arial,sans-serif;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.35);";
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

  // ─── SPA cleanup ───
  (function watchURL() {
    let last = location.href;
    new MutationObserver(() => {
      if (location.href !== last) {
        last = location.href;
        if (state.sorted) restoreOriginal();
      }
    }).observe(document.body, { childList: true, subtree: true });
  })();

  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (state.enabled) sortByRatings();
    }
  });

  function init() {
    createPill();
    if (!state.enabled) return;
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (getProductsFromDOM().length > 0 || Date.now() - t0 > 20000) {
        clearInterval(iv);
        createSortButton();
      }
    }, 1000);
  }

  init();
})();
