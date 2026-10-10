// ============================================
// FLIPKART SORT BY RATINGS COUNT v7.0
// Amazon-style: Scans ALL pages (50+)
// Collects all products → Sorts by ratings count
// Sponsored products at the END
// NO badges - just rearranges products
// ============================================

(function () {
  "use strict";

  if (window.__flipSortLoaded) return;
  window.__flipSortLoaded = true;

  const state = {
    isSorted: false,
    originalOrder: [],
    allProducts: [],
    sortButton: null,
    isScanning: false,
  };

  // ============================================
  // 🔒 SAFE NUMBER PARSER
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
  // "69 Ratings&15 Reviews" → returns 69
  // ============================================
  function getRatingsCount(card) {
    if (!card) return 0;
    const text = card.textContent || "";

    // PATTERN 1: "X Ratings&Y Reviews"
    const p1 = text.match(/([\d,]+)\s*Ratings?\s*&\s*([\d,]+)\s*Reviews?/i);
    if (p1) return safeNum(p1[1]);

    // PATTERN 2: "X Ratings"
    const p2 = text.match(/([\d,]+)\s*Ratings?/i);
    if (p2) return safeNum(p2[1]);

    // PATTERN 3: "X Ratings Y Reviews"
    const p3 = text.match(/([\d,]+)\s*Ratings?\s+([\d,]+)\s*Reviews?/i);
    if (p3) return safeNum(p3[1]);

    return 0;
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
  // 📜 COLLECT ALL PRODUCTS FROM ALL PAGES
  // Amazon-style: Fetches every page
  // ============================================
  async function collectAllProducts() {
    if (state.isScanning) return;
    state.isScanning = true;

    showNotify("🔍 Scanning ALL pages... This may take 2-5 minutes");

    const allProducts = [];
    const seenIds = new Set();

    // Get base URL (without page parameter)
    const currentURL = window.location.href;
    let baseURL = currentURL.replace(/&page=\d+/, "").replace(/\?page=\d+&/, "?");

    // Scan pages 1 to 50
    for (let pageNum = 1; pageNum <= 50; pageNum++) {
      showNotify(`🔍 Scanning page ${pageNum}/50... Found ${allProducts.length} products`);

      // Build page URL
      const pageURL = baseURL.includes("?")
        ? `${baseURL}&page=${pageNum}`
        : `${baseURL}?page=${pageNum}`;

      try {
        // Fetch page
        const response = await fetch(pageURL);
        if (!response.ok) break;

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        // Find products on this page
        const productCards = doc.querySelectorAll("div[data-id]");
        let newProducts = 0;

        productCards.forEach((card) => {
          if (card.querySelector("div[data-id]")) return;
          const id = card.getAttribute("data-id");
          if (!id || seenIds.has(id)) return;

          const text = card.textContent || "";
          if (!text.includes("₹") || !card.querySelector("img")) return;

          seenIds.add(id);

          // Extract product data
          const ratings = getRatingsCount(card);
          const sponsored = isSponsored(card);

          allProducts.push({
            id,
            ratings,
            sponsored,
            html: card.outerHTML,
            originalIndex: allProducts.length,
          });

          newProducts++;
        });

        // If no new products found, we've reached the end
        if (newProducts === 0) {
          showNotify(`✅ Reached end at page ${pageNum}. Total: ${allProducts.length} products`);
          break;
        }

        // Small delay to avoid overwhelming the server
        await new Promise((r) => setTimeout(r, 800));
      } catch (error) {
        console.error(`Error fetching page ${pageNum}:`, error);
        break;
      }
    }

    state.isScanning = false;
    showNotify(`✅ Scan complete! Found ${allProducts.length} products across all pages`);

    return allProducts;
  }

  // ============================================
  // 🎯 MAIN SORT FUNCTION
  // ============================================
  async function sortByRatings() {
    if (state.isScanning) return;
    if (state.isSorted) {
      restoreOriginal();
      return;
    }

    // Collect all products from all pages
    state.allProducts = await collectAllProducts();

    if (state.allProducts.length === 0) {
      alert("❌ Kono product paoa jay ni!");
      return;
    }

    // Save original order (current page only)
    const currentCards = getProductCards();
    state.originalOrder = currentCards.slice();

    showNotify("⏳ Sorting ${state.allProducts.length} products by ratings count...");

    // Sort: sponsored last, regular by ratings DESC
    state.allProducts.sort((a, b) => {
      if (a.sponsored !== b.sponsored) return a.sponsored ? 1 : -1;
      if (b.ratings !== a.ratings) return b.ratings - a.ratings;
      return a.originalIndex - b.originalIndex;
    });

    // Clear current page
    const container = currentCards[0]?.parentElement;
    if (!container) {
      alert("❌ Container paoa jay ni!");
      return;
    }

    // Remove all current products
    currentCards.forEach((card) => card.remove());

    // Add sorted products (show first 40 on this page)
    const productsToShow = state.allProducts.slice(0, 40);
    productsToShow.forEach((product) => {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = product.html;
      const newCard = tempDiv.firstElementChild;
      if (newCard) container.appendChild(newCard);
    });

    state.isSorted = true;
    updateBtnState(true);

    const sponsoredCount = state.allProducts.filter((p) => p.sponsored).length;
    const regularProducts = state.allProducts.filter((p) => !p.sponsored);
    const maxRatings = regularProducts.length > 0 ? regularProducts[0].ratings : 0;

    showNotify(
      `✅ Sorted ${state.allProducts.length} products!\n` +
      `📢 Sponsored: ${sponsoredCount} (at end)\n` +
      `🏆 Most rated: ${maxRatings.toLocaleString("en-IN")} ratings\n` +
      `📄 Showing first 40 products on this page`
    );

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ============================================
  // 🔄 RESTORE ORIGINAL
  // ============================================
  function restoreOriginal() {
    const container = state.originalOrder[0]?.parentElement;
    if (!container) return;

    // Remove all current products
    const currentCards = getProductCards();
    currentCards.forEach((card) => card.remove());

    // Restore original products
    state.originalOrder.forEach((card) => container.appendChild(card));

    state.isSorted = false;
    state.allProducts = [];
    updateBtnState(false);
    showNotify("🔄 Original order restored!");
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
    t._timer = setTimeout(() => t.classList.remove("show"), 4000);
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
