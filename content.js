// ============================================
// FLIPKART SORT BY REVIEWS v4.0 - FINAL FIX
// ============================================

(function () {
  "use strict";

  // ─── State ───
  const state = {
    isSorted: false,
    originalOrder: [],
    sortButton: null,
    observer: null,
    isLoadingAll: false,
  };

  // ─── Config ───
  const config = {
    MAX_DIGITS: 8,           // 8 digit er beshi number = FAKE
    MAX_REVIEWS: 9999999,    // Max 99,99,999 reviews possible
    SCROLL_ATTEMPTS: 80,
    SCROLL_DELAY: 2000,
    STABLE_THRESHOLD: 4,
    MIN_PRODUCTS_FOR_PROMPT: 30,
    MAX_PRODUCTS_LIMIT: 5000,
  };

  // ─── Utility: Sleep ───
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ============================================
  // 🔒 CORE FIX #1: BULLETPROOF NUMBER PARSER
  // ============================================
  // Ei function kono boro number, scientific notation,
  // ba fake number return korbe NA. Guaranteed.
  // ============================================

  function safeParseReviewNumber(text) {
    // Step 1: Must be a string
    if (!text || typeof text !== "string") return 0;

    // Step 2: Extract ONLY digits (remove everything else)
    const digitsOnly = text.replace(/[^0-9]/g, "");

    // Step 3: No digits found
    if (!digitsOnly || digitsOnly.length === 0) return 0;

    // Step 4: 🔒 CRITICAL - String length check BEFORE parsing
    // 8 digit er beshi hole = definitely fake number
    // Example: "435000000000000000000000000" = 27 digits = REJECT
    if (digitsOnly.length > config.MAX_DIGITS) return 0;

    // Step 5: Parse the number
    const num = parseInt(digitsOnly, 10);

    // Step 6: Validate
    if (isNaN(num)) return 0;
    if (!isFinite(num)) return 0;
    if (num < 0) return 0;
    if (num > config.MAX_REVIEWS) return 0;

    return num;
  }

  // ============================================
  // 🔒 CORE FIX #2: CLEAN NUMBER FORMATTER
  // ============================================
  // Kono scientific notation (5e+60) show korbe NA
  // ============================================

  function formatNumber(num) {
    // Safety: Reject bad numbers
    if (!num || isNaN(num) || !isFinite(num)) return "0";
    if (num < 0) return "0";
    if (num > config.MAX_REVIEWS) return "0";

    if (num >= 1000000) {
      const val = (num / 1000000).toFixed(1);
      return val + "M";
    }

    if (num >= 1000) {
      const val = (num / 1000).toFixed(1);
      return val + "K";
    }

    return num.toString();
  }

  // ============================================
  // 🔒 CORE FIX #3: SPONSORED PRODUCT DETECTION
  // ============================================

  function isSponsoredProduct(card) {
    if (!card) return false;

    const text = (card.textContent || "").toLowerCase();

    // Check for "Sponsored" text
    if (text.includes("sponsored")) return true;

    // Check for "Ad" label (Flipkart shows "Ad" for sponsored)
    const adLabels = card.querySelectorAll("span, div, p");
    for (const el of adLabels) {
      const elText = el.textContent.trim();
      // Exact match for "Ad" or "Sponsored"
      if (elText === "Ad" || elText === "Sponsored" || elText === "AD") {
        return true;
      }
    }

    return false;
  }

  // ============================================
  // 🔒 CORE FIX #4: ACCURATE REVIEW DETECTION
  // ============================================
  // Shudhu "Ratings" ba "Reviews" er sathe
  // directly connected number catch korbe.
  // Price, ID, timestamp catch korbe NA.
  // ============================================

  function getReviewCount(card) {
    if (!card) return 0;

    // Get full text of the card
    const fullText = card.textContent || "";

    // ─── Strategy 1: "X Ratings & Y Reviews" format ───
    const combinedPattern = fullText.match(
      /([\d,]+)\s*Ratings?\s*[&and]*\s*([\d,]+)\s*Reviews?/i
    );
    if (combinedPattern) {
      const ratingsCount = safeParseReviewNumber(combinedPattern[1]);
      const reviewsCount = safeParseReviewNumber(combinedPattern[2]);
      const result = Math.max(ratingsCount, reviewsCount);
      if (result > 0) return result;
    }

    // ─── Strategy 2: "X Ratings" format ───
    const ratingsPattern = fullText.match(/([\d,]+)\s*Ratings?/i);
    if (ratingsPattern) {
      const count = safeParseReviewNumber(ratingsPattern[1]);
      if (count > 0) return count;
    }

    // ─── Strategy 3: "X Reviews" format ───
    const reviewsPattern = fullText.match(/([\d,]+)\s*Reviews?/i);
    if (reviewsPattern) {
      const count = safeParseReviewNumber(reviewsPattern[1]);
      if (count > 0) return count;
    }

    // ─── Strategy 4: "(X)" format near rating context ───
    // Look for numbers in parentheses near star/rating text
    const parenPattern = fullText.match(/([\d.]+)\s*★\s*\(?([\d,]+)\)?/);
    if (parenPattern) {
      const count = safeParseReviewNumber(parenPattern[2]);
      if (count > 0) return count;
    }

    // ─── Strategy 5: Look for standalone number near "Rating" keyword ───
    // Split text into segments and find numbers near keywords
    const segments = fullText.split(/\s+/);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i].toLowerCase();

      if (seg.includes("rating") || seg.includes("review")) {
        // Check previous 2 segments for a number
        for (let j = Math.max(0, i - 2); j < i; j++) {
          const prevSeg = segments[j];
          const count = safeParseReviewNumber(prevSeg);
          if (count > 0) return count;
        }

        // Check next 2 segments for a number
        for (let j = i + 1; j <= Math.min(segments.length - 1, i + 2); j++) {
          const nextSeg = segments[j];
          const count = safeParseReviewNumber(nextSeg);
          if (count > 0) return count;
        }
      }
    }

    // ─── Strategy 6: Look in specific DOM elements ───
    // Find elements that contain rating info
    const allElements = card.querySelectorAll("span, div, p, a");
    for (const el of allElements) {
      const elText = el.textContent.trim();

      // Skip if text is too long (probably product name or description)
      if (elText.length > 100) continue;

      // Check if this element has rating/review keywords
      const hasKeyword =
        elText.toLowerCase().includes("rating") ||
        elText.toLowerCase().includes("review");

      if (hasKeyword) {
        // Extract number from this specific element
        const numMatch = elText.match(/([\d,]+)/);
        if (numMatch) {
          const count = safeParseReviewNumber(numMatch[1]);
          if (count > 0) return count;
        }

        // Check child elements
        const children = el.querySelectorAll("span, div");
        for (const child of children) {
          const childText = child.textContent.trim();
          const childCount = safeParseReviewNumber(childText);
          if (childCount > 0) return childCount;
        }
      }
    }

    // ─── Strategy 7: Look for rating score followed by count ───
    // Pattern: "4.2" followed by a number (common in Flipkart)
    const ratingScorePattern = fullText.match(
      /([\d.]+)\s*(?:★|out of 5|\/5)\s*([\d,]+)/i
    );
    if (ratingScorePattern) {
      const count = safeParseReviewNumber(ratingScorePattern[2]);
      if (count > 0) return count;
    }

    // No valid review count found
    return 0;
  }

  // ─── Get Product Container ───
  function getProductContainer() {
    // Strategy 1: Common Flipkart selectors
    const selectors = [
      "div[data-id]",
      "div._1AtVbE",
      "div.DOjaWF",
      "div._75nhsW",
      "div._36fxV",
    ];

    for (const selector of selectors) {
      const containers = document.querySelectorAll(selector);
      for (const container of containers) {
        const children = Array.from(container.children);
        if (children.length >= 3) {
          let productCount = 0;
          for (const child of children) {
            const text = child.textContent || "";
            if (text.includes("₹") || text.includes("★")) {
              productCount++;
            }
          }
          if (productCount >= 3) return container;
        }
      }
    }

    // Strategy 2: Find any div with many product-like children
    const allDivs = document.querySelectorAll("div");
    for (const div of allDivs) {
      const children = Array.from(div.children);
      if (children.length >= 8) {
        let productCount = 0;
        for (const child of children) {
          const text = child.textContent || "";
          if (text.includes("₹") && text.includes("★")) {
            productCount++;
          }
        }
        if (productCount >= 8) return div;
      }
    }

    return null;
  }

  // ─── Get Product Cards ───
  function getProductCards() {
    const container = getProductContainer();
    if (!container) return [];

    return Array.from(container.children).filter((child) => {
      const text = child.textContent || "";
      const hasPrice = text.includes("₹");
      const hasRating = text.includes("★");
      const hasImage = child.querySelector("img");
      const score = (hasPrice ? 1 : 0) + (hasRating ? 1 : 0) + (hasImage ? 1 : 0);
      return score >= 2;
    });
  }

  // ─── Load All Products ───
  async function loadAllProducts() {
    if (state.isLoadingAll) return 0;
    state.isLoadingAll = true;

    showNotification("⏳ Loading all products... Please wait");

    let previousCount = 0;
    let stableCount = 0;

    for (let i = 0; i < config.SCROLL_ATTEMPTS; i++) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      await sleep(config.SCROLL_DELAY);

      const currentCount = getProductCards().length;
      showNotification(`⏳ Loading... ${currentCount} products found`);

      if (currentCount === previousCount) {
        stableCount++;
        if (stableCount >= config.STABLE_THRESHOLD) break;
      } else {
        stableCount = 0;
      }

      previousCount = currentCount;

      if (currentCount >= config.MAX_PRODUCTS_LIMIT) {
        showNotification(`⚠️ Stopped at ${currentCount} products`);
        break;
      }
    }

    state.isLoadingAll = false;
    return previousCount;
  }

  // ============================================
  // 🔒 CORE FIX #5: PROPER SORTING LOGIC
  // ============================================
  // Sponsored products bottom e jabe
  // Regular products review count diye sort hobe
  // ============================================

  async function sortByReviews() {
    const container = getProductContainer();

    if (!container) {
      alert("❌ Products not found! Scroll down first to load products.");
      return;
    }

    let cards = getProductCards();

    if (cards.length === 0) {
      alert("❌ No products found!");
      return;
    }

    // Prompt to load all products
    if (cards.length < config.MIN_PRODUCTS_FOR_PROMPT) {
      const loadAll = confirm(
        `Found ${cards.length} products on this page.\n\n` +
        `OK = Load ALL products (takes 2-5 min)\n` +
        `Cancel = Sort only current page`
      );

      if (loadAll) {
        await loadAllProducts();
        cards = getProductCards();
      }
    }

    // Save original order
    if (state.originalOrder.length === 0) {
      state.originalOrder = [...cards];
    }

    // Restore if already sorted
    if (state.isSorted) {
      cards.forEach((card) => container.removeChild(card));
      state.originalOrder.forEach((card) => container.appendChild(card));
      state.isSorted = false;
      updateButtonState(false);
      showNotification("🔄 Original order restored!");
      return;
    }

    showNotification("⏳ Analyzing review counts...");

    // Build data array
    const cardData = cards.map((card, index) => {
      const reviewCount = getReviewCount(card);
      const sponsored = isSponsoredProduct(card);

      return {
        card,
        reviewCount,
        sponsored,
        originalIndex: index,
      };
    });

    // ─── SORTING LOGIC ───
    // 1. Sponsored products ALWAYS go to bottom
    // 2. Regular products sorted by review count (descending)
    // 3. If same review count, maintain original order
    cardData.sort((a, b) => {
      // Sponsored products go to bottom
      if (a.sponsored && !b.sponsored) return 1;
      if (!a.sponsored && b.sponsored) return -1;

      // Both sponsored or both regular
      if (b.reviewCount !== a.reviewCount) {
        return b.reviewCount - a.reviewCount; // Higher reviews first
      }

      return a.originalIndex - b.originalIndex; // Stable sort
    });

    // Remove all cards
    showNotification("⏳ Rearranging products...");
    cardData.forEach(({ card }) => container.removeChild(card));

    // Re-append in sorted order
    let sponsoredCount = 0;
    let regularCount = 0;

    cardData.forEach(({ card, reviewCount, sponsored }, sortedIndex) => {
      // Add badge
      addReviewBadge(card, reviewCount, sortedIndex, sponsored);

      // Add sponsored label if detected
      if (sponsored) {
        addSponsoredLabel(card);
        sponsoredCount++;
      } else {
        regularCount++;
      }

      container.appendChild(card);
    });

    state.isSorted = true;
    updateButtonState(true);

    // Summary
    const regularProducts = cardData.filter((d) => !d.sponsored);
    const maxReviews = regularProducts.length > 0 ? regularProducts[0].reviewCount : 0;

    showNotification(
      `✅ Sorted ${regularCount} products + ${sponsoredCount} sponsored\n` +
      `Most reviewed: ${formatNumber(maxReviews)} reviews`
    );

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ─── Add Review Badge ───
  function addReviewBadge(card, count, sortedIndex, sponsored) {
    // Remove existing badge
    const existing = card.querySelector(".flipsort-badge");
    if (existing) existing.remove();

    // 🔒 FINAL SAFETY CHECK - Never show bad numbers
    if (count > config.MAX_REVIEWS || count < 0 || isNaN(count) || !isFinite(count)) {
      count = 0;
    }

    const badge = document.createElement("div");
    badge.className = "flipsort-badge";

    if (sponsored) {
      badge.textContent = `📢 Sponsored`;
      badge.style.background = "linear-gradient(135deg, #9e9e9e, #616161)";
    } else if (count > 0) {
      badge.textContent = `📝 ${formatNumber(count)}`;
      badge.style.background = "linear-gradient(135deg, #ff9800, #f57c00)";
    } else {
      badge.textContent = `📝 0`;
      badge.style.background = "linear-gradient(135deg, #bdbdbd, #9e9e9e)";
    }

    badge.title = `Reviews: ${count.toLocaleString()} | Position: #${sortedIndex + 1}`;

    // Add rank for top 3
    if (!sponsored && sortedIndex < 3) {
      const rank = document.createElement("span");
      rank.textContent = ` #${sortedIndex + 1}`;
      rank.style.fontWeight = "700";
      rank.style.marginLeft = "3px";
      badge.appendChild(rank);
    }

    card.style.position = "relative";
    card.appendChild(badge);
  }

  // ─── Add Sponsored Label ───
  function addSponsoredLabel(card) {
    const existing = card.querySelector(".flipsort-sponsored");
    if (existing) existing.remove();

    const label = document.createElement("div");
    label.className = "flipsort-sponsored";
    label.textContent = "📢 SPONSORED";
    label.title = "This is a sponsored/ad product";

    card.style.position = "relative";
    card.appendChild(label);
  }

  // ─── Create Sort Button ───
  function createSortButton() {
    if (document.getElementById("flipsort-btn")) return;

    state.sortButton = document.createElement("div");
    state.sortButton.id = "flipsort-btn";
    state.sortButton.innerHTML = `
      <div class="flipsort-btn-inner">
        <span class="flipsort-icon">📊</span>
        <span class="flipsort-text">Sort by Reviews</span>
      </div>
    `;

    state.sortButton.addEventListener("click", sortByReviews);
    document.body.appendChild(state.sortButton);
    makeDraggable(state.sortButton);
  }

  // ─── Update Button State ───
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

  // ─── Notification Toast ───
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

  // ─── Make Draggable ───
  function makeDraggable(el) {
    let isDragging = false;
    let startX, startY, initialX, initialY;

    el.addEventListener("mousedown", (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;
      el.style.transition = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = initialX + dx + "px";
      el.style.top = initialY + dy + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
      el.style.transition = "";
    });
  }

  // ─── Watch Page Changes ───
  function watchForPageChanges() {
    let lastURL = location.href;

    state.observer = new MutationObserver(() => {
      if (location.href !== lastURL) {
        lastURL = location.href;
        state.isSorted = false;
        state.originalOrder = [];
      }
    });

    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Initialize ───
  function init() {
    const checkInterval = setInterval(() => {
      const cards = getProductCards();
      if (cards.length > 0) {
        clearInterval(checkInterval);
        createSortButton();
        watchForPageChanges();
      }
    }, 1500);

    setTimeout(() => {
      clearInterval(checkInterval);
      createSortButton();
      watchForPageChanges();
    }, 30000);
  }

  // ─── Keyboard Shortcut ───
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
