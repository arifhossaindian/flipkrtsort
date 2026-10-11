// ============================================
// SORT BY RATINGS v18 - OWN GRID RENDER
// Site layout এ হাত দেয় না → নিজের clean grid বানায়
// Live log panel: প্রতি page এর status দেখাবে
// ============================================

(function () {
  "use strict";
  if (window.__flipSortLoaded) return;
  window.__flipSortLoaded = true;

  const HOST = location.hostname.replace(/^www\./, "");
  const IS_FLIPKART = HOST.indexOf("flipkart.com") !== -1;
  const IS_MYNTRA = HOST.indexOf("myntra.com") !== -1;
  if (!IS_FLIPKART && !IS_MYNTRA) return;

  const LS_KEY = "sortratings_enabled_v18";
  const CHUNK = 200;

  const state = {
    enabled: localStorage.getItem(LS_KEY) !== "0",
    sorted: false,
    scanning: false,
    stop: false,
    data: [],
    rendered: 0,
    wrap: null,
    hiddenEls: [],
    pill: null,
    sortBtn: null,
    stopBtn: null,
    logBox: null,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function parseDigits(t) {
    const d = String(t == null ? "" : t).replace(/[^0-9]/g, "");
    if (!d || d.length > 8) return 0;
    const n = parseInt(d, 10);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  function parseK(t) {
    let s = String(t || "").trim().toLowerCase().replace(/^[^0-9]+/, "");
    const m = s.match(/^([\d.]+)\s*(k|m|l)?/);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    if (!isFinite(n) || n < 0) return 0;
    if (m[2] === "k") n *= 1000;
    else if (m[2] === "m") n *= 1000000;
    else if (m[2] === "l") n *= 100000;
    n = Math.round(n);
    return n <= 99999999 ? n : 0;
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
    t._timer = setTimeout(() => (t.style.opacity = "0"), 4000);
  }

  // ─── Live log panel ───
  function logLine(msg) {
    if (!state.logBox) {
      state.logBox = document.createElement("div");
      state.logBox.style.cssText =
        "position:fixed;left:12px;bottom:12px;z-index:2147483647;width:280px;max-height:200px;" +
        "overflow:auto;background:rgba(10,10,10,.92);color:#7CFC00;font:11px/1.5 monospace;" +
        "padding:10px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.4);";
      document.body.appendChild(state.logBox);
    }
    const line = document.createElement("div");
    line.textContent = msg;
    state.logBox.appendChild(line);
    state.logBox.scrollTop = state.logBox.scrollHeight;
  }
  function hideLogLater(sec) {
    setTimeout(() => {
      if (state.logBox) { state.logBox.remove(); state.logBox = null; }
    }, sec * 1000);
  }

  // ─── Card data extract (lightweight, no outerHTML) ───
  function cardData(el) {
    if (IS_MYNTRA) {
      const id = el.getAttribute("id") || "";
      const a = el.querySelector("a[href]");
      let href = "";
      try { href = a ? new URL(a.getAttribute("href"), location.origin).href : ""; } catch (e) {}
      const img = el.querySelector("img");
      const rc = el.querySelector(".product-ratingsCount");
      let ratings = rc ? parseK(rc.textContent) : 0;
      if (!ratings) {
        const m = (el.textContent || "").match(/\|\s*([\d.]+[kKmM]?)/);
        if (m) ratings = parseK(m[1]);
      }
      const w = el.querySelector(".product-waterMark");
      return {
        id,
        href,
        img: img ? (img.src || img.getAttribute("data-src") || "") : "",
        brand: (el.querySelector(".product-brand") || {}).textContent || "",
        name: (el.querySelector(".product-product") || {}).textContent || "",
        price: ((el.querySelector(".product-discountedPrice") || {}).textContent || "").trim(),
        ratings,
        sponsored: w ? /AD/i.test(w.textContent || "") : false,
      };
    }
    // Flipkart
    const id = el.getAttribute("data-id") || "";
    const a = el.querySelector('a[href*="/p/"]');
    const img = el.querySelector("img");
    const s = el.querySelector("span.PvbNMB");
    let ratings = s ? parseDigits(s.textContent) : 0;
    if (!ratings) {
      const m = (el.textContent || "").match(/\(([\d,]+)\)/);
      if (m) ratings = parseDigits(m[1]);
    }
    const pm = (el.textContent || "").match(/₹[\d,]+/);
    return {
      id,
      href: a ? a.href : "",
      img: img ? (img.src || img.getAttribute("data-src") || "") : "",
      brand: "",
      name: (el.querySelector("a[title]") || {}).title || "",
      price: pm ? pm[0] : "",
      ratings,
      sponsored: !!el.querySelector(".IxWX8O"),
    };
  }

  function productEls(doc) {
    if (IS_MYNTRA) {
      return Array.from(doc.querySelectorAll("li.product-base")).filter((el) =>
        !!el.querySelector(".product-ratingsContainer") || !!el.querySelector("img")
      );
    }
    return Array.from(doc.querySelectorAll("div[data-id]")).filter((el) => {
      if (el.querySelector("div[data-id]")) return false;
      if (!el.querySelector('a[href*="/p/"]')) return false;
      return (el.textContent || "").indexOf("₹") !== -1 && !!el.querySelector("img");
    });
  }

  // ─── Fetch pages with rel=next chain + logs ───
  async function collect(maxPages) {
    state.scanning = true;
    state.stop = false;
    state.data = [];
    const seen = new Set();
    showStopBtn();
    logLine("== scan start ==");

    productEls(document).forEach((el) => {
      const d = cardData(el);
      if (d.id && !seen.has(d.id)) { seen.add(d.id); state.data.push(d); }
    });
    logLine("page 1 (current): " + state.data.length);

    const base = location.href.replace(/([?&])(page|p)=\d+&?/g, "$1").replace(/[?&]$/, "");
    const sep = base.indexOf("?") !== -1 ? "&" : "?";
    const param = IS_FLIPKART ? "page" : "p";

    const nextOf = (doc) => {
      const l = doc.querySelector('link[rel="next"]');
      if (!l) return null;
      try { return new URL(l.getAttribute("href"), doc.baseURI || location.href).href; } catch (e) { return null; }
    };

    let url = nextOf(document) || base + sep + param + "=2";
    let pageNum = 2, failStreak = 0;

    while (url && pageNum <= maxPages && !state.stop && failStreak < 3) {
      logLine("fetch page " + pageNum + "...");
      let html = null, status = 0;
      try {
        const res = await fetch(url, { credentials: "include", redirect: "follow" });
        status = res.status;
        if (res.ok) html = await res.text();
      } catch (e) { status = -1; }

      if (!html) {
        failStreak++;
        logLine("page " + pageNum + ": FAIL (HTTP " + status + ")");
        url = base + sep + param + "=" + (pageNum + 1);
        pageNum++;
        await sleep(1200);
        continue;
      }

      const doc = new DOMParser().parseFromString(html, "text/html");
      let fresh = 0;
      productEls(doc).forEach((el) => {
        const d = cardData(el);
        if (d.id && !seen.has(d.id)) { seen.add(d.id); state.data.push(d); fresh++; }
      });
      logLine("page " + pageNum + ": +" + fresh + " (total " + state.data.length + ")");

      if (!fresh) failStreak++; else failStreak = 0;
      url = nextOf(doc) || (fresh ? base + sep + param + "=" + (pageNum + 1) : null);
      pageNum++;
      await sleep(600);
    }

    state.scanning = false;
    hideStopBtn();
    logLine("== done: " + state.data.length + " products ==");
    hideLogLater(12);
    return state.data;
  }

  // ─── Own clean grid render ───
  function cardEl(d) {
    const a = document.createElement("a");
    a.className = "fs-card";
    a.href = d.href || "#";
    a.target = "_blank";
    a.rel = "noopener";
    a.innerHTML =
      '<img loading="lazy" src="' + (d.img || "") + '" alt="">' +
      '<div class="fs-rate">⭐ ' + fmt(d.ratings) + "</div>" +
      (d.sponsored ? '<div class="fs-ad">AD</div>' : "") +
      '<div class="fs-info">' +
      (d.brand ? '<div class="fs-brand"></div>' : "") +
      '<div class="fs-name"></div>' +
      (d.price ? '<div class="fs-price"></div>' : "") +
      "</div>";
    const q = (s) => a.querySelector(s);
    if (d.brand) q(".fs-brand").textContent = d.brand.trim();
    q(".fs-name").textContent = (d.name || "").trim();
    if (d.price) q(".fs-price").textContent = d.price;
    return a;
  }

  function injectCSS() {
    if (document.getElementById("fs-css")) return;
    const s = document.createElement("style");
    s.id = "fs-css";
    s.textContent =
      ".fs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;padding:14px;background:#fff;}" +
      ".fs-card{position:relative;display:block;background:#fff;border:1px solid #eaeaec;border-radius:6px;overflow:hidden;text-decoration:none;color:#282c3f;}" +
      ".fs-card:hover{box-shadow:0 3px 12px rgba(0,0,0,.15);}" +
      ".fs-card img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;background:#f5f5f6;}" +
      ".fs-rate{position:absolute;top:6px;left:6px;background:rgba(255,255,255,.95);color:#282c3f;font:700 11px/1 Arial;padding:5px 7px;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.2);}" +
      ".fs-ad{position:absolute;top:6px;right:6px;background:#9e9e9e;color:#fff;font:700 10px/1 Arial;padding:4px 6px;border-radius:4px;}" +
      ".fs-info{padding:8px 10px 12px;font:12px/1.35 Arial,sans-serif;}" +
      ".fs-brand{font-weight:700;margin-bottom:2px;}" +
      ".fs-name{color:#535766;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}" +
      ".fs-price{font-weight:700;margin-top:6px;}" +
      ".fs-bar{display:flex;align-items:center;gap:12px;background:#fff;border-bottom:1px solid #eaeaec;padding:10px 14px;font:600 14px Arial;}" +
      ".fs-more{display:block;margin:16px auto;padding:12px 30px;background:#2874f0;color:#fff;border:none;border-radius:22px;font:600 14px Arial;cursor:pointer;}";
    document.head.appendChild(s);
  }

  function render() {
    injectCSS();

    // Hide originals (remove না!)
    state.hiddenEls = [];
    let anchor = null;
    if (IS_MYNTRA) {
      anchor = document.getElementById("desktopSearchResults");
      if (!anchor) {
        const ul = document.querySelector("ul.results-base");
        anchor = ul ? ul.parentElement : null;
      }
    } else {
      const rows = Array.from(document.querySelectorAll("div.nZIRY7"))
        .filter((r) => r.querySelector('div[data-id] a[href*="/p/"]'));
      const secs = [];
      rows.forEach((r) => {
        const s = r.closest(".lvJbLV.col-12-12") || r.parentElement;
        if (s && secs.indexOf(s) === -1) secs.push(s);
      });
      secs.forEach((s) => { s.style.display = "none"; state.hiddenEls.push(s); });
      anchor = secs[0] || null;
    }
    if (anchor) {
      if (state.hiddenEls.indexOf(anchor) === -1 && IS_MYNTRA) {
        anchor.style.display = "none";
        state.hiddenEls.push(anchor);
      }
    }

    // Our container
    const wrap = document.createElement("div");
    wrap.id = "fs-wrap";
    wrap.style.cssText = "background:#fff;";
    const bar = document.createElement("div");
    bar.className = "fs-bar";
    const ads = state.data.filter((d) => d.sponsored).length;
    bar.textContent =
      "⭐ Sorted by most rated — " + state.data.length + " products (" + ads + " AD last e)";
    wrap.appendChild(bar);
    const grid = document.createElement("div");
    grid.className = "fs-grid";
    wrap.appendChild(grid);

    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(wrap, anchor);
    else document.body.appendChild(wrap);
    state.wrap = wrap;
    state.rendered = 0;
    appendChunk();
  }

  function appendChunk() {
    const grid = state.wrap.querySelector(".fs-grid");
    const end = Math.min(state.rendered + CHUNK, state.data.length);
    const frag = document.createDocumentFragment();
    for (let i = state.rendered; i < end; i++) frag.appendChild(cardEl(state.data[i]));
    state.rendered = end;
    const old = state.wrap.querySelector(".fs-more");
    if (old) old.remove();
    grid.appendChild(frag);
    if (state.rendered < state.data.length) {
      const b = document.createElement("button");
      b.className = "fs-more";
      b.textContent = "⬇️ Load more (" + state.rendered + "/" + state.data.length + ")";
      b.onclick = appendChunk;
      state.wrap.appendChild(b);
    }
  }

  function restore(silent) {
    if (state.wrap) { state.wrap.remove(); state.wrap = null; }
    state.hiddenEls.forEach((el) => { if (el.isConnected) el.style.display = ""; });
    state.hiddenEls = [];
    state.data = [];
    state.rendered = 0;
    state.sorted = false;
    updateSortBtn();
    if (!silent) toast("🔄 Original page restored!");
  }

  async function sortByRatings() {
    if (!state.enabled || state.scanning) return;
    if (state.sorted) { restore(false); return; }

    const per = IS_FLIPKART ? 40 : 50;
    const input = prompt(
      (IS_FLIPKART ? "Flipkart" : "Myntra") + ": কত PAGE scan করবে?\n" +
      "(প্রতি page = " + per + " products)\n\n" +
      "5 = " + per * 5 + " | 20 = " + per * 20 + " | 100 = " + per * 100 + "\n\nসংখ্যা লেখো:",
      "5"
    );
    if (input === null) return;
    const maxPages = parseInt(input.trim(), 10);
    if (!maxPages || maxPages < 1) { alert("❌ সঠিক সংখ্যা দাও!"); return; }

    const data = await collect(maxPages);
    if (!data.length) { alert("❌ কোনো product পাইনি!"); return; }

    data.sort((a, b) => {
      if (a.sponsored !== b.sponsored) return a.sponsored ? 1 : -1;
      return b.ratings - a.ratings;
    });

    render();
    state.sorted = true;
    updateSortBtn();
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast("✅ " + data.length + " products sorted!\n🏆 Top: " + fmt(data[0].ratings) + " ratings");
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
      if (state.sorted) restore(true);
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

  (function watchURL() {
    let last = location.href;
    new MutationObserver(() => {
      if (location.href !== last) {
        last = location.href;
        if (state.sorted || state.wrap) restore(true);
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
      const has = IS_MYNTRA
        ? document.querySelector("li.product-base")
        : document.querySelector('div[data-id] a[href*="/p/"]');
      if (has || Date.now() - t0 > 20000) { clearInterval(iv); createSortButton(); }
    }, 1000);
  }
  init();
})();
