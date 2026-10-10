// ============================================
// FLIPKART SORT BY RATINGS COUNT v6.1
// Sort by "koto lok rating diyeche" (total ratings)
// Avg rating (4.4, 4.5) IGNORED
// Format: "69 Ratings&15 Reviews" → picks 69
// ============================================

(function () {
  "use strict";

  if (window.__flipSortLoaded) return;
  window.__flipSortLoaded = true;

  const state = {
    isSorted: false,
    originalOrder: [],
    originalParents: [],
    originalCaps: [],
    sortButton: null,
    isLoadingAll: false,
  };

  // ============================================
  // 🔒 SAFE NUMBER PARSER
  // 8 digit er beshi = FAKE = REJECT
  // ============================================
  function safeNum(raw) {
    if (raw == null) return 0;
    const digits = String(raw).replace(/[^0-9]/g, "");
    if (!digits || digits.length > 8) return 0;
    const n = parseInt(digits, 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
  }

  // ============================================
  // 🎯 RATINGS COUNT EXTRACTOR
  // "69 Ratings&15 Reviews" → returns 69 (Ratings only)
  // "3,413 Ratings&190 Reviews" → returns 3413
  // Reviews (written feedback) ignored
  // ============================================
  function getRatingsCount(card) {
    if (!card) return 0;

    const text = card.textContent || "";

    // PATTERN 1 (MAIN): "X Ratings&Y Reviews"
    // Extract X (ratings count), ignore Y (reviews)
    const p1 = text.match(/([\d,]+)\s*Ratings?\s*&\s*([\d,]+)\s*Reviews?/i);
    if (p1) {
      return safeNum(p1[1]);  // Shudhu Ratings count
    }

    // PATTERN 2: "X Ratings" only
    const p2 = text.match(/([\d,]+)\s*Ratings?/i);
    if (p2) return safeNum(p2[1]);

    // PATTERN 3: "X Ratings Y Reviews" (space instead of &)
    const p3 = text.match(/([\d,]+)\s*Ratings?\s+([\d,]+)\s*Reviews?/i);
    if (p3) return safeNum(p3[1]);

    // PATTERN 4: "(X)" near rating context
    if (/rating/i.test(text)) {
      const p4 = text.match(/\(([\d,]+)\)/);
      if (p4) return safeNum(p4[1]);
    }

    return 0;
  }

  // ============================================
  // 📝 NUMBER FORMATTER
  // 1500000 → "1.5M", 2500 → "2.5K"
  // ============================================
  function formatNum(n) {
    n = Number(n);
    if (!Number.isFinite(n) || n < 0 || n > 99999999) return "0";
    n = Math.floor(n);
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  // ============================================
  // 🎯 PRODUCT CARDS FINDER
  // ============================================
  function getProductCards() {
    const cards = [];
    const seen = new Set();

    document.querySelectorAll("div[data-id]").forEach((el) => {
      if (el.querySelector("div[data-id]")) return;
      const id = el.getAttribute("data-id");
      if (!id || seen.has(id)) return;
      seen.add(id);

      const text = el.textContent || "";
      if (!text.includes("₹")) return;
      if (!el.querySelector("img")) return;
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return;

      cards.push(el);
    });

    return cards;
  }

  // ============================================
  // 📢 SPONSORED DETECTION
  // ============================================
  function isSponsored(card) {
    if (!card) return false;
    const t = (card.textContent || "").toLowerCase();
    if (t.includes("sponsored")) return true;
    for (const el of card.querySelectorAll("span, div")) {
      if (el.children.length > 0) continue;
      const s = (el.textContent || "").trim();
      if (s === "Ad" || s === "Sponsored" || s === "AD") return true;
    }
    return false;
  }

  // ============================================
  // 📜 LOAD ALL PRODUCTS
  // ============================================
  async function loadAllProducts() {
    if (state.isLoadingAll) return;
    state.isLoadingAll = true;
    showNotify("⏳ Sob product load hocche...");

    let prev = -1;
    let stable = 0;

    for (let i = 0; i < 60; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 1800));

      const n = getProductCards().length;
      showNotify(`⏳ ${n} products loaded (${i + 1}/60)`);

      const bodyText = document.body.innerText || "";
      if (/end of results|no more results/i.test(bodyText)) break;

      if (n === prev) {
        stable++;
        if (stable >= 4) break;
      } else {
        stable = 0;
      }
      prev = n;
      if (n >= 4000) break;
    }

    state.isLoadingAll = false;
    showNotify(`✅ ${prev} products loaded`);
  }

  // ============================================
  // 🧩 GRID PRESERVING REARRANGE
  // ============================================
  function rearrange(sorted) {
    if (!sorted.length) return;
    const parents = [];
    const seen = new Set();
    sorted.forEach((c) => {
      const p = c.parentElement;
      if (p && !seen.has(p)) {
        seen.add(p);
        parents.push(p);
      }
    });
    if (parents.length <= 1) {
      const p = parents[0];
      if (p) sorted.forEach((c) => p.appendChild(c));
      return;
    }
    const caps = parents.map((p) => sorted.filter((c) => c.parentElement === p).length);
    let idx = 0;
    for (let r = 0; r < parents.length && idx < sorted.length; r++) {
      for (let k = 0; k < caps[r] && idx < sorted.length; k++, idx++) {
        parents[r].appendChild(sorted[idx]);
      }
    }
    const last = parents[parents.length - 1];
    while (idx < sorted.length) last.appendChild(sorted[idx++]);
  }

  // ============================================
  // 🎯 MAIN SORT FUNCTION
  // ============================================
  async function sortByRatings() {
    if (state.isLoadingAll) return;
    if (state.isSorted) {
      restoreOriginal();
      return;
    }

    let cards = getProductCards();
    if (cards.length === 0) {
      alert("❌ Product paoa jay ni!");
      return;
    }

    if (cards.length < 30) {
      const loadAll = confirm(
        `Shudhu ${cards.length} ta product ache.\n\n` +
        `OK = Sob product load korbe (2-5 min)\n` +
        `Cancel = Shudhu ei page sort korbe`
      );
      if (loadAll) {
        await loadAllProducts();
        cards = getProductCards();
      }
    }

    // Save original order
    state.originalOrder = cards.slice();
    state.originalParents = [];
    state.originalCaps = [];
    const seen = new Set();
    cards.forEach((c) => {
      const p = c.parentElement;
      if (p && !seen.has(p)) {
        seen.add(p);
        state.originalParents.push(p);
        state.originalCaps.push(0);
      }
    });
    cards.forEach((c) => {
      const i = state.originalParents.indexOf(c.parentElement);
      if (i >= 0) state.originalCaps[i]++;
    });

    showNotify("⏳ Ratings count analyze hocche...");

    // Build data array with RATINGS COUNT
    const data = cards.map((card, idx) => ({
      card,
      idx,
      ratings: getRatingsCount(card),  // Shudhu ratings count
      sponsored: isSponsored(card),
    }));

    // Sort: sponsored niche, regular by ratings count DESCENDING
    data.sort((a, b) => {
      if (a.sponsored !== b.sponsored) return a.sponsored ? 1 : -1;
      if (b.ratings !== a.ratings) return b.ratings - a.ratings;  // Most ratings first
      return a.idx - b.idx;
    });

    rearrange(data.map((d) => d.card));

    // Add badges
    let sponsoredCount = 0;
    let maxRatings = 0;
    let withRatings = 0;

    data.forEach((d, rank) => {
      addBadge(d.card, d.ratings, rank, d.sponsored);
      if (d.sponsored) {
        sponsoredCount++;
      } else {
        if (d.ratings > maxRatings) maxRatings = d.ratings;
        if (d.ratings > 0) withRatings++;
      }
    });

    state.isSorted = true;
    updateBtnState(true);

    showNotify(
      `✅ ${data.length} ta product sorted by RATINGS COUNT!\n` +
      `📢 Sponsored: ${sponsoredCount}\n` +
      `📊 Ratings pawa geche: ${withRatings}/${data.length - sponsoredCount}\n` +
      `🏆 Most rated: ${formatNum(maxRatings)} ratings`
    );

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ============================================
  // 🔄 RESTORE ORIGINAL
  // ============================================
  function restoreOriginal() {
    document.querySelectorAll(".flip-badge").forEach((e) => e.remove());
    let idx = 0;
    for (let r = 0; r < state.originalParents.length; r++) {
      const row = state.originalParents[r];
      for (let k = 0; k < state.originalCaps[r] && idx < state.originalOrder.length; k++, idx++) {
        row.appendChild(state.originalOrder[idx]);
      }
    }
    const last = state.originalParents[state.originalParents.length - 1];
    while (idx < state.originalOrder.length) last.appendChild(state.originalOrder[idx++]);

    state.isSorted = false;
    state.originalOrder = [];
    state.originalParents = [];
    state.originalCaps = [];
    updateBtnState(false);
    showNotify("🔄 Original order restored!");
  }

  // ============================================
  // 🏷️ ADD BADGE
  // ============================================
  function addBadge(card, count, rank, sponsored) {
    card.querySelectorAll(".flip-badge").forEach((e) => e.remove());

    count = safeNum(count);

    const b = document.createElement("div");
    b.className = "flip-badge";
    b.style.cssText =
      "position:absolute;top:6px;right:6px;z-index:99999;color:#fff;" +
      "font:700 12px/1 Arial,sans-serif;padding:5px 9px;border-radius:10px;" +
      "box-shadow:0 2px 6px rgba(0,0,0,.3);white-space:nowrap;pointer-events:none";

    if (sponsored) {
      b.textContent = "📢 Sponsored";
      b.style.background = "linear-gradient(135deg,#9e9e9e,#616161)";
    } else if (count > 0) {
      b.textContent = "⭐ " + formatNum(count);  // Star icon for ratings
      b.style.background = "linear-gradient(135deg,#1976d2,#0d47a1)";  // Blue for ratings
    } else {
      b.textContent = "⭐ 0";
      b.style.background = "linear-gradient(135deg,#bdbdbd,#9e9e9e)";
    }

    b.title = `Ratings: ${count.toLocaleString("en-IN")} • Rank #${rank + 1}`;

    if (!sponsored && rank < 3) {
      const r = document.createElement("span");
      r.textContent = " #" + (rank + 1);
      r.style.cssText = "font-weight:900;margin-left:3px";
      b.appendChild(r);
    }

    card.style.position = "relative";
    card.appendChild(b);
  }

  // ============================================
  // 🎨 INJECT STYLES
  // ============================================
  function injectStyles() {
    if (document.getElementById("flip-styles")) return;
    const css = `
      #flip-btn{position:fixed;right:20px;bottom:90px;z-index:2147483647;cursor:pointer;
        background:linear-gradient(135deg,#2874f0,#1a4fb7);color:#fff;border-radius:30px;
        padding:12px 20px;font:700 14px Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35);
        user-select:none;transition:transform .15s}
      #flip-btn:hover{transform:scale(1.05)}
      #flip-btn.active{background:linear-gradient(135deg,#2e7d32,#1b5e20)}
      #flip-toast{position:fixed;top:20px;left:50%;transform:translate(-50%,-100px);
        z-index:2147483647;background:#212121;color:#fff;padding:12px 20px;border-radius:10px;
        font:500 13px/1.4 Arial,sans-serif;white-space:pre-line;box-shadow:0 4px 16px rgba(0,0,0,.4);
        opacity:0;transition:all .3s;max-width:80vw;text-align:center}
      #flip-toast.show{transform:translate(-50%,0);opacity:1}
    `;
    const s = document.createElement("style");
    s.id = "flip-styles";
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  // ============================================
  // 🔘 SORT BUTTON
  // ============================================
  function createBtn() {
    if (document.getElementById("flip-btn")) return;
    state.sortButton = document.createElement("div");
    state.sortButton.id = "flip-btn";
    state.sortButton.innerHTML = `⭐ <span>Sort by Ratings</span>`;
    state.sortButton.addEventListener("click", sortByRatings);
    document.body.appendChild(state.sortButton);
  }

  function updateBtnState(sorted) {
    if (!state.sortButton) return;
    const t = state.sortButton.querySelector("span");
    if (sorted) {
      t.textContent = "Restore Default";
      state.sortButton.classList.add("active");
    } else {
      t.textContent = "Sort by Ratings";
      state.sortButton.classList.remove("active");
    }
  }

  function showNotify(msg) {
    let t = document.getElementById("flip-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "flip-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.remove("show");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => t.classList.add("show"));
    });
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 3500);
  }

  // ============================================
  // 🚀 INIT
  // ============================================
  function init() {
    injectStyles();
    const t0 = Date.now();
    const check = setInterval(() => {
      if (getProductCards().length > 0 || Date.now() - t0 > 30000) {
        clearInterval(check);
        createBtn();
      }
    }, 1500);
  }

  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      sortByRatings();
    }
  });

  if (location.hostname.includes("flipkart.com")) {
    init();
  }
})();
