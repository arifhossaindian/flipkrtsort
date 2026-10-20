// ==UserScript==
// @name         Sort by Ratings - Flipkart, Myntra & Amazon
// @namespace    sortratings
// @version      21.2.0
// @description  Sort products by most ratings on Flipkart, Myntra & Amazon. Page-fetch primary + scroll bonus + Load More auto-click. Anti-block with slow delays & retry.
// @author       you
// @match        *://www.flipkart.com/*
// @match        *://flipkart.com/*
// @match        *://www.myntra.com/*
// @match        *://myntra.com/*
// @match        *://www.amazon.in/*
// @match        *://amazon.in/*
// @grant        GM_xmlhttpRequest
// @connect      flipkart.com
// @connect      myntra.com
// @connect      amazon.in
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";
  if (window.__flipSortLoaded) return;
  window.__flipSortLoaded = true;

  var HOST = location.hostname.replace(/^www\./, "");
  var IS_FLIPKART = HOST.indexOf("flipkart.com") !== -1;
  var IS_MYNTRA = HOST.indexOf("myntra.com") !== -1;
  var IS_AMAZON =
    HOST.indexOf("amazon.in") !== -1 || HOST.indexOf("amazon.com") !== -1;
  if (!IS_FLIPKART && !IS_MYNTRA && !IS_AMAZON) return;

  var CHUNK = 200;
  var PER_PAGE = IS_FLIPKART ? 40 : IS_MYNTRA ? 50 : IS_AMAZON ? 60 : 40;

  var state = {
    sorted: false,
    scanning: false,
    abort: false,
    data: [],
    rendered: 0,
    wrap: null,
    hiddenEls: [],
    sortBtn: null,
    stopBtn: null,
    logBox: null,
  };

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var rand = function (min, max) { return Math.floor(min + Math.random() * (max - min)); };

  // ---------- number helpers ----------
  function parseDigits(t) {
    var d = String(t == null ? "" : t).replace(/[^0-9]/g, "");
    if (!d || d.length > 8) return 0;
    var n = parseInt(d, 10);
    return isFinite(n) && n >= 0 ? n : 0;
  }
  function parseK(t) {
    var s = String(t == null ? "" : t).trim().toLowerCase().replace(/^[^0-9]+/, "");
    var m = s.match(/^([\d.]+)\s*(k|m|l)?/);
    if (!m) return 0;
    var n = parseFloat(m[1]);
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
  function cleanStr(s) {
    return String(s)
      .replace(/\\u002F/gi, "/")
      .replace(/\\\//g, "/")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  function httpsify(u) {
    return String(u || "").replace(/^http:/, "https:");
  }

  // ---------- UI: toast ----------
  function toast(msg) {
    var t = document.getElementById("fs-toast");
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
    t._timer = setTimeout(function () { t.style.opacity = "0"; }, 5000);
  }

  // ---------- UI: log box ----------
  function logLine(msg) {
    if (!state.logBox) {
      state.logBox = document.createElement("div");
      state.logBox.style.cssText =
        "position:fixed;left:12px;bottom:12px;z-index:2147483647;width:340px;max-height:260px;" +
        "overflow:auto;background:rgba(10,10,10,.92);color:#7CFC00;font:11px/1.5 monospace;" +
        "padding:10px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.4);";
      document.body.appendChild(state.logBox);
    }
    var line = document.createElement("div");
    line.textContent = msg;
    state.logBox.appendChild(line);
    state.logBox.scrollTop = state.logBox.scrollHeight;
  }
  function hideLogLater(sec) {
    setTimeout(function () {
      if (state.logBox) { state.logBox.remove(); state.logBox = null; }
    }, sec * 1000);
  }

  // ============================================
  // MYNTRA embedded JSON parser
  // ============================================
  function parseJsonProducts(doc) {
    var map = new Map();
    var scripts = doc.querySelectorAll("script");
    for (var si = 0; si < scripts.length; si++) {
      var txt = scripts[si].textContent || "";
      if (txt.indexOf('"productId":') === -1 || txt.indexOf('"ratingCount":') === -1) continue;
      var re = /"productId":(\d+)/g;
      var m;
      while ((m = re.exec(txt))) {
        var id = m[1];
        if (map.has(id)) continue;
        var start = m.index;
        var nextIdx = txt.indexOf('"productId":', start + 10);
        var end = nextIdx === -1 ? start + 3000 : nextIdx;
        var chunk = txt.slice(start, end);
        var pre = txt.slice(Math.max(0, start - 900), start);

        var rc = chunk.match(/"ratingCount":(\d+)/);
        var im = chunk.match(/"searchImage":"([^"]+)"/);
        var pla = chunk.match(/"isPLA":(true|false)/);
        var adsrc = chunk.match(/"adSource":"([^"]*)"/);
        var br = chunk.match(/"brand":"([^"]*)"/);
        var nm = chunk.match(/"product":"([^"]*)"/);
        var lp = pre.match(/"landingPageUrl":"([^"]+)"/);

        map.set(id, {
          ratings: rc ? (parseInt(rc[1], 10) || 0) : 0,
          img: im ? httpsify(cleanStr(im[1])) : "",
          sponsored: pla ? pla[1] === "true" : false,
          adSource: adsrc ? cleanStr(adsrc[1]) : "",
          brand: br ? cleanStr(br[1]) : "",
          name: nm ? cleanStr(nm[1]) : "",
          href: lp ? cleanStr(lp[1]) : "",
        });
      }
    }
    return map;
  }

  // ============================================
  // Card data — per site (JSON + DOM merge)
  // ============================================
  function cardData(el, map) {
    if (IS_MYNTRA) {
      var id = el.getAttribute("id") || "";
      var j = (map && map.get(id)) || null;
      var a = el.querySelector("a[href]");
      var href = "";
      try { href = a ? new URL(a.getAttribute("href"), location.origin).href : ""; } catch (e) {}
      if (!href && j && j.href) {
        try { href = new URL(j.href, location.origin).href; } catch (e) {}
      }
      var img = el.querySelector("img");
      var domImg = img ? (img.src || img.getAttribute("data-src") || "") : "";
      domImg = httpsify(domImg);

      var rc = el.querySelector(".product-ratingsCount");
      var domRatings = rc ? parseK(rc.textContent) : 0;
      if (!domRatings) {
        var m2 = (el.textContent || "").match(/\|\s*([\d.]+[kKmM]?)/);
        if (m2) domRatings = parseK(m2[1]);
      }
      var w = el.querySelector(".product-waterMark");
      var domAd = w ? /AD/i.test(w.textContent || "") : false;

      return {
        id: id,
        href: href,
        img: (j && j.img) ? j.img : domImg,
        brand: (j && j.brand) ? j.brand : ((el.querySelector(".product-brand") || {}).textContent || ""),
        name: (j && j.name) ? j.name : ((el.querySelector(".product-product") || {}).textContent || ""),
        price: ((el.querySelector(".product-discountedPrice") || {}).textContent || "").trim(),
        ratings: (j && j.ratings > 0) ? j.ratings : domRatings,
        sponsored: domAd || (j ? (j.sponsored || /PLA|AD/i.test(j.adSource || "")) : false),
      };
    }

    if (IS_AMAZON) {
      var asin = el.getAttribute("data-asin") || "";
      var aLink = el.querySelector('a[href*="/dp/"], a[href*="/gp/product"], h2 a[href]');
      var aHref = "";
      try { aHref = aLink ? new URL(aLink.getAttribute("href") || aLink.href, location.origin).href : ""; } catch (e) {}
      var aImg = el.querySelector("img.s-image, img");
      var aImgSrc = aImg ? (aImg.src || aImg.getAttribute("src") || "") : "";
      aImgSrc = httpsify(aImgSrc);

      var titleEl = el.querySelector("h2 a span, h2 span, .a-text-normal");
      var aName = titleEl ? (titleEl.textContent || "").trim() : "";

      var aRatings = 0;
      var rcA = el.querySelector("span.a-size-base.s-underline-text, span.s-underline-text");
      if (rcA) aRatings = parseDigits(rcA.textContent);
      if (!aRatings) {
        var rcA2 = el.querySelector('a[href*="#customerReviews"] span, a[href*="/product-reviews/"] span');
        if (rcA2) aRatings = parseDigits(rcA2.textContent);
      }
      if (!aRatings) {
        var am = (el.textContent || "").match(/([\d,]+)\s*(?:global|ratings|reviews)/i);
        if (am) aRatings = parseDigits(am[1]);
      }

      var priceEl = el.querySelector("span.a-price span.a-offscreen, span.a-color-price");
      var aPrice = priceEl ? (priceEl.textContent || "").trim() : "";

      var aSponsored = /sponsored|sponsor/i.test(el.textContent || "") ||
        !!el.querySelector(".s-label-popover-default, .puis-label-popover-default");

      return {
        id: asin,
        href: aHref,
        img: aImgSrc,
        brand: "",
        name: aName,
        price: aPrice,
        ratings: aRatings,
        sponsored: aSponsored,
      };
    }

    // Flipkart
    var fid = el.getAttribute("data-id") || "";
    var fa = el.querySelector('a[href*="/p/"]');
    var fimg = el.querySelector("img");
    var fs = el.querySelector("span.PvbNMB");
    var fratings = fs ? parseDigits(fs.textContent) : 0;
    if (!fratings) {
      var fm = (el.textContent || "").match(/\(([\d,]+)\)/);
      if (fm) fratings = parseDigits(fm[1]);
    }
    var fpm = (el.textContent || "").match(/₹[\d,]+/);
    return {
      id: fid,
      href: fa ? fa.href : "",
      img: httpsify(fimg ? (fimg.src || fimg.getAttribute("data-src") || "") : ""),
      brand: "",
      name: (el.querySelector("a[title]") || {}).title || "",
      price: fpm ? fpm[0] : "",
      ratings: fratings,
      sponsored: !!el.querySelector(".IxWX8O"),
    };
  }

  function productEls(doc) {
    if (IS_MYNTRA) return Array.from(doc.querySelectorAll("li.product-base"));
    if (IS_AMAZON) {
      return Array.from(
        doc.querySelectorAll(
          'div[data-component-type="s-search-result"][data-asin]:not([data-asin=""]), div.s-result-item[data-asin]:not([data-asin=""])'
        )
      ).filter(function (el) {
        return !!el.querySelector("img") && !!el.querySelector("h2");
      });
    }
    return Array.from(doc.querySelectorAll("div[data-id]")).filter(function (el) {
      if (el.querySelector("div[data-id]")) return false;
      if (!el.querySelector('a[href*="/p/"]')) return false;
      return (el.textContent || "").indexOf("₹") !== -1 && !!el.querySelector("img");
    });
  }

  function extractLive() {
    var map = IS_MYNTRA ? parseJsonProducts(document) : null;
    return productEls(document).map(function (el) { return cardData(el, map); });
  }

  function extractFromHtml(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var map = IS_MYNTRA ? parseJsonProducts(doc) : null;
    var els = productEls(doc);
    return { products: els.map(function (el) { return cardData(el, map); }), count: els.length };
  }

  function detectBlocked(text) {
    var t = String(text || "").slice(0, 5000);
    return /captcha|verify you are human|unusual traffic|access denied|are you a robot|blocked|robot check|type the characters/i.test(t);
  }
  function detectNoResults(text) {
    var t = String(text || "").slice(0, 5000);
    return /no\s+(products|results|matches)\s+found|sorry!?\s*no\s+results|no\s+more\s+results|did not match any products/i.test(t);
  }

  // ============================================
  // Find & click "Load More" buttons (helps lazy-load)
  // ============================================
  function clickLoadMore() {
    var candidates = document.querySelectorAll("button, a, div[role='button'], span, li");
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var txt = ((el.textContent || "") + " " + (el.className || "") + " " + (el.getAttribute("aria-label") || "")).toLowerCase();
      if (/load\s*more|show\s*more|view\s*more|see\s*more|next\s*page|more\s*results/i.test(txt)) {
        var rect = el.getBoundingClientRect();
        // only click if visible and in lower half of viewport area
        if (rect.width > 30 && rect.height > 10 && rect.top > 200) {
          try { el.click(); return true; } catch (e) {}
        }
      }
    }
    return false;
  }

  // ============================================
  // METHOD 1 — PAGE FETCH (PRIMARY)
  // Fetches ?p=2, ?p=3... via GM_xmlhttpRequest
  // Anti-block: slow random delay, retry on empty, 5-strike rule
  // ============================================
  function fetchPage(url) {
    return new Promise(function (resolve) {
      try {
        GM_xmlhttpRequest({
          method: "GET",
          url: url,
          timeout: 25000,
          headers: {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,hi;q=0.8,bn;q=0.7",
          },
          onload: function (resp) { resolve({ text: resp.responseText || "", status: resp.status }); },
          onerror: function () { resolve({ text: "", status: 0 }); },
          ontimeout: function () { resolve({ text: "", status: 0 }); },
        });
      } catch (e) { resolve({ text: "", status: 0 }); }
    });
  }

  function buildPageUrl(p) {
    var base = location.href.replace(/([?&])(page|p)=\d+&?/g, "$1").replace(/[?&]$/, "");
    var sep = base.indexOf("?") !== -1 ? "&" : "?";
    var param = IS_FLIPKART || IS_AMAZON ? "page" : "p";
    return base + sep + param + "=" + p;
  }

  async function startPageScan(maxPages, seen) {
    var consecutiveEmpty = 0;
    var blocked = false;
    var delayBase = 4000; // 4s base, grows with empties

    logLine("== PAGE FETCH start (pages 2-" + maxPages + ") ==");
    toast("📡 Fetching pages 2 to " + maxPages + "…\n(slow delay — anti block)");

    for (var p = 2; p <= maxPages; p++) {
      if (state.abort) break;
      if (blocked) break;

      var url = buildPageUrl(p);
      var res = await fetchPage(url);
      var html = res.text;

      if (!html) {
        logLine("page " + p + ": ❌ fetch failed (network/timeout)");
        consecutiveEmpty++;
        if (consecutiveEmpty >= 5) { logLine("5 fetch fails — stopping"); break; }
        await sleep(rand(8000, 14000));
        continue;
      }
      if (detectBlocked(html)) {
        logLine("page " + p + ": 🛑 BLOCKED (captcha)");
        toast("🛑 Blocked at page " + p + "!\nSwitching to scroll method…");
        blocked = true;
        break;
      }
      if (detectNoResults(html)) { logLine("page " + p + ": no more results — done"); break; }

      var ex = extractFromHtml(html);
      var added = 0;
      for (var k = 0; k < ex.products.length; k++) {
        var d = ex.products[k];
        if (d.id && !seen.has(d.id)) { seen.add(d.id); state.data.push(d); added++; }
      }

      // Diagnose: if fetched HTML had products but all were dupes → site returned same page
      var dupeNote = (ex.count > 0 && added === 0) ? " (all dupes — site returned same page)" : "";
      logLine("page " + p + ": html " + html.length + "b, " + ex.count + " cards, +" + added + " new (total " + state.data.length + ")" + dupeNote);

      if (added === 0) {
        consecutiveEmpty++;
        // Retry once with long delay
        if (consecutiveEmpty < 3) {
          logLine("  → retrying page " + p + " after long delay…");
          await sleep(rand(12000, 20000));
          if (state.abort) break;
          var res2 = await fetchPage(url);
          var ex2 = res2.text ? extractFromHtml(res2.text) : { products: [], count: 0 };
          var added2 = 0;
          for (var j = 0; j < ex2.products.length; j++) {
            var d2 = ex2.products[j];
            if (d2.id && !seen.has(d2.id)) { seen.add(d2.id); state.data.push(d2); added2++; }
          }
          if (added2 > 0) { logLine("  retry: +" + added2 + " (total " + state.data.length + ")"); consecutiveEmpty = 0; }
        }
        if (consecutiveEmpty >= 5) { logLine("5 consecutive empty — stopping page fetch"); break; }
      } else {
        consecutiveEmpty = 0;
      }

      // Adaptive delay — grows if we've been seeing empties
      var delay = delayBase + (consecutiveEmpty * 2000) + rand(0, 3000);
      if (p < maxPages) await sleep(delay);
    }

    return blocked;
  }

  // ============================================
  // METHOD 2 — SCROLL + Load More (BONUS)
  // For lazy-loaded extras the page-fetch might miss
  // ============================================
  async function startScrollScan(maxScrolls, seen) {
    var stuckCount = 0;

    logLine("== SCROLL BONUS start (max " + maxScrolls + ") ==");
    toast("🔄 Scrolling for lazy-loaded extras…");

    for (var i = 0; i < maxScrolls; i++) {
      if (state.abort) break;

      var beforeHeight = document.body.scrollHeight;
      var beforeCount = state.data.length;

      // Try clicking Load More button first
      var clicked = clickLoadMore();

      // Scroll to bottom in steps
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(900);
      window.scrollTo(0, document.body.scrollHeight);
      // Longer wait for lazy load to complete
      await sleep(2500);

      // Also scroll a bit back up & down (triggers some lazy loaders)
      window.scrollTo(0, document.body.scrollHeight - 300);
      await sleep(500);
      window.scrollTo(0, document.body.scrollHeight);

      var live = extractLive();
      var added = 0;
      for (var k = 0; k < live.length; k++) {
        var d = live[k];
        if (d.id && !seen.has(d.id)) { seen.add(d.id); state.data.push(d); added++; }
      }

      var afterHeight = document.body.scrollHeight;
      logLine("scroll " + (i + 1) + (clicked ? " [LoadMore]" : "") + ": +" + added + " (total " + state.data.length + ") h:" + beforeHeight + "→" + afterHeight);

      if (added === 0 && afterHeight <= beforeHeight && !clicked) {
        stuckCount++;
        if (stuckCount >= 5) { logLine("scroll: no more after 5 tries — done"); break; }
      } else {
        stuckCount = 0;
      }

      if (detectBlocked(document.body.innerText)) { logLine("scroll: captcha — stop"); break; }
    }
  }

  // ============================================
  // Own grid (render)
  // ============================================
  function injectCSS() {
    if (document.getElementById("fs-css")) return;
    var s = document.createElement("style");
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
      ".fs-bar{background:#fff;border-bottom:1px solid #eaeaec;padding:10px 14px;font:600 14px Arial;}" +
      ".fs-more{display:block;margin:16px auto;padding:12px 30px;background:#2874f0;color:#fff;border:none;border-radius:22px;font:600 14px Arial;cursor:pointer;}";
    document.head.appendChild(s);
  }

  function cardEl(d) {
    var a = document.createElement("a");
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
    var q = function (s) { return a.querySelector(s); };
    if (d.brand) q(".fs-brand").textContent = d.brand.trim();
    q(".fs-name").textContent = (d.name || "").trim();
    if (d.price) q(".fs-price").textContent = d.price;
    return a;
  }

  function render() {
    injectCSS();
    state.hiddenEls = [];
    var anchor = null;

    if (IS_MYNTRA) {
      anchor = document.getElementById("desktopSearchResults");
      if (!anchor) { var ul = document.querySelector("ul.results-base"); anchor = ul ? ul.parentElement : null; }
      if (anchor) { anchor.style.display = "none"; state.hiddenEls.push(anchor); }
    } else if (IS_AMAZON) {
      var main = document.querySelector('div[data-component-type="s-search-results"], div.s-main-slot, div.s-result-list');
      if (main) { main.style.display = "none"; state.hiddenEls.push(main); }
      anchor = main;
    } else {
      var rows = Array.from(document.querySelectorAll("div.nZIRY7"))
        .filter(function (r) { return r.querySelector('div[data-id] a[href*="/p/"]'); });
      var secs = [];
      rows.forEach(function (r) {
        var s = r.closest(".lvJbLV.col-12-12") || r.parentElement;
        if (s && secs.indexOf(s) === -1) secs.push(s);
      });
      secs.forEach(function (s) { s.style.display = "none"; state.hiddenEls.push(s); });
      anchor = secs[0] || null;
    }

    var wrap = document.createElement("div");
    wrap.id = "fs-wrap";
    var bar = document.createElement("div");
    bar.className = "fs-bar";
    var ads = state.data.filter(function (d) { return d.sponsored; }).length;
    bar.textContent = "⭐ Sorted by most rated — " + state.data.length + " products (" + ads + " AD at end)";
    wrap.appendChild(bar);
    var grid = document.createElement("div");
    grid.className = "fs-grid";
    wrap.appendChild(grid);

    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(wrap, anchor);
    else document.body.appendChild(wrap);
    state.wrap = wrap;
    state.rendered = 0;
    appendChunk();
  }

  function appendChunk() {
    var grid = state.wrap.querySelector(".fs-grid");
    var end = Math.min(state.rendered + CHUNK, state.data.length);
    var frag = document.createDocumentFragment();
    for (var i = state.rendered; i < end; i++) frag.appendChild(cardEl(state.data[i]));
    state.rendered = end;
    var old = state.wrap.querySelector(".fs-more");
    if (old) old.remove();
    grid.appendChild(frag);
    if (state.rendered < state.data.length) {
      var b = document.createElement("button");
      b.className = "fs-more";
      b.textContent = "⬇️ Load more (" + state.rendered + "/" + state.data.length + ")";
      b.onclick = appendChunk;
      state.wrap.appendChild(b);
    }
  }

  function restore(silent) {
    if (state.wrap) { state.wrap.remove(); state.wrap = null; }
    state.hiddenEls.forEach(function (el) { if (el.isConnected) el.style.display = ""; });
    state.hiddenEls = [];
    state.data = [];
    state.rendered = 0;
    state.sorted = false;
    updateSortBtn();
    if (!silent) toast("🔄 Original page restored!");
  }

  // ============================================
  // Main sort flow
  // ============================================
  async function sortByRatings() {
    if (state.scanning) return;
    if (state.sorted) { restore(false); return; }

    var siteName = IS_FLIPKART ? "Flipkart" : IS_MYNTRA ? "Myntra" : "Amazon";
    var input = prompt(
      siteName + " — কত PAGE scan করবে? (প্রতি page ≈ " + PER_PAGE + " products)\n\n" +
      "20 = ~" + (PER_PAGE * 20) + "  |  40 = ~" + (PER_PAGE * 40) + "  |  80 = ~" + (PER_PAGE * 80) + "\n\n" +
      "⏳ ধীরে scan করবে (anti-block), তাই একটু সময় লাগবে।\n" +
      "Block হলে automatic scroll method এ চলে যাবে।",
      "30"
    );
    if (input === null) return;
    var maxPages = parseInt(input.trim(), 10);
    if (!maxPages || maxPages < 1) { alert("❌ সঠিক সংখ্যা দাও!"); return; }

    state.scanning = true;
    state.abort = false;
    showStopBtn();
    logLine("== scan start v21.2 ==");

    state.data = [];
    var seen = new Set();
    extractLive().forEach(function (d) {
      if (d.id && !seen.has(d.id)) { seen.add(d.id); state.data.push(d); }
    });
    logLine("page 1 (current): " + state.data.length + " products");

    // ---- PRIMARY: page fetch (gets beyond lazy-load cap) ----
    var blocked = await startPageScan(maxPages, seen);

    // ---- BONUS: scroll + Load More (grabs lazy-loaded extras) ----
    if (!state.abort) {
      await startScrollScan(25, seen);
    }

    state.scanning = false;
    hideStopBtn();
    logLine("== done: " + state.data.length + " products ==");
    hideLogLater(20);

    if (!state.data.length) { alert("❌ কোনো product পাওয়া যায়নি!"); return; }

    state.data.sort(function (a, b) {
      if (a.sponsored !== b.sponsored) return a.sponsored ? 1 : -1;
      return b.ratings - a.ratings;
    });

    render();
    state.sorted = true;
    updateSortBtn();
    window.scrollTo({ top: 0, behavior: "smooth" });
    var msg = "✅ " + state.data.length + " products sorted!\n🏆 Top: " + fmt(state.data[0].ratings) + " ratings";
    if (blocked) msg += "\n(page-fetch block হয়েছিল, scroll দিয়ে বাকি নিয়েছি)";
    toast(msg);
  }

  // ============================================
  // UI elements
  // ============================================
  function createSortButton() {
    if (state.sortBtn) return;
    var b = document.createElement("div");
    b.style.cssText =
      "position:fixed;right:26px;bottom:30px;z-index:2147483647;cursor:pointer;user-select:none;" +
      "color:#fff;border-radius:30px;padding:13px 22px;font:700 14px Arial,sans-serif;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.35);background:linear-gradient(135deg,#2874f0,#1a4fb7);";
    b.textContent = "⭐ Sort by Ratings";
    b.addEventListener("click", sortByRatings);
    document.body.appendChild(b);
    state.sortBtn = b;
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
    var s = document.createElement("div");
    s.textContent = "🛑 STOP";
    s.style.cssText =
      "position:fixed;right:26px;bottom:88px;z-index:2147483647;cursor:pointer;background:#d32f2f;" +
      "color:#fff;border-radius:20px;padding:9px 18px;font:700 13px Arial,sans-serif;";
    s.onclick = function () { state.abort = true; toast("🛑 Stopping…"); };
    document.body.appendChild(s);
    state.stopBtn = s;
  }
  function hideStopBtn() {
    if (state.stopBtn) { state.stopBtn.remove(); state.stopBtn = null; }
  }

  // URL change watcher
  (function watchURL() {
    var last = location.href;
    new MutationObserver(function () {
      if (location.href !== last) {
        last = location.href;
        if (state.sorted || state.wrap) restore(true);
      }
    }).observe(document.body, { childList: true, subtree: true });
  })();

  // Keyboard: Alt+S
  document.addEventListener("keydown", function (e) {
    if (e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      sortByRatings();
    }
  });

  function init() {
    var t0 = Date.now();
    var iv = setInterval(function () {
      var has = IS_MYNTRA
        ? document.querySelector("li.product-base")
        : IS_AMAZON
        ? document.querySelector('div[data-component-type="s-search-result"][data-asin]')
        : document.querySelector('div[data-id] a[href*="/p/"]');
      if (has || Date.now() - t0 > 20000) { clearInterval(iv); createSortButton(); }
    }, 1000);
  }

  setTimeout(init, 300);
})();
