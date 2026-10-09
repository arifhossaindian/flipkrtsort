// ============================================
// FLIPKART SORT BY REVIEWS - CONTENT SCRIPT
// ============================================

(function () {
  "use strict";

  // State
  let isSorted = false;
  let originalOrder = [];
  let sortButton = null;
  let observer = null;

  // ─── Utility: Extract number from text ───
  function extractNumber(text) {
    if (!text) return 0;
    // "1,234 Ratings" -> 1234
    // "500 Reviews" -> 500
    const cleaned = text.replace(/,/g, "").replace(/[^\d]/g, "");
    return parseInt(cleaned, 10) || 0;
  }

  // ─── Find review/rating count from a product card ───
  function getReviewCount(card) {
    // Strategy 1: Look for text containing "Rating" or "Review"
    const allElements = card.querySelectorAll("span, div, p");
    let maxCount = 0;

    for (const el of allElements) {
      const text = el.textContent.trim();

      // Match patterns like "1,234 Ratings", "500 Reviews", "(1234)"
      if (
        text.match(/[\d,]+\s*(Ratings?|Reviews?)/i) ||
        text.match(/\([\d,]+\)/)
      ) {
        const num = extractNumber(text);
        if (num > maxCount) maxCount = num;
      }
    }

    // Strategy 2: Look for the rating summary section
    // Flipkart often shows "4.2 ★ 1,234 Ratings 234 Reviews"
    const ratingContainer = card.querySelector('[class*="rating"]');
    if (ratingContainer) {
      const spans = ratingContainer.querySelectorAll("span");
      for (const span of spans) {
        const text = span.textContent.trim();
        const num = extractNumber(text);
        if (num > maxCount) maxCount = num;
      }
    }

    // Strategy 3: Broader search for any number near "rating" text
    if (maxCount === 0) {
      const allSpans = card.querySelectorAll("span");
      for (let i = 0; i < allSpans.length; i++) {
        const text = allSpans[i].textContent.trim().toLowerCase();
        if (text.includes("rating") || text.includes("review")) {
          // Check previous sibling or nearby elements for numbers
          for (let j = Math.max(0, i - 2); j <= Math.min(allSpans.length - 1, i + 2); j++) {
            const nearbyText = allSpans[j].textContent.trim();
            const num = extractNumber(nearbyText);
            if (num > 0 && num > maxCount) {
              maxCount = num;
            }
          }
        }
      }
    }

    return maxCount;
  }

  // ─── Get the product container (parent of all product cards) ───
  function getProductContainer() {
    // Flipkart search results are usually in a div with specific structure
    // Try multiple selectors for resilience
    const selectors = [
      'div[data-id]',                    // Products often have data-id
      '.DOjaWF.GYdEmp',                 // Common grid container
      'div._1AtVbE',                    // Another common container
    ];

    // Strategy: Find the container that holds multiple product-like cards
    const allDivs = document.querySelectorAll("div");

    for (const div of allDivs) {
      const directChildren = div.children;
      if (directChildren.length >= 3) {
        // Check if children look like product cards
        let productLikeChildren = 0;
        for (const child of directChildren) {
          const text = child.textContent || "";
          if (
            text.includes("★") ||
            text.includes("Rating") ||
            text.includes("₹")
          ) {
            productLikeChildren++;
          }
        }
        if (productLikeChildren >= 3) {
          return div;
        }
      }
    }

    return null;
  }

  // ─── Collect all product cards ───
  function getProductCards() {
    const container = getProductContainer();
    if (!container) {
      console.warn("[FlipSort] Could not find product container");
      return [];
    }

    return Array.from(container.children).filter((child) => {
      const text = child.textContent || "";
      return (
        text.includes("★") ||
        text.includes("₹") ||
        text.includes("Rating")
      );
    });
  }

  // ─── Sort products by review count ───
  function sortByReviews() {
    const container = getProductContainer();
    if (!container) {
      alert("❌ Could not find products on this page. Try scrolling down first.");
      return;
    }

    const cards = getProductCards();
    if (cards.length === 0) {
      alert("❌ No product cards found!");
      return;
    }

    // Save original order if not already saved
    if (originalOrder.length === 0) {
      originalOrder = [...cards];
    }

    if (isSorted) {
      // Restore original order
      cards.forEach((card) => container.removeChild(card));
      originalOrder.forEach((card) => container.appendChild(card));
      isSorted = false;
      updateButtonState(false);
      showNotification("🔄 Original order restored!");
      return;
    }

    // Build array of { card, reviewCount }
    const cardData = cards.map((card) => ({
      card: card,
      reviewCount: getReviewCount(card),
    }));

    // Sort descending by review count
    cardData.sort((a, b) => b.reviewCount - a.reviewCount);

    // Remove all cards from container
    cardData.forEach(({ card }) => container.removeChild(card));

    // Re-append in sorted order
    cardData.forEach(({ card, reviewCount }) => {
      // Add a badge showing the review count
      addReviewBadge(card, reviewCount);
      container.appendChild(card);
    });

    isSorted = true;
    updateButtonState(true);
    showNotification(
      `✅ Sorted ${cardData.length} products by reviews! (Most reviewed first)`
    );
  }

  // ─── Add review count badge to card ───
  function addReviewBadge(card, count) {
    // Remove existing badge if any
    const existing = card.querySelector(".flipsort-badge");
    if (existing) existing.remove();

    const badge = document.createElement("div");
    badge.className = "flipsort-badge";
    badge.textContent = `📝 ${count.toLocaleString()} Reviews`;
    badge.title = "Review count detected by FlipSort";

    // Position it at top-right of the card
    card.style.position = "relative";
    card.appendChild(badge);
  }

  // ─── Create the floating sort button ───
  function createSortButton() {
    if (document.getElementById("flipsort-btn")) return;

    sortButton = document.createElement("div");
    sortButton.id = "flipsort-btn";
    sortButton.innerHTML = `
      <div class="flipsort-btn-inner">
        <span class="flipsort-icon">📊</span>
        <span class="flipsort-text">Sort by Reviews</span>
      </div>
    `;
    sortButton.addEventListener("click", sortByReviews);
    document.body.appendChild(sortButton);

    // Make it draggable
    makeDraggable(sortButton);
  }

  function updateButtonState(sorted) {
    if (!sortButton) return;
    const textEl = sortButton.querySelector(".flipsort-text");
    if (sorted) {
      textEl.textContent = "Restore Default";
      sortButton.classList.add("flipsort-active");
    } else {
      textEl.textContent = "Sort by Reviews";
      sortButton.classList.remove("flipsort-active");
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
    }, 3000);
  }

  // ─── Make button draggable ───
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

  // ─── Auto-detect page changes (Flipkart is SPA) ───
  function watchForPageChanges() {
    let lastURL = location.href;

    observer = new MutationObserver(() => {
      if (location.href !== lastURL) {
        lastURL = location.href;
        isSorted = false;
        originalOrder = [];
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Initialize ───
  function init() {
    // Wait for products to load
    const checkInterval = setInterval(() => {
      const cards = getProductCards();
      if (cards.length > 0) {
        clearInterval(checkInterval);
        createSortButton();
        watchForPageChanges();
        console.log(
          `[FlipSort] ✅ Initialized! Found ${cards.length} products.`
        );
      }
    }, 1500);

    // Timeout after 30 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      // Still create button even if no products found yet
      createSortButton();
      watchForPageChanges();
    }, 30000);
  }

  // Keyboard shortcut: Alt + S to sort
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      sortByReviews();
    }
  });

  // Start
  if (
    location.hostname.includes("flipkart.com") &&
    (location.search || location.pathname.includes("/search"))
  ) {
    init();
  } else {
    // For non-search pages, still watch for navigation
    watchForPageChanges();
    // Re-check after navigation
    setInterval(() => {
      if (
        location.search ||
        location.pathname.includes("/search")
      ) {
        if (!document.getElementById("flipsort-btn")) {
          init();
        }
      }
    }, 3000);
  }
})();