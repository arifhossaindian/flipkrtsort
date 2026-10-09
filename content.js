// ============================================
// FLIPKART SORT BY REVIEWS - ADVANCED VERSION
// ============================================

(function () {
  "use strict";

  let isSorted = false;
  let originalOrder = [];
  let sortButton = null;
  let observer = null;
  let isLoadingAll = false;

  // ─── Better number extraction ───
  function extractNumber(text) {
    if (!text) return 0;
    
    // Remove commas and extract only digits
    const cleaned = text.replace(/,/g, "").replace(/[^\d]/g, "");
    const num = parseInt(cleaned, 10);
    
    // Filter out unreasonable numbers (like 416000000)
    // Flipkart products rarely have more than 10M reviews
    if (num > 10000000) return 0; // More than 1 crore is fake
    
    return num || 0;
  }

  // ─── Smart review count detection ───
  function getReviewCount(card) {
    let reviewCount = 0;
    
    // Method 1: Look for exact patterns like "1,234 Ratings" or "500 Reviews"
    const allText = card.querySelectorAll("div, span, p");
    
    for (const element of allText) {
      const text = element.textContent.trim();
      
      // Pattern 1: "1,234 Ratings" or "1234 Ratings"
      const ratingsMatch = text.match(/([\d,]+)\s*(Ratings?|Reviews?)/i);
      if (ratingsMatch) {
        const num = extractNumber(ratingsMatch[1]);
        if (num > reviewCount && num < 10000000) {
          reviewCount = num;
        }
      }
      
      // Pattern 2: Look for rating summary like "4.2 ★ 1,234"
      // The number after star rating is usually review count
      const ratingSummary = text.match(/[\d.]+\s*★\s*([\d,]+)/);
      if (ratingSummary) {
        const num = extractNumber(ratingSummary[1]);
        if (num > reviewCount && num < 10000000) {
          reviewCount = num;
        }
      }
    }
    
    // Method 2: Look in specific rating container
    const ratingDivs = card.querySelectorAll('[class*="rating"], [class*="Rating"]');
    for (const div of ratingDivs) {
      const spans = div.querySelectorAll("span");
      for (const span of spans) {
        const text = span.textContent.trim();
        const num = extractNumber(text);
        if (num > 0 && num < 10000000 && num > reviewCount) {
          reviewCount = num;
        }
      }
    }
    
    return reviewCount;
  }

  // ─── Get product container ───
  function getProductContainer() {
    // Try common Flipkart product grid selectors
    const selectors = [
      'div[data-id]',
      'div._1AtVbE',
      'div.DOjaWF',
      'div._75nhsW',
      '[class*="product"]'
    ];
    
    for (const selector of selectors) {
      const containers = document.querySelectorAll(selector);
      for (const container of containers) {
        const children = container.children;
        if (children.length >= 3) {
          // Check if children are product-like
          let productCount = 0;
          for (const child of children) {
            const text = child.textContent || "";
            if (text.includes("₹") || text.includes("★") || text.includes("Rating")) {
              productCount++;
            }
          }
          if (productCount >= 3) {
            return container;
          }
        }
      }
    }
    
    // Fallback: Find any div with multiple product cards
    const allDivs = document.querySelectorAll("div");
    for (const div of allDivs) {
      const children = div.children;
      if (children.length >= 10) {
        let productCount = 0;
        for (const child of children) {
          const text = child.textContent || "";
          if (text.includes("₹") && text.includes("★")) {
            productCount++;
          }
        }
        if (productCount >= 10) {
          return div;
        }
      }
    }
    
    return null;
  }

  // ─── Get all product cards ───
  function getProductCards() {
    const container = getProductContainer();
    if (!container) return [];
    
    return Array.from(container.children).filter((child) => {
      const text = child.textContent || "";
      return (
        text.includes("★") ||
        (text.includes("₹") && text.length > 100)
      );
    });
  }

  // ─── Load more products by scrolling ───
  async function loadAllProducts() {
    if (isLoadingAll) return;
    isLoadingAll = true;
    
    showNotification("⏳ Loading all products... This may take time");
    
    let previousCount = 0;
    let stableCount = 0;
    
    // Scroll to bottom multiple times to load more products
    for (let i = 0; i < 50; i++) { // Max 50 scroll attempts
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(1500); // Wait for products to load
      
      const currentCount = getProductCards().length;
      
      if (currentCount === previousCount) {
        stableCount++;
        if (stableCount >= 3) {
          // No new products loaded 3 times, we're done
          break;
        }
      } else {
        stableCount = 0;
      }
      
      previousCount = currentCount;
      showNotification(`⏳ Loading... ${currentCount} products loaded`);
    }
    
    isLoadingAll = false;
    showNotification(`✅ Loaded ${previousCount} products total`);
    return previousCount;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Sort products ───
  async function sortByReviews() {
    const container = getProductContainer();
    if (!container) {
      alert("❌ Could not find products. Please scroll down to load products first.");
      return;
    }

    let cards = getProductCards();
    if (cards.length === 0) {
      alert("❌ No products found!");
      return;
    }

    // Ask user if they want to load all products
    if (cards.length < 50) {
      const loadAll = confirm(
        `Found only ${cards.length} products on this page.\n\n` +
        `Click OK to load ALL products (may take time)\n` +
        `Click Cancel to sort only current page`
      );
      
      if (loadAll) {
        await loadAllProducts();
        cards = getProductCards(); // Refresh cards list
      }
    }

    // Save original order
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

    // Build data array with review counts
    const cardData = cards.map((card, index) => ({
      card: card,
      reviewCount: getReviewCount(card),
      originalIndex: index
    }));

    // Sort by review count (descending), then by original order if equal
    cardData.sort((a, b) => {
      if (b.reviewCount !== a.reviewCount) {
        return b.reviewCount - a.reviewCount;
      }
      return a.originalIndex - b.originalIndex;
    });

    // Remove all cards
    cardData.forEach(({ card }) => container.removeChild(card));

    // Re-append in sorted order with badges
    cardData.forEach(({ card, reviewCount }) => {
      addReviewBadge(card, reviewCount);
      container.appendChild(card);
    });

    isSorted = true;
    updateButtonState(true);
    showNotification(`✅ Sorted ${cardData.length} products by reviews!`);
    
    // Scroll to top to see results
    window.scrollTo(0, 0);
  }

  // ─── Add review badge ───
  function addReviewBadge(card, count) {
    const existing = card.querySelector(".flipsort-badge");
    if (existing) existing.remove();

    const badge = document.createElement("div");
    badge.className = "flipsort-badge";
    
    if (count > 0) {
      badge.textContent = `📝 ${count.toLocaleString()}`;
    } else {
      badge.textContent = `📝 0`;
      badge.style.background = "linear-gradient(135deg, #9e9e9e, #757575)";
    }
    
    badge.title = `Review count: ${count}`;
    card.style.position = "relative";
    card.appendChild(badge);
  }

  // ─── Create sort button ───
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

  // ─── Notification ───
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

  // ─── Make draggable ───
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

  // ─── Watch for page changes ───
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

  // Keyboard shortcut
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      sortByReviews();
    }
  });

  // Start
  if (location.hostname.includes("flipkart.com")) {
    init();
  }
})();
