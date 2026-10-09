// ============================================
// FLIPKART SORT BY REVIEWS - ULTRA ADVANCED VERSION
// ============================================
// Version: 3.0.0
// Author: Advanced FlipSort
// ============================================

(function () {
  "use strict";

  // ─── State Management ───
  const state = {
    isSorted: false,
    originalOrder: [],
    sortButton: null,
    observer: null,
    isLoadingAll: false,
    debugMode: false,
    maxReviewCount: 10000000, // 1 crore max reasonable limit
  };

  // ─── Configuration ───
  const config = {
    scrollAttempts: 100,
    scrollDelay: 2000,
    stableCountThreshold: 5,
    minProductsForLoadAll: 30,
    maxReasonableReviews: 10000000, // 1 crore
    suspiciousNumberThreshold: 100000000, // 10 crore
  };

  // ─── Utility: Sleep ───
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Utility: Safe Number Extraction ───
  function extractNumber(text) {
    if (!text || typeof text !== "string") return 0;
    
    // Remove commas, spaces, and extract digits
    const cleaned = text.replace(/[,\s]/g, "").replace(/[^\d]/g, "");
    
    if (!cleaned) return 0;
    
    const num = parseInt(cleaned, 10);
    
    // Validate: Must be a reasonable number
    if (!Number.isFinite(num)) return 0;
    if (num < 0) return 0;
    if (num > config.maxReasonableReviews) return 0; // Filter out absurd numbers
    
    return num;
  }

  // ─── Utility: Format Large Numbers ───
  function formatNumber(num) {
    if (!num || num === 0) return "0";
    
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M";
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K";
    }
    
    return num.toLocaleString();
  }

  // ─── Utility: Validate if number looks like review count ───
  function isValidReviewCount(num, context) {
    if (!num || num === 0) return false;
    if (num > config.maxReasonableReviews) return false;
    if (num > config.suspiciousNumberThreshold) return false;
    
    // Check context - review counts usually appear with specific keywords
    if (context) {
      const lowerContext = context.toLowerCase();
      const hasReviewKeyword = 
        lowerContext.includes("rating") ||
        lowerContext.includes("review") ||
        lowerContext.includes("★") ||
        lowerContext.includes("star");
      
      if (hasReviewKeyword) return true;
    }
    
    return false;
  }

  // ─── Review Count Detection: Strategy 1 - Pattern Matching ───
  function detectReviewsByPattern(card) {
    const reviewCounts = [];
    const allElements = card.querySelectorAll("div, span, p, a");
    
    for (const element of allElements) {
      const text = element.textContent.trim();
      if (!text || text.length < 5) continue;
      
      // Pattern 1: "1,234 Ratings" or "1234 Ratings"
      const pattern1 = text.match(/([\d,]+)\s*(Ratings?|Reviews?)/i);
      if (pattern1) {
        const num = extractNumber(pattern1[1]);
        if (isValidReviewCount(num, text)) {
          reviewCounts.push({ num, source: "pattern1", text });
        }
      }
      
      // Pattern 2: "4.2 ★ 1,234" (rating followed by count)
      const pattern2 = text.match(/([\d.]+)\s*★\s*([\d,]+)/);
      if (pattern2) {
        const num = extractNumber(pattern2[2]);
        if (isValidReviewCount(num, text)) {
          reviewCounts.push({ num, source: "pattern2", text });
        }
      }
      
      // Pattern 3: "(1,234)" in parentheses near rating context
      const pattern3 = text.match(/\(([\d,]+)\)/);
      if (pattern3) {
        const num = extractNumber(pattern3[1]);
        const parentText = element.parentElement?.textContent || "";
        if (isValidReviewCount(num, parentText)) {
          reviewCounts.push({ num, source: "pattern3", text });
        }
      }
      
      // Pattern 4: "1,234 Ratings & 234 Reviews"
      const pattern4 = text.match(/([\d,]+)\s*Ratings?.*?([\d,]+)\s*Reviews?/i);
      if (pattern4) {
        const num1 = extractNumber(pattern4[1]);
        const num2 = extractNumber(pattern4[2]);
        if (isValidReviewCount(num1, text)) {
          reviewCounts.push({ num: num1, source: "pattern4-ratings", text });
        }
        if (isValidReviewCount(num2, text)) {
          reviewCounts.push({ num: num2, source: "pattern4-reviews", text });
        }
      }
    }
    
    // Return the highest valid count
    if (reviewCounts.length > 0) {
      const sorted = reviewCounts.sort((a, b) => b.num - a.num);
      if (state.debugMode) {
        console.log("[FlipSort] Pattern detection:", sorted[0]);
      }
      return sorted[0].num;
    }
    
    return 0;
  }

  // ─── Review Count Detection: Strategy 2 - DOM Structure Analysis ───
  function detectReviewsByStructure(card) {
    const reviewCounts = [];
    
    // Look for rating containers
    const ratingSelectors = [
      '[class*="rating"]',
      '[class*="Rating"]',
      '[class*="stars"]',
      '[class*="Stars"]',
      '[class*="review"]',
      '[class*="Review"]',
    ];
    
    for (const selector of ratingSelectors) {
      const containers = card.querySelectorAll(selector);
      
      for (const container of containers) {
        const text = container.textContent.trim();
        const allSpans = container.querySelectorAll("span, div");
        
        for (const span of allSpans) {
          const spanText = span.textContent.trim();
          const num = extractNumber(spanText);
          
          if (isValidReviewCount(num, text)) {
            reviewCounts.push({ num, source: "structure", text: spanText });
          }
        }
        
        // Also check the container itself
        const containerNum = extractNumber(text);
        if (isValidReviewCount(containerNum, text)) {
          reviewCounts.push({ num: containerNum, source: "structure-container", text });
        }
      }
    }
    
    // Look for sibling elements near rating display
    const starElements = card.querySelectorAll('[class*="star"], [class*="Star"]');
    for (const starEl of starElements) {
      // Check next sibling
      const nextSibling = starEl.nextElementSibling;
      if (nextSibling) {
        const text = nextSibling.textContent.trim();
        const num = extractNumber(text);
        if (isValidReviewCount(num, text)) {
          reviewCounts.push({ num, source: "structure-sibling", text });
        }
      }
      
      // Check parent's children
      const parent = starEl.parentElement;
      if (parent) {
        const siblings = parent.children;
        for (const sibling of siblings) {
          const text = sibling.textContent.trim();
          const num = extractNumber(text);
          if (isValidReviewCount(num, text)) {
            reviewCounts.push({ num, source: "structure-parent-children", text });
          }
        }
      }
    }
    
    if (reviewCounts.length > 0) {
      const sorted = reviewCounts.sort((a, b) => b.num - a.num);
      if (state.debugMode) {
        console.log("[FlipSort] Structure detection:", sorted[0]);
      }
      return sorted[0].num;
    }
    
    return 0;
  }

  // ─── Review Count Detection: Strategy 3 - Text Proximity Analysis ───
  function detectReviewsByProximity(card) {
    const reviewCounts = [];
    const allSpans = card.querySelectorAll("span, div, p");
    
    for (let i = 0; i < allSpans.length; i++) {
      const element = allSpans[i];
      const text = element.textContent.trim();
      
      // Check if this element contains review keywords
      const hasKeyword = 
        text.toLowerCase().includes("rating") ||
        text.toLowerCase().includes("review") ||
        text.includes("★");
      
      if (hasKeyword) {
        // Extract number from this element
        const num = extractNumber(text);
        if (isValidReviewCount(num, text)) {
          reviewCounts.push({ num, source: "proximity-keyword", text, index: i });
        }
        
        // Check nearby elements (previous and next 3 elements)
        for (let j = Math.max(0, i - 3); j <= Math.min(allSpans.length - 1, i + 3); j++) {
          if (j === i) continue;
          
          const nearbyEl = allSpans[j];
          const nearbyText = nearbyEl.textContent.trim();
          const nearbyNum = extractNumber(nearbyText);
          
          if (isValidReviewCount(nearbyNum, text)) {
            reviewCounts.push({ 
              num: nearbyNum, 
              source: "proximity-nearby", 
              text: nearbyText,
              distance: Math.abs(i - j)
            });
          }
        }
      }
    }
    
    if (reviewCounts.length > 0) {
      // Prefer closer elements
      const sorted = reviewCounts.sort((a, b) => {
        if (a.distance !== undefined && b.distance !== undefined) {
          return a.distance - b.distance;
        }
        return b.num - a.num;
      });
      
      if (state.debugMode) {
        console.log("[FlipSort] Proximity detection:", sorted[0]);
      }
      return sorted[0].num;
    }
    
    return 0;
  }

  // ─── Review Count Detection: Strategy 4 - Visual Hierarchy ───
  function detectReviewsByVisualHierarchy(card) {
    const reviewCounts = [];
    
    // Look for elements with specific visual properties
    const allElements = card.querySelectorAll("*");
    
    for (const element of allElements) {
      const text = element.textContent.trim();
      if (!text) continue;
      
      const num = extractNumber(text);
      if (!isValidReviewCount(num, text)) continue;
      
      // Check if element looks like a review count based on styles
      const computedStyle = window.getComputedStyle(element);
      const fontSize = parseFloat(computedStyle.fontSize);
      const fontWeight = computedStyle.fontWeight;
      const color = computedStyle.color;
      
      // Review counts are usually small text, gray color, normal weight
      const isSmallText = fontSize < 16;
      const isGrayColor = color.includes("128") || color.includes("gray") || color.includes("150");
      const isNormalWeight = fontWeight === "400" || fontWeight === "normal";
      
      if (isSmallText && (isGrayColor || isNormalWeight)) {
        reviewCounts.push({ 
          num, 
          source: "visual-hierarchy", 
          text,
          score: (isSmallText ? 1 : 0) + (isGrayColor ? 1 : 0) + (isNormalWeight ? 1 : 0)
        });
      }
    }
    
    if (reviewCounts.length > 0) {
      const sorted = reviewCounts.sort((a, b) => b.score - a.score || b.num - a.num);
      if (state.debugMode) {
        console.log("[FlipSort] Visual hierarchy detection:", sorted[0]);
      }
      return sorted[0].num;
    }
    
    return 0;
  }

  // ─── Master Review Count Detection ───
  function getReviewCount(card) {
    if (!card) return 0;
    
    // Try all detection strategies
    const strategies = [
      detectReviewsByPattern,
      detectReviewsByStructure,
      detectReviewsByProximity,
      detectReviewsByVisualHierarchy,
    ];
    
    const results = [];
    
    for (const strategy of strategies) {
      try {
        const count = strategy(card);
        if (count > 0) {
          results.push({ count, strategy: strategy.name });
        }
      } catch (error) {
        if (state.debugMode) {
          console.error("[FlipSort] Strategy error:", strategy.name, error);
        }
      }
    }
    
    // Return the highest valid count from all strategies
    if (results.length > 0) {
      const sorted = results.sort((a, b) => b.count - a.count);
      const finalCount = sorted[0].count;
      
      // Final validation
      if (finalCount > config.maxReasonableReviews) {
        if (state.debugMode) {
          console.warn("[FlipSort] Final count too high:", finalCount);
        }
        return 0;
      }
      
      if (state.debugMode) {
        console.log("[FlipSort] Final review count:", finalCount, "from", sorted[0].strategy);
      }
      
      return finalCount;
    }
    
    return 0;
  }

  // ─── Get Product Container ───
  function getProductContainer() {
    // Strategy 1: Look for common Flipkart grid containers
    const containerSelectors = [
      'div[data-id]',
      'div._1AtVbE',
      'div.DOjaWF',
      'div._75nhsW',
      'div._36fxV',
      '[class*="product"]',
      '[class*="Product"]',
    ];
    
    for (const selector of containerSelectors) {
      const containers = document.querySelectorAll(selector);
      
      for (const container of containers) {
        const children = Array.from(container.children);
        
        if (children.length >= 3) {
          // Validate that children are product cards
          let productCount = 0;
          
          for (const child of children) {
            const text = child.textContent || "";
            const hasPrice = text.includes("₹");
            const hasRating = text.includes("★") || text.toLowerCase().includes("rating");
            const hasImage = child.querySelector("img");
            
            if ((hasPrice || hasRating) && hasImage) {
              productCount++;
            }
          }
          
          // If at least 70% of children are products, this is the container
          if (productCount >= Math.ceil(children.length * 0.7)) {
            if (state.debugMode) {
              console.log("[FlipSort] Found container with", productCount, "products");
            }
            return container;
          }
        }
      }
    }
    
    // Strategy 2: Find any container with multiple product-like cards
    const allDivs = document.querySelectorAll("div");
    
    for (const div of allDivs) {
      const children = Array.from(div.children);
      
      if (children.length >= 10) {
        let productCount = 0;
        
        for (const child of children) {
          const text = child.textContent || "";
          const hasPrice = text.includes("₹");
          const hasRating = text.includes("★");
          const hasImage = child.querySelector("img");
          
          if (hasPrice && hasRating && hasImage) {
            productCount++;
          }
        }
        
        // If we found at least 10 products, this is likely the container
        if (productCount >= 10) {
          if (state.debugMode) {
            console.log("[FlipSort] Fallback container found with", productCount, "products");
          }
          return div;
        }
      }
    }
    
    return null;
  }

  // ─── Get All Product Cards ───
  function getProductCards() {
    const container = getProductContainer();
    if (!container) return [];
    
    const cards = Array.from(container.children).filter((child) => {
      const text = child.textContent || "";
      const hasPrice = text.includes("₹");
      const hasRating = text.includes("★") || text.toLowerCase().includes("rating");
      const hasImage = child.querySelector("img");
      
      // Must have at least 2 of these 3 properties
      const score = (hasPrice ? 1 : 0) + (hasRating ? 1 : 0) + (hasImage ? 1 : 0);
      
      return score >= 2;
    });
    
    if (state.debugMode) {
      console.log("[FlipSort] Found", cards.length, "product cards");
    }
    
    return cards;
  }

  // ─── Load All Products by Scrolling ───
  async function loadAllProducts() {
    if (state.isLoadingAll) return 0;
    state.isLoadingAll = true;
    
    showNotification("⏳ Loading all products... This may take several minutes");
    
    let previousCount = 0;
    let stableCount = 0;
    let totalScrolls = 0;
    
    // Scroll to load more products
    for (let i = 0; i < config.scrollAttempts; i++) {
      // Scroll to bottom
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth"
      });
      
      await sleep(config.scrollDelay);
      
      totalScrolls++;
      const currentCount = getProductCards().length;
      
      // Update notification
      showNotification(`⏳ Scrolled ${totalScrolls} times... ${currentCount} products loaded`);
      
      // Check if we're still loading new products
      if (currentCount === previousCount) {
        stableCount++;
        
        // If count is stable for multiple attempts, we're done
        if (stableCount >= config.stableCountThreshold) {
          showNotification(`✅ Finished loading! Total: ${currentCount} products`);
          break;
        }
      } else {
        stableCount = 0;
      }
      
      previousCount = currentCount;
      
      // Safety: If we have more than 5000 products, stop
      if (currentCount >= 5000) {
        showNotification(`⚠️ Loaded ${currentCount} products. Stopping to prevent browser slowdown`);
        break;
      }
    }
    
    state.isLoadingAll = false;
    return previousCount;
  }

  // ─── Sort Products by Review Count ───
  async function sortByReviews() {
    const container = getProductContainer();
    
    if (!container) {
      alert("❌ Could not find products. Please scroll down to load products first.");
      return;
    }
    
    let cards = getProductCards();
    
    if (cards.length === 0) {
      alert("❌ No products found on this page!");
      return;
    }
    
    // Ask user if they want to load all products
    if (cards.length < config.minProductsForLoadAll) {
      const loadAll = confirm(
        `Found only ${cards.length} products on current page.\n\n` +
        `Click OK to load ALL products from all pages (may take 2-5 minutes)\n` +
        `Click Cancel to sort only current page`
      );
      
      if (loadAll) {
        await loadAllProducts();
        cards = getProductCards(); // Refresh cards list
      }
    }
    
    // Save original order if not already saved
    if (state.originalOrder.length === 0) {
      state.originalOrder = [...cards];
    }
    
    // If already sorted, restore original order
    if (state.isSorted) {
      cards.forEach((card) => container.removeChild(card));
      state.originalOrder.forEach((card) => container.appendChild(card));
      state.isSorted = false;
      updateButtonState(false);
      showNotification("🔄 Original order restored!");
      return;
    }
    
    // Build data array with review counts
    showNotification("⏳ Analyzing review counts...");
    
    const cardData = cards.map((card, index) => {
      const reviewCount = getReviewCount(card);
      
      if (state.debugMode && reviewCount === 0) {
        console.warn("[FlipSort] Could not detect review count for card", index);
      }
      
      return {
        card,
        reviewCount,
        originalIndex: index,
      };
    });
    
    // Sort by review count (descending), then by original index for stability
    cardData.sort((a, b) => {
      if (b.reviewCount !== a.reviewCount) {
        return b.reviewCount - a.reviewCount; // Higher reviews first
      }
      return a.originalIndex - b.originalIndex; // Maintain original order for ties
    });
    
    // Remove all cards from container
    showNotification("⏳ Rearranging products...");
    cardData.forEach(({ card }) => container.removeChild(card));
    
    // Re-append in sorted order with badges
    cardData.forEach(({ card, reviewCount }, sortedIndex) => {
      addReviewBadge(card, reviewCount, sortedIndex);
      container.appendChild(card);
    });
    
    state.isSorted = true;
    updateButtonState(true);
    
    // Show summary
    const maxReviews = cardData[0]?.reviewCount || 0;
    const minReviews = cardData[cardData.length - 1]?.reviewCount || 0;
    
    showNotification(
      `✅ Sorted ${cardData.length} products!\n` +
      `Most reviewed: ${formatNumber(maxReviews)} | Least: ${formatNumber(minReviews)}`
    );
    
    // Scroll to top to see results
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ─── Add Review Badge to Card ───
  function addReviewBadge(card, count, sortedIndex) {
    // Remove existing badge if any
    const existing = card.querySelector(".flipsort-badge");
    if (existing) existing.remove();
    
    const badge = document.createElement("div");
    badge.className = "flipsort-badge";
    
    // Format the number properly
    if (count > 0) {
      badge.textContent = `📝 ${formatNumber(count)}`;
      badge.style.background = "linear-gradient(135deg, #ff9800, #f57c00)";
    } else {
      badge.textContent = `📝 0`;
      badge.style.background = "linear-gradient(135deg, #9e9e9e, #757575)";
    }
    
    badge.title = `Review count: ${count.toLocaleString()} | Position: #${sortedIndex + 1}`;
    
    // Add rank indicator for top products
    if (sortedIndex < 3) {
      const rank = document.createElement("span");
      rank.className = "flipsort-rank";
      rank.textContent = ` #${sortedIndex + 1}`;
      rank.style.marginLeft = "4px";
      rank.style.fontWeight = "700";
      badge.appendChild(rank);
    }
    
    card.style.position = "relative";
    card.appendChild(badge);
  }

  // ─── Create Floating Sort Button ───
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
    
    if (state.debugMode) {
      console.log("[FlipSort] Sort button created");
    }
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

  // ─── Show Notification Toast ───
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

  // ─── Make Button Draggable ───
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
      el.style.cursor = "grabbing";
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
      el.style.cursor = "pointer";
    });
  }

  // ─── Watch for Page Changes (SPA Navigation) ───
  function watchForPageChanges() {
    let lastURL = location.href;
    
    state.observer = new MutationObserver(() => {
      if (location.href !== lastURL) {
        lastURL = location.href;
        state.isSorted = false;
        state.originalOrder = [];
        
        if (state.debugMode) {
          console.log("[FlipSort] Page changed, resetting state");
        }
      }
    });
    
    state.observer.observe(document.body, { 
      childList: true, 
      subtree: true 
    });
  }

  // ─── Initialize Extension ───
  function init() {
    if (state.debugMode) {
      console.log("[FlipSort] Initializing...");
    }
    
    // Check for products periodically
    const checkInterval = setInterval(() => {
      const cards = getProductCards();
      
      if (cards.length > 0) {
        clearInterval(checkInterval);
        createSortButton();
        watchForPageChanges();
        
        if (state.debugMode) {
          console.log("[FlipSort] ✅ Initialized! Found", cards.length, "products");
        }
      }
    }, 1500);
    
    // Timeout after 30 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      createSortButton();
      watchForPageChanges();
      
      if (state.debugMode) {
        console.log("[FlipSort] Initialization timeout, button created anyway");
      }
    }, 30000);
  }

  // ─── Keyboard Shortcut ───
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      sortByReviews();
    }
    
    // Debug mode toggle: Alt + D
    if (e.altKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      state.debugMode = !state.debugMode;
      console.log("[FlipSort] Debug mode:", state.debugMode ? "ON" : "OFF");
      showNotification(`🐛 Debug mode ${state.debugMode ? "enabled" : "disabled"}`);
    }
  });

  // ─── Start Extension ───
  if (location.hostname.includes("flipkart.com")) {
    init();
  }
})();
