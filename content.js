// ============================================
// FLIPKART SORT BY RATINGS COUNT v8.0
// Exact Flipkart DOM structure based
// Loads ALL products via auto-scroll
// Maintains 4-column grid layout
// ============================================

(function () {
  "use strict";

  if (window.__flipSortLoaded) return;
  window.__flipSortLoaded = true;

  // ─── State ───
  const state = {
    isSorted: false,
    originalOrder: [],
    sortButton: null,
    isLoading: false,
    stopRequested: false,
  };

  // ─── Config ───
  const config = {
    SCROLL_DELAY: 1500,
    MAX_SCROLL_ATTEMPTS: 700,
    STABLE_THRESHOLD: 5,
    PRODUCTS_PER_PAGE: 40,
  };

  // ─── Utility: Sleep ───
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ─── Utility: Safe Number Parser ───
  function safeNum(text) {
    if (!text) return 0;
    const digits = String(text).replace(/[^0-9]/g, "");
    if (!digits || digits.length > 8) return 0;
    const n = parseInt(digits, 10);
    if (isNaN(n) || !isFinite(n) || n < 0) return 0;
    return n;
  }

  // ─── Utility: Format Number ───
  function formatNum(n) {
    if (!n || n <= 0) return "0";
    if (n >= 10000000) return (n / 10000000).toFixed(1) + "Cr";
    if (n >= 100000) return (n / 100000).toFixed(1) + "L";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  // ============================================
  // 🎯 GET RATING COUNT FROM PRODUCT CARD
  // Flipkart uses: <span class="PvbNMB">(23,030)</span>
  // ============================================
  function getRatingCount(card) {
    if (!card) return 0;

    // Method 1: Look for span with class containing rating count pattern (number in parentheses)
    const spans = card.querySelectorAll("span");
    for (const span of spans) {
      const text = span.textContent.trim();
      // Match pattern like (7) or (23,030) or (1,26,614)
      const match = text.match(/^\(?([\d,]+)\)?$/);
      if (match) {
        const num = safeNum(match[1]);
        if (num > 0) return num;
      }
    }

    // Method 2: Look for text containing "Ratings" keyword
    const fullText = card.textContent || "";
    const ratingMatch = fullText.match(/([\d,]+)\s*Ratings?/i);
    if (ratingMatch) {
      return safeNum(ratingMatch[1]);
    }

    // Method 3: Look for pattern near star rating
    const starMatch = fullText.match(/[\d.]+\s*★?\s*\(?([\d,]+)\)?/);
    if (starMatch) {
      return safeNum(starMatch[1]);
    }

    return 0;
  }

  // ============================================
  // 🎯 GET ALL PRODUCT CARDS
  // Flipkart uses: <div data-id="PRODUCT_ID" style="width:25%">
  // ============================================
  function getProductCards() {
    const cards = [];
    const seen = new Set();

    document.querySelectorAll("div[data-id]").forEach((el) => {
      // Skip nested data-id elements
      if (el.querySelector("div[data-id]")) return;

      const id = el.getAttribute("data-id");
      if (!id || seen.has(id)) return;

      // Must be a product card (has image and price)
      const text = el.textContent || "";
      if (!text.includes("₹")) return;
      if (!el.querySelector("img")) return;

      seen.add(id);
      cards.push(el);
    });

    return cards;
  }

  // ============================================
  // 🎯 GET PRODUCT GRID CONTAINER
  // Flipkart uses: <div class="nZIRY7"> as grid
  // ============================================
  function getGridContainer() {
    // Find the main grid container that holds product cards
    const firstCard = document.querySelector('div[data-id][style*="width:25%"]');
    if (firstCard && firstCard.parentElement) {
      return firstCard.parentElement;
    }

    // Fallback: find container with multiple product cards
    const allDivs = document.querySelectorAll("div");
    for (const div of allDivs) {
      const productChildren = div.querySelectorAll(':scope > div[data-id]');
      if (productChildren.length >= 4) {
        return div;
      }
    }

    return null;
  }

  // ============================================
  // 📜 AUTO SCROLL TO LOAD ALL PRODUCTS
  // Flipkart has infinitePage: true
  // ============================================
  async function loadAllProducts() {
    if (state.isLoading) return;
    state.isLoading = true;
    state.stopRequested = false;

    showNotify("⏳ Products load hocche... Scroll kore load hobe");
    showStopButton();

    let prevCount = 0;
    let stableCount = 0;
    let scrollAttempts = 0;

    while (scrollAttempts < config.MAX_SCROLL_ATTEMPTS) {
      if (state.stopRequested) break;

      // Scroll to bottom
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth",
      });

      await sleep(config.SCROLL_DELAY);
      scrollAttempts++;

      const currentCount = getProductCards().length;

      // Update notification
      if (scrollAttempts % 3 === 0 || currentCount !== prevCount) {
        showNotify(
          `⏳ Loading... ${currentCount} products found\n` +
          `Scroll #${scrollAttempts} | Page ~${Math.ceil(currentCount / config.PRODUCTS_PER_PAGE)}`
        );
      }

      // Check if no new products loaded
      if (currentCount === prevCount) {
        stableCount++;
        if (stableCount >= config.STABLE_THRESHOLD) {
          showNotify(`✅ All products loaded! Total: ${currentCount}`);
          break;
        }
      } else {
        stableCount = 0;
      }

      prevCount = currentCount;

      // Check for "end of results" text
      const bodyText = document.body.innerText || "";
      if (/end of results|no more products/i.test(bodyText)) {
        break;
      }
    }

    state.isLoading = false;
    hideStopButton();
    return getProductCards().length;
  }

  // ============================================
  // 🎯 MAIN SORT FUNCTION
  // ============================================
  async function sortByRatings() {
    if (state.isLoading) return;

    // If already sorted, restore
    if (state.isSorted) {
      restoreOriginal();
      return;
    }

    // Step 1: Load all products
    let cards = getProductCards();
    const initialCount = cards.length;

    // Ask user if they want to load all
    if (initialCount <= 80) {
      const loadAll = confirm(
        `Currently ${initialCount} products visible.\n\n` +
        `Total products on Flipkart: ~25,000+\n\n` +
        `OK = Auto-scroll to load ALL products (takes time)\n` +
        `Cancel = Sort only visible products`
      );

      if (loadAll) {
        await loadAllProducts();
        cards = getProductCards();
      }
    }

    if (cards.length === 0) {
      alert("❌ No products found!");
      return;
    }

    // Step 2: Save original order
    state.originalOrder = cards.slice();

    // Step 3: Extract ratings and build data
    showNotify("⏳ Ratings count analyze hocche...");

    const data = cards.map((card, idx) => {
      const ratings = getRatingCount(card);
      const isSponsored = checkSponsored(card);
      return { card, ratings, isSponsored, originalIndex: idx };
    });

    // Step 4: Sort - Sponsored last, then by ratings descending
    data.sort((a, b) => {
      // Sponsored products go to very end
      if (a.isSponsored !== b.isSponsored) {
        return a.isSponsored ? 1 : -1;
      }
      // Sort by ratings count (highest first)
      if (b.ratings !== a.ratings) {
        return b.ratings - a.ratings;
      }
      // Same ratings: maintain original order
      return a.originalIndex - b.originalIndex;
    });

    // Step 5: Rearrange in grid
    showNotify("⏳ Products rearrange hocche...");
    await sleep(100);

    rearrangeGrid(data.map((d) => d.card));

    // Step 6: Add badges
    let sponsoredCount = 0;
    let maxRatings = 0;
    let zeroRatings = 0;

    data.forEach((d, rank) => {
      addBadge(d.card, d.ratings, rank, d.isSponsored);
      if (d.isSponsored) sponsoredCount++;
      else {
        if (d.ratings > maxRatings) maxRatings = d.ratings;
        if (d.ratings === 0) zeroRatings++;
      }
    });

    // Step 7: Done
    state.isSorted = true;
    updateBtnState(true);

    showNotify(
      `✅ ${data.length} products sorted!\n` +
      `🏆 Most rated: ${formatNum(maxRatings)} ratings\n` +
      `📊 0 ratings: ${zeroRatings} products\n` +
      `📢 Sponsored: ${sponsoredCount} (at bottom)`
    );

    // Scroll to top
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ============================================
  // 🎯 CHECK IF SPONSORED
  // ============================================
  function checkSponsored(card) {
    const text = (card.textContent || "").toLowerCase();
    if (text.includes("sponsored")) return true;

    // Check for "Ad" badge
    const spans = card.querySelectorAll("span, div");
    for (const el of spans) {
      if (el.children.length > 0) continue;
      const t = (el.textContent || "").trim();
      if (t === "Ad" || t === "AD" || t === "Sponsored") return true;
    }

    return false;
  }

  // ============================================
  // 🎯 REARRANGE GRID (Maintain 4-column layout)
  // ============================================
  function rearrangeGrid(sortedCards) {
    if (!sortedCards.length) return;

    // Find the parent container of first card
    const firstCard = sortedCards[0];
    const parent = firstCard.parentElement;

    if (!parent) return;

    // Remove all cards from parent
    sortedCards.forEach((card) => {
      if (card.parentElement) {
        card.parentElement.removeChild(card);
      }
    });

    // Re-append in sorted order (maintains grid since parent is flex/grid)
    sortedCards.forEach((card) => {
      parent.appendChild(card);
    });
  }

  // ============================================
  // 🎯 RESTORE ORIGINAL ORDER
  // ============================================
  function restoreOriginal() {
    // Remove all badges
    document.querySelectorAll(".fs-badge").forEach((el) => el.remove());

    if (state.originalOrder.length === 0) return;

    const parent = state.originalOrder[0].parentElement;
    if (!parent) return;

    // Remove all current cards
    state.originalOrder.forEach((card) => {
      if (card.parentElement) {
        card.parentElement.removeChild(card);
      }
    });

    // Re-append in original order
    state.originalOrder.forEach((card) => {
      parent.appendChild(card);
    });

    state.isSorted = false;
    state.originalOrder = [];
    updateBtnState(false);
    showNotify("🔄 Original order restored!");
  }

  // ============================================
  // 🏷️ ADD BADGE TO CARD
  // ============================================
  function addBadge(card, ratings, rank, sponsored) {
    // Remove existing badge
    const existing = card.querySelector(".fs-badge");
    if (existing) existing.remove();

    const badge = document.createElement("div");
    badge.className = "fs-badge";
    badge.style.cssText = `
      position: absolute;
      top: 6px;
      right: 6px;
      z-index: 9999;
      padding: 4px 8px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 700;
      font-family: Arial, sans-serif;
      color: white;
      pointer-events: none;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    `;

    if (sponsored) {
      badge.textContent = "📢 Ad";
      badge.style.background = "linear-gradient(135deg, #757575, #424242)";
    } else if (ratings > 0) {
      badge.textContent = "⭐ " + formatNum(ratings);
      badge.style.background = "linear-gradient(135deg, #1976d2, #0d47a1)";

      // Top 3 get special color
      if (rank === 0) badge.style.background = "linear-gradient(135deg, #ffd700, #ff8f00)";
      else if (rank === 1) badge.style.background = "linear-gradient(135deg, #c0c0c0, #757575)";
      else if (rank === 2) badge.style.background = "linear-gradient(135deg, #cd7f32, #8b4513)";
    } else {
      badge.textContent = "⭐ 0";
      badge.style.background = "linear-gradient(135deg, #9e9e9e, #616161)";
    }

    badge.title = `Ratings: ${ratings.toLocaleString("en-IN")} | Rank: #${rank + 1}`;

    // Make card position relative for badge positioning
    card.style.position = "relative";
    card.appendChild(badge);
  }

  // ============================================
  // 🔘 UI: SORT BUTTON
  // ============================================
  function createSortButton() {
    if (document.getElementById("fs-sort-btn")) return;

    state.sortButton = document.createElement("div");
    state.sortButton.id = "fs-sort-btn";
    state.sortButton.innerHTML = `<span>⭐ Sort by Ratings</span>`;
    state.sortButton.style.cssText = `
      position: fixed;
      bottom: 30px;
      right: 30px;
      z-index: 999999;
      padding: 14px 24px;
      background: linear-gradient(135deg, #1976d2, #0d47a1);
      color: white;
      border-radius: 30px;
      font-size: 15px;
      font-weight: 700;
      font-family: Arial, sans-serif;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(25, 118, 210, 0.4);
      transition: transform 0.2s, box-shadow 0.2s;
      user-select: none;
    `;

    state.sortButton.addEventListener("mouseenter", () => {
      state.sortButton.style.transform = "scale(1.05)";
      state.sortButton.style.boxShadow = "0 6px 24px rgba(25, 118, 210, 0.6)";
    });

    state.sortButton.addEventListener("mouseleave", () => {
      state.sortButton.style.transform = "scale(1)";
      state.sortButton.style.boxShadow = "0 4px 16px rgba(25, 118, 210, 0.4)";
    });

    state.sortButton.addEventListener("click", sortByRatings);
    document.body.appendChild(state.sortButton);
  }

  function updateBtnState(sorted) {
    if (!state.sortButton) return;
    const span = state.sortButton.querySelector("span");
    if (sorted) {
      span.textContent = "🔄 Restore Default";
      state.sortButton.style.background = "linear-gradient(135deg, #2e7d32, #1b5e20)";
    } else {
      span.textContent = "⭐ Sort by Ratings";
      state.sortButton.style.background = "linear-gradient(135deg, #1976d2, #0d47a1)";
    }
  }

  // ============================================
  // 🛑 UI: STOP BUTTON (during loading)
  // ============================================
  function showStopButton() {
    if (document.getElementById("fs-stop-btn")) return;
    const btn = document.createElement("div");
    btn.id = "fs-stop-btn";
    btn.innerHTML = "🛑 STOP Loading";
    btn.style.cssText = `
      position: fixed;
      bottom: 90px;
      right: 30px;
      z-index: 999999;
      padding: 10px 20px;
      background: linear-gradient(135deg, #d32f2f, #b71c1c);
      color: white;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 700;
      font-family: Arial, sans-serif;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(211, 47, 47, 0.4);
    `;
    btn.addEventListener("click", () => {
      state.stopRequested = true;
    });
    document.body.appendChild(btn);
  }

  function hideStopButton() {
    const btn = document.getElementById("fs-stop-btn");
    if (btn) btn.remove();
  }

  // ============================================
  // 📢 UI: NOTIFICATION TOAST
  // ============================================
  function showNotify(msg) {
    let toast = document.getElementById("fs-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "fs-toast";
      toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9999999;
        padding: 14px 24px;
        background: #212121;
        color: white;
        border-radius: 12px;
        font-size: 13px;
        font-family: Arial, sans-serif;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        white-space: pre-line;
        text-align: center;
        max-width: 80vw;
        transition: opacity 0.3s;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = "1";

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.opacity = "0";
    }, 4000);
  }

  // ============================================
  // 🚀 INIT
  // ============================================
  function init() {
    // Wait for products to appear
    const checkInterval = setInterval(() => {
      const cards = getProductCards();
      if (cards.length > 0) {
        clearInterval(checkInterval);
        createSortButton();
      }
    }, 1000);

    // Timeout
    setTimeout(() => {
      clearInterval(checkInterval);
      createSortButton();
    }, 15000);
  }

  // Keyboard shortcut: Alt + S
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      sortByRatings();
    }
  });

  // Start
  if (location.hostname.includes("flipkart.com")) {
    init();
  }
})();
