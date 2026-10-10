// ============================================
// FLIPKART SORT BY REVIEWS v5.0
// - Exact review extraction (DOM anchored)
// - Fake/scientific numbers IMPOSSIBLE
// - Auto-purges phantom badges of old versions
// - Loads ALL products via auto-scroll
// - Grid-preserving rearrange + restore
// ============================================

(function () {
  "use strict";

  if (window.__flipsortLoaded) return;
  window.__flipsortLoaded = true;

  // ─── State ───
  const state = {
    isSorted: false,
    originalOrder: [],
    originalParents: [],
    originalCaps: [],
    sortButton: null,
    observer: null,
    isLoadingAll: false,
  };

  // ─── Config ───
  const config = {
    MAX_DIGITS: 8,             // 8 digit er beshi digit = FAKE, reject
    MAX_REVIEWS: 99999999,     // hard cap
    SCROLL_ATTEMPTS: 60,
    SCROLL_DELAY: 1800,
    STABLE_THRESHOLD: 4,
    MIN_PRODUCTS_FOR_PROMPT: 30,
    MAX_PRODUCTS_LIMIT: 4000,
  };

  // ─── Utility ───
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ============================================
  // 🔒 SAFE PARSER — 8 digit er beshi number
  // kokhono return kore NA. e+68 impossible.
  // ============================================
  function parseCount(raw) {
    if (raw === null || raw === undefined) return 0;
    const digits = String(raw).replace(/[^0-9]/g, "");
    if (!digits.length || digits.length > config.MAX_DIGITS) return 0;
    const n = parseInt(digits, 10);
    if (!isFinite(n) || isNaN(n) || n < 0 || n > config.MAX_REVIEWS) return 0;
    return n;
  }

  // ============================================
  // 🔒 FORMATTER — scientific notation dey na
  // ============================================
  function formatNumber(num) {
    num = Number(num);
    if (!isFinite(num) || isNaN(num) || num < 0) num = 0;
    if (num > config.MAX_REVIEWS) num = 0;
    num = Math.floor(num);
    let out;
    if (num >= 1000000) out = (num / 1000000).toFixed(1) + "M";
    else if (num >= 1000) out = (num / 1000).toFixed(1) + "K";
    else out = String(num);
    // Final validation: shudhu clean output allow
    return /^[0-9]+(\.[0-9])?[KM]?$/.test(out) ? out : "0";
  }

  function directText(el) {
    let t = "";
    for (const n of el.childNodes) {
      if (n.nodeType === 3) t += n.textContent;
    }
    return t.trim();
  }

  // ============================================
  // 🧹 PHANTOM PURGER
  // Purano version er badge + 5e+68 type number
  // DOM theke completely remove kore.
  // ============================================
  const SCI_NOTATION = /e\s*\+\s*\d{2,}/i;

  function purgePhantomNumbers(force) {
    // 1) Badge remove (current session er badge [data-fs="1"] protected)
    document.querySelectorAll(".flipsort-badge, .flipsort-sponsored").forEach((el) => {
      if (force || el.getAttribute("data-fs") !== "1") el.remove();
    });

    // 2) Product card er vitore scientific notation / 12+ digit
    //    wala injected element thakle remove
    document
      .querySelectorAll("div[data-id] span, div[data-id] div, div[data-id] p, div[data-id] label")
      .forEach((el) => {
        if (el.children.length > 0) return;
        if (el.closest('[data-fs="1"]')) return;
        const t = (el.textContent || "").trim();
        if (!t || t.length > 60) return;
        if (SCI_NOTATION.test(t)) { el.remove(); return; }
        const digits = t.replace(/[^0-9]/g, "");
        if (digits.length > 12) el.remove();
      });
  }

  // ============================================
  // 📦 PRODUCT DETECTION — div[data-id] based
  // (notun nested Flipkart layout e kaj kore)
  // ============================================
  function getMainScope(cards) {
    if (!cards.length) return null;
    const paths = cards.slice(0, 12).map((c) => {
      const arr = [];
      let el = c;
      while (el && el !== document.documentElement) {
        arr.push(el);
        el = el.parentElement;
      }
      return arr.reverse();
    });
    let common = paths[0] || [];
    for (let k = 1; k < paths.length; k++) {
      let i = 0;
      while (i < common.length && i < paths[k].length && common[i] === paths[k][i]) i++;
      common = common.slice(0, i);
      if (common.length <= 2) break;
    }
    return common.length ? common[common.length - 1] : document.body;
  }

  function getProductCards() {
    const raw = [];
    const seen = new Set();
    document.querySelectorAll("div[data-id]").forEach((el) => {
      if (el.querySelector("div[data-id]")) return; // deepest card only
      const id = el.getAttribute("data-id");
      if (!id || seen.has(id)) return;
      seen.add(id);
      raw.push(el);
    });
    if (!raw.length) return [];

    // Main results scope (recommendation carousel bad)
    const scope = getMainScope(raw);
    const inScope = scope ? raw.filter((el) => scope.contains(el)) : raw;

    return inScope.filter((el) => {
      const text = el.textContent || "";
      if (!text.includes("₹")) return false;
      if (!el.querySelector("img")) return false;
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
      return true;
    });
  }

  // ============================================
  // 🔍 REVIEW COUNT — anchored extraction
  // Price / ID / timestamp kokhono dhore NA
  // ============================================
  const reviewCache = new WeakMap();

  function getReviewCountCached(card) {
    if (reviewCache.has(card)) return reviewCache.get(card);
    const v = getReviewCount(card);
    reviewCache.set(card, v);
    return v;
  }

  function getReviewCount(card) {
    if (!card) return 0;

    const els = card.querySelectorAll("span, div, p, a, label");
    const fullText = (card.textContent || "").substring(0, 4000);
    const candidates = [];

    // ── PASS 1: "N Ratings & N Reviews" / "N Ratings" / "N Reviews" ──
    for (const el of els) {
      const t = (el.textContent || "").trim();
      if (!t || t.length > 90) continue;

      let m = t.match(/^([\d,]+)\s*Ratings?\s*(?:&|and)?\s*(?:([\d,]+)\s*)?Reviews?$/i);
      if (m) {
        candidates.push({ pri: 1, val: Math.max(parseCount(m[1]), parseCount(m[2] || "")) });
        continue;
      }
      m = t.match(/^([\d,]+)\s*Ratings?$/i);
      if (m) { candidates.push({ pri: 2, val: parseCount(m[1]) }); continue; }
      m = t.match(/^([\d,]+)\s*Reviews?$/i);
      if (m) { candidates.push({ pri: 2, val: parseCount(m[1]) }); }
    }
    candidates.sort((a, b) => a.pri - b.pri);
    const hit = candidates.find((c) => c.val > 0);
    if (hit) return hit.val;

    // ── PASS 2: star score er thik pase count ("4.4" ▸ "12,345") ──
    for (const el of els) {
      const st = directText(el);
      if (!st || !/^[0-5](\.\d{1,2})?\s*★?$/.test(st)) continue;
      let sib = el.nextElementSibling;
      for (let hop = 0; sib && hop < 2; hop++) {
        const mm = (sib.textContent || "").trim().match(/^\(?([\d,]{1,8})\)?$/);
        if (mm) { const v = parseCount(mm[1]); if (v > 0) return v; }
        sib = sib.nextElementSibling;
      }
      const ps = el.parentElement && el.parentElement.nextElementSibling;
      if (ps) {
        const mm = (ps.textContent || "").trim().match(/^\(?([\d,]{1,8})\)?$/);
        if (mm) { const v = parseCount(mm[1]); if (v > 0) return v; }
      }
    }

    // ── PASS 3: "(N)" pattern ──
    if (/★|rating|review/i.test(fullText)) {
      const mm = fullText.match(/\(([\d,]{1,8})\)/);
      if (mm) { const v = parseCount(mm[1]); if (v > 0) return v; }
    }

    // ── PASS 4: choto element e number + keyword ──
    for (const el of els) {
      const t = (el.textContent || "").trim();
      if (!t || t.length > 40) continue;
      if (!/rating|review/i.test(t)) continue;
      const mm = t.match(/([\d,]+)/);
      if (mm) { const v = parseCount(mm[1]); if (v > 0) return v; }
    }

    return 0;
  }

  // ─── Sponsored Detection ───
  function isSponsored(card) {
    if (!card) return false;
    const text = (card.textContent || "").toLowerCase();
    if (text.includes("sponsored")) return true;
    for (const el of card.querySelectorAll("span, div")) {
      if (el.children.length > 0) continue;
      const t = (el.textContent || "").trim().toLowerCase();
      if (t === "ad" || t === "ads") return true;
    }
    return false;
  }

  // ============================================
  // 🧩 REARRANGE — grid layout preserve kore
  // (prottek row er capacity same thake)
  // ============================================
  function rearrange(sortedCards) {
    if (!sortedCards.length) return;
    const parents = [];
    const set = new Set();
    sortedCards.forEach((c) => {
      const p = c.parentElement;
      if (p && !set.has(p)) { set.add(p); parents.push(p); }
    });

    if (parents.length <= 1) {
      const p = parents[0];
      if (p) sortedCards.forEach((c) => p.appendChild(c));
      return;
    }

    const caps = parents.map((p) => sortedCards.filter((c) => c.parentElement === p).length);
    let idx = 0;
    for (let r = 0; r < parents.length && idx < sortedCards.length; r++) {
      for (let k = 0; k < caps[r] && idx < sortedCards.length; k++, idx++) {
        parents[r].appendChild(sortedCards[idx]);
      }
    }
    const last = parents[parents.length - 1];
    while (idx < sortedCards.length) last.appendChild(sortedCards[idx++]);
  }

  // ─── Load ALL Products (auto scroll) ───
  async function loadAllProducts() {
    if (state.isLoadingAll) return;
    state.isLoadingAll = true;
    showNotification("⏳ ALL product load hocche… ei tab open rakho");

    let prev = -1;
    let stable = 0;

    for (let i = 0; i < config.SCROLL_ATTEMPTS; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(config.SCROLL_DELAY);
      purgePhantomNumbers();

      const n = getProductCards().length;
      if (n !== prev || i % 3 === 0) {
        showNotification(`⏳ Loaded ${n} products… (${i + 1}/${config.SCROLL_ATTEMPTS})`);
      }

      let bodyText = "";
      try { bodyText = document.body.innerText || ""; } catch (e) {}
      if (/end of results/i.test(bodyText)) {
        showNotification(`✅ End of results — ${n} products loaded`);
        break;
      }

      if (n === prev) {
        stable++;
        if (stable >= config.STABLE_THRESHOLD) break;
      } else {
        stable = 0;
      }
      prev = n;

      if (n >= config.MAX_PRODUCTS_LIMIT) break;
    }

    state.isLoadingAll = false;
  }

  // ============================================
  // 🔃 MAIN SORT
  // ============================================
  async function sortByReviews() {
    if (state.isLoadingAll) return;

    if (state.isSorted) { restoreOriginal(); return; }

    purgePhantomNumbers();

    let cards = getProductCards();
    if (cards.length === 0) {
      alert("❌ Kono product paoa jay nai!\nFlipkart e search/category page open koro, product load hoye gele abar try koro.");
      return;
    }

    if (cards.length < config.MIN_PRODUCTS_FOR_PROMPT) {
      const loadAll = confirm(
        `Ekhn o ${cards.length} ta product load hoyeche.\n\n` +
        `OK → Auto-scroll kore ALL product load hobe (2-5 min)\n` +
        `Cancel → Sudhu ekhon available product gulo sort hobe`
      );
      if (loadAll) {
        await loadAllProducts();
        cards = getProductCards();
      }
    }

    // First time: original layout snapshot
    if (state.originalOrder.length === 0) {
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
    }

    showNotification("⏳ Review count porha hocche…");

    const data = [];
    for (let i = 0; i < cards.length; i++) {
      data.push({
        card: cards[i],
        idx: i,
        reviews: getReviewCountCached(cards[i]),
        sponsored: isSponsored(cards[i]),
      });
      if (i % 400 === 399) {
        showNotification(`⏳ Analyzed ${i + 1}/${cards.length} products…`);
        await sleep(0);
      }
    }

    // ── SORT: sponsored niche, regular reviews descending ──
    data.sort((a, b) => {
      if (a.sponsored !== b.sponsored) return a.sponsored ? 1 : -1;
      if (b.reviews !== a.reviews) return b.reviews - a.reviews;
      return a.idx - b.idx;
    });

    rearrange(data.map((d) => d.card));

    let sponsoredCount = 0, unknownCount = 0, maxReviews = 0;
    data.forEach((d, rank) => {
      addBadge(d.card, d.reviews, rank, d.sponsored);
      if (d.sponsored) sponsoredCount++;
      else {
        if (d.reviews > maxReviews) maxReviews = d.reviews;
        if (d.reviews === 0) unknownCount++;
      }
    });

    state.isSorted = true;
    updateButtonState(true);

    showNotification(
      `✅ ${data.length} ta product sort hoyeche!\n` +
      `📢 Sponsored: ${sponsoredCount} (niche) | ❓ Review nai: ${unknownCount}\n` +
      `🏆 Most reviewed: ${formatNumber(maxReviews)}`
    );

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ─── Restore Original Order ───
  function restoreOriginal() {
    document.querySelectorAll(".flipsort-badge, .flipsort-sponsored").forEach((el) => el.remove());

    if (state.originalOrder.length && state.originalParents.length) {
      let idx = 0;
      for (let r = 0; r < state.originalParents.length; r++) {
        const row = state.originalParents[r];
        for (let k = 0; k < state.originalCaps[r] && idx < state.originalOrder.length; k++, idx++) {
          row.appendChild(state.originalOrder[idx]);
        }
      }
      const last = state.originalParents[state.originalParents.length - 1];
      while (idx < state.originalOrder.length) last.appendChild(state.originalOrder[idx++]);
    }

    state.isSorted = false;
    state.originalOrder = [];
    state.originalParents = [];
    state.originalCaps = [];
    updateButtonState(false);
    showNotification("🔄 Original order restored!");
  }

  // ─── Badge ───
  function addBadge(card, count, rank, sponsored) {
    const old = card.querySelector(".flipsort-badge");
    if (old) old.remove();
    const oldSo = card.querySelector(".flipsort-sponsored");
    if (oldSo) oldSo.remove();

    // Final safety — kokhono fake number dekhabe na
    count = parseCount(count);

    const badge = document.createElement("div");
    badge.className = "flipsort-badge";
    badge.setAttribute("data-fs", "1");

    if (sponsored) {
      badge.textContent = "📢 Sponsored";
      badge.style.background = "linear-gradient(135deg,#9e9e9e,#616161)";
    } else if (count > 0) {
      badge.textContent = "📝 " + formatNumber(count);
      badge.style.background = "linear-gradient(135deg,#ff9800,#f57c00)";
    } else {
      badge.textContent = "📝 N/A";
      badge.style.background = "linear-gradient(135deg,#bdbdbd,#9e9e9e)";
    }

    badge.title = "Reviews: " + Number(count || 0).toLocaleString("en-IN") + "  •  Rank #" + (rank + 1);

    if (!sponsored && rank < 3) {
      const r = document.createElement("span");
      r.textContent = " #" + (rank + 1);
      r.style.fontWeight = "800";
      r.style.marginLeft = "3px";
      badge.appendChild(r);
    }

    card.style.position = "relative";
    card.appendChild(badge);

    if (sponsored) {
      const lbl = document.createElement("div");
      lbl.className = "flipsort-sponsored";
      lbl.setAttribute("data-fs", "1");
      lbl.textContent = "AD";
      lbl.title = "Sponsored / Ad product";
      card.appendChild(lbl);
    }
  }

  // ─── Styles ───
  function injectStyles() {
    if (document.getElementById("flipsort-styles")) return;
    const css = `
      .flipsort-badge{position:absolute;top:4px;right:4px;z-index:99999;color:#fff;
        font:600 11px/1 Arial,sans-serif;padding:4px 7px;border-radius:10px;
        box-shadow:0 1px 4px rgba(0,0,0,.35);white-space:nowrap}
      .flipsort-sponsored{position:absolute;top:4px;left:4px;z-index:99999;background:#e53935;
        color:#fff;font:700 10px/1 Arial,sans-serif;padding:3px 6px;border-radius:8px}
      #flipsort-btn{position:fixed;right:22px;bottom:90px;z-index:2147483647;cursor:pointer;
        background:linear-gradient(135deg,#2874f0,#1a4fb7);color:#fff;border-radius:30px;
        padding:11px 18px;font:600 13px Arial,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3);
        user-select:none;transition:transform .15s}
      #flipsort-btn:hover{transform:scale(1.05)}
      #flipsort-btn.flipsort-active{background:linear-gradient(135deg,#2e7d32,#1b5e20)}
      .flipsort-icon{margin-right:6px}
      #flipsort-toast{position:fixed;top:16px;left:50%;transform:translate(-50%,-90px);
        z-index:2147483647;background:#212121;color:#fff;padding:12px 20px;border-radius:10px;
        font:500 13px Arial,sans-serif;white-space:pre-line;box-shadow:0 4px 16px rgba(0,0,0,.4);
        opacity:0;transition:all .3s;max-width:80vw;text-align:center}
      #flipsort-toast.flipsort-toast-show{transform:translate(-50%,0);opacity:1}
    `;
    const s = document.createElement("style");
    s.id = "flipsort-styles";
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  // ─── Sort Button ───
  function createSortButton() {
    if (document.getElementById("flipsort-btn")) return;
    state.sortButton = document.createElement("div");
    state.sortButton.id = "flipsort-btn";
    state.sortButton.innerHTML = `
      <span class="flipsort-icon">📊</span><span class="flipsort-text">Sort by Reviews</span>
    `;
    state.sortButton.addEventListener("click", () => {
      if (state.sortButton.dataset.dragged) return;
      sortByReviews();
    });
    document.body.appendChild(state.sortButton);
    makeDraggable(state.sortButton);
  }

  function updateButtonState(sorted) {
    if (!state.sortButton) return;
    const textEl = state.sortButton.querySelector(".flipsort-text");
    const iconEl = state.sortButton.querySelector(".flipsort-icon");
    if (sorted) {
      textEl.textContent = "Restore Default";
      iconEl.textContent = "🔄";
      state.sortButton.classList.add("flipsort-active");
    } else {
      textEl.textContent = "Sort by Reviews";
      iconEl.textContent = "📊";
      state.sortButton.classList.remove("flipsort-active");
    }
  }

  // ─── Toast ───
  function showNotification(message) {
    const existing = document.getElementById("flipsort-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.id = "flipsort-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add("flipsort-toast-show"), 10);
    setTimeout(() => {
      toast.classList.remove("flipsort-toast-show");
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ─── Draggable ───
  function makeDraggable(el) {
    let dragging = false, moved = false, sx = 0, sy = 0, ix = 0, iy = 0;
    el.addEventListener("mousedown", (e) => {
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect();
      ix = r.left; iy = r.top;
      el.style.transition = "none";
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
      if (moved) {
        el.style.left = ix + dx + "px";
        el.style.top = iy + dy + "px";
        el.style.right = "auto";
        el.style.bottom = "auto";
      }
    });
    document.addEventListener("mouseup", () => {
      if (dragging && moved) {
        el.dataset.dragged = "1";
        setTimeout(() => { delete el.dataset.dragged; }, 100);
      }
      dragging = false;
      el.style.transition = "";
    });
  }

  // ─── SPA Page Change Watch ───
  function watchForPageChanges() {
    let lastURL = location.href;
    state.observer = new MutationObserver(() => {
      if (location.href !== lastURL) {
        lastURL = location.href;
        state.isSorted = false;
        state.originalOrder = [];
        state.originalParents = [];
        state.originalCaps = [];
        updateButtonState(false);
        purgePhantomNumbers(true);
      }
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Init ───
  function init() {
    injectStyles();

    // Purano phantom number/badge cleanup loop (first ~3 min)
    let ticks = 0;
    const purgeTimer = setInterval(() => {
      purgePhantomNumbers();
      if (++ticks > 45) clearInterval(purgeTimer);
    }, 4000);

    const t0 = Date.now();
    const checkInterval = setInterval(() => {
      if (getProductCards().length > 0 || Date.now() - t0 > 30000) {
        clearInterval(checkInterval);
        createSortButton();
        watchForPageChanges();
      }
    }, 1500);
  }

  // ─── Keyboard Shortcut (Alt + S) ───
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      sortByReviews();
    }
  });

  // ─── Start ───
  if (location.hostname.includes("flipkart.com")) {
    init();
  }
})();
