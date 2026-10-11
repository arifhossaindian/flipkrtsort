// ============================================
// SORT BY RATINGS v15 - DOM NODE MOVE STRATEGY
// Myntra: auto-scroll → collect all → sort → move nodes
// Flipkart: fetch pages → collect all → sort → move nodes
// ============================================

(function () {
  "use strict";
  if (window.__flipSortLoaded) return;
  window.__flipSortLoaded = true;

  const HOST = location.hostname.replace(/^www\./, "");
  const IS_FLIPKART = HOST.indexOf("flipkart.com") !== -1;
  const IS_MYNTRA = HOST.indexOf("myntra.com") !== -1;
  if (!IS_FLIPKART && !IS_MYNTRA) return;

  const LS_KEY = "sortratings_enabled_v15";

  const state = {
    enabled: localStorage.getItem(LS_KEY) !== "0",
    sorted: false,
    scanning: false,
    stop: false,
    originalOrder: [],
    sortedData: [],
    pill: null,
    sortBtn: null,
    stopBtn: null,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ─── Parse number ───
  function parseDigits(t) {
    const d = String(t == null ? "" : t).replace(/[^0-9]/g, "");
    if (!d || d.length > 8) return 0;
    const n = parseInt(d, 10);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  // Myntra: "33.5k", "10.8k" → number
  function parseMyntraCount(t) {
    let s = String(t || "").trim().toLowerCase();
    s = s.replace(/^[^0-9]+/, "");
    const m = s.match(/^([\d.]+)\s*(k|m|l)?/);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    if (!isFinite(n) || n < 0) return 0;
    const suffix = m[2];
    if (suffix === "k") n *= 1000;
    else if (suffix === "m") n *= 1000000;
    else if (suffix === "l") n *= 100000;
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

  // ─── Get products (DOM nodes) ───
  function getProducts() {
    if (IS_FLIPKART) {
      return Array.from(document.querySelectorAll("div[data-id]")).filter((el) => {
        if (el.querySelector("div[data-id]")) return false;
        if (!el.querySelector('a[href*="/p/"]')) return false;
        const txt = el.textContent || "";
        return txt.indexOf("₹") !== -1 && !!el.querySelector("img");
      });
    } else {
      return Array.from(document.querySelectorAll("li.product-base")).filter((el) => {
        return !!el.querySelector(".product-ratingsContainer");
      });
    }
  }

  // ─── Get ratings count ───
  function getRatings(el) {
    if (IS_FLIPKART) {
      const s = el.querySelector("span.PvbNMB");
      if (s) {
        const n = parseDigits(s.textContent);
        if (n > 0) return n;
      }
      const m = (el.textContent || "").match(/\(([\d,]+)\)/);
      return m ? parseDigits(m[1]) : 0;
    } else {
      const rc = el.querySelector(".product-ratingsCount");
      if (!rc) return 0;
      const txt = rc.textContent || "";
      return parseMyntraCount(txt);
    }
  }

  // ─── Check sponsored ───
  function isSponsored(el) {
    if (IS_FLIPKART) {
      return !!el.querySelector(".IxWX8O");
    } else {
      const w = el.querySelector(".product-waterMark");
      return w ? /AD/i.test(w.textContent || "") : false;
    }
  }

  // ─── Load all products (Myntra: auto-scroll) ───
  async function loadAllMyntra() {
    state.scanning = true;
    state.stop = false;
    showStopBtn();

    let lastCount = 0;
    let stableCount = 0;
    let scrollAttempts = 0;
    const maxAttempts = 1000;

    while (scrollAttempts < maxAttempts && !state.stop) {
      const products = getProducts();
      const currentCount = products.length;

      toast(`🔄 Loading... ${currentCount} products\nScroll #${scrollAttempts + 1}`);

      if (currentCount === lastCount) {
        stableCount++;
        if (stableCount >= 5) {
          toast(`✅ All loaded! Total: ${currentCount}`);
          break;
        }
      } else {
        stableCount = 0;
        lastCount = currentCount;
      }

      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      await sleep(2000);
      scrollAttempts++;
    }

    state.scanning = false;
    hideStopBtn();
    return getProducts();
  }

  // ─── Load all products (Flipkart: fetch pages) ───
  async function loadAllFlipkart() {
    state.scanning = true;
    state.stop = false;
    showStopBtn();

    const input = prompt(
      "Flipkart: কতগুলো PAGE scan করবে?\n\n" +
      "• খালি OK = ALL pages\n" +
      "• সংখ্যা লেখো (যেমন 50)",
      ""
    );
    if (input === null) {
      state.scanning = false;
      hideStopBtn();
      return [];
    }

    const maxPages = input.trim() === "" ? Infinity : (parseInt(input, 10) || Infinity);
    const base = location.href.replace(/([?&])page=\d+&?/g, "$1").replace(/[?&]$/, "");
    const sep = base.indexOf("?") !== -1 ? "&" : "?";

    const allProducts = [];
    const seenIds = new Set();

    // Current page products
    getProducts().forEach((el) => {
      const id = el.getAttribute("data-id");
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        allProducts.push(el);
      }
    });

    for (let p = 1; p <= maxPages && !state.stop; p++) {
      toast(`🔍 Page ${p} fetching...\n📦 Collected: ${allProducts.length}`);

      try {
        const res = await fetch(base + sep + "page=" + p, { credentials: "include" });
        if (!res.ok) break;

        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const cards = doc.querySelectorAll("div[data-id]");

        let fresh = 0;
        cards.forEach((card) => {
          if (card.querySelector("div[data-id]")) return;
          if (!card.querySelector('a[href*="/p/"]')) return;
          const txt = card.textContent || "";
          if (txt.indexOf("₹") === -1 || !card.querySelector("img")) return;

          const id = card.getAttribute("data-id");
          if (id && !seenIds.has(id)) {
            seenIds.add(id);
            // Create DOM node from HTML
            const tpl = document.createElement("template");
            tpl.innerHTML = card.outerHTML.trim();
            const node = tpl.content.firstElementChild;
            if (node) allProducts.push(node);
            fresh++;
          }
        });

        if (!fresh) break;
        await sleep(600);
      } catch (e) {
        break;
      }
    }

    state.scanning = false;
    hideStopBtn();
    return allProducts;
  }

  // ─── Sort and rearrange (DOM nodes move) ───
  function sortProducts(products) {
    if (!products.length) return;

    // Extract data
    const data = products.map((el, idx) => ({
      el,
      idx,
      ratings: getRatings(el),
      sponsored: isSponsored(el),
    }));

    // Save original order
    state.originalOrder = products.slice();
    state.sortedData = data;

    // Sort: sponsored last, then by ratings descending
    data.sort((a, b) => {
      if (a.sponsored !== b.sponsored) return a.sponsored ? 1 : -1;
      if (b.ratings !== a.ratings) return b.ratings - a.ratings;
      return a.idx - b.idx;
    });

    // Get parent container
    const parent = products[0].parentElement;
    if (!parent) {
      alert("❌ Parent container not found!");
      return;
    }

    // Add badges
    data.forEach((d, rank) => {
      addBadge(d.el, d.ratings, rank, d.sponsored);
    });

    // Re-append in sorted order (DOM nodes move, not copy!)
    data.forEach((d) => {
      parent.appendChild(d.el);
    });

    state.sorted = true;
    updateSortBtn();

    const sponsoredCount = data.filter((d) => d.sponsored).length;
    const maxRatings = data.length > 0 ? data[0].ratings : 0;

    toast(
      `✅ ${data.length} products sorted!\n` +
      `🏆 Most rated: ${fmt(maxRatings)}\n` +
      `📢 Sponsored: ${sponsoredCount} (last)`
    );

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ─── Restore original order ───
  function restoreOriginal() {
    if (!state.originalOrder.length) return;

    // Remove badges
    document.querySelectorAll(".fs-badge").forEach((el) => el.remove());

    // Get parent
    const parent = state.originalOrder[0].parentElement;
    if (!parent) return;

    // Re-append in original order
    state.originalOrder.forEach((el) => {
      parent.appendChild(el);
    });

    state.sorted = false;
    state.originalOrder = [];
    state.sortedData = [];
    updateSortBtn();
    toast("🔄 Original order restored!");
  }

  // ─── Add badge ───
  function addBadge(el, ratings, rank, sponsored) {
    const old = el.querySelector(".fs-badge");
    if (old) old.remove();

    const b = document.createElement("div");
    b.className = "fs-badge";
    b.style.cssText =
      "position:absolute;top:8px;right:8px;z-index:9999;color:#fff;font:700 12px/1 Arial,sans-serif;" +
      "padding:5px 9px;border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:none;" +
      "background:" + (sponsored ? "#9e9e9e" : "linear-gradient(135deg,#ff9800,#f57c00)") + ";";
    b.textContent = sponsored ? "📢 AD" : "⭐ " + fmt(ratings);
    b.title = "Ratings: " + ratings.toLocaleString("en-IN") + " • Rank #" + (rank + 1);

    el.style.position = "relative";
    el.appendChild(b);
  }

  // ─── Main sort ───
  async function sortByRatings() {
    if (!state.enabled || state.scanning) return;
    if (state.sorted) {
      restoreOriginal();
      return;
    }

    let products;

    if (IS_MYNTRA) {
      const confirm = window.confirm(
        "Myntra: Auto-scroll করে সব products load করবে।\n" +
        "এতে 5-15 মিনিট লাগতে পারে।\n\n" +
        "OK = Start loading all products"
      );
      if (!confirm) return;
      products = await loadAllMyntra();
    } else {
      products = await loadAllFlipkart();
    }

    if (!products.length) {
      alert("❌ কোনো product collect হয়নি!");
      return;
    }

    sortProducts(products);
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
    try {
      localStorage.setItem(LS_KEY, on ? "1" : "0");
    } catch (e) {}
    if (!on) {
      if (state.sorted) restoreOriginal();
      if (state.sortBtn) {
        state.sortBtn.remove();
        state.sortBtn = null;
      }
      hideStopBtn();
      toast("🔴 OFF");
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
    s.onclick = () => {
      state.stop = true;
    };
    document.body.appendChild(s);
    state.stopBtn = s;
  }

  function hideStopBtn() {
    if (state.stopBtn) {
      state.stopBtn.remove();
      state.stopBtn = null;
    }
  }

  // ─── SPA navigation cleanup ───
  (function watchURL() {
    let last = location.href;
    new MutationObserver(() => {
      if (location.href !== last) {
        last = location.href;
        if (state.sorted) restoreOriginal();
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
      const has = getProducts().length > 0;
      if (has || Date.now() - t0 > 20000) {
        clearInterval(iv);
        createSortButton();
      }
    }, 1000);
  }

  init();
})();
