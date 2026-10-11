// ============================================
// SORT BY RATINGS v18 - REAL NAVIGATION COLLECTOR
// fetch block hole auto page-flip mode (bot-proof)
// Restore = full reload (100% original page)
// ============================================

(function () {
  "use strict";
  if (window.__fs18) return;
  window.__fs18 = 1;

  const HOST = location.hostname.replace(/^www\./, "");
  const IS_F = HOST.indexOf("flipkart.com") !== -1;
  const IS_M = HOST.indexOf("myntra.com") !== -1;
  if (!IS_F && !IS_M) return;

  const SKEY = "fs18_session";
  const EKEY = "fs18_enabled";
  const PER_PAGE = IS_F ? 40 : 50;
  const CARD_W = IS_F ? "25%" : "20%";
  const PARAM = IS_F ? "page" : "p";
  const MAX_MEM = 4000000; // ~4MB localStorage safety

  const state = { sorted: false, startUrl: location.href, btn: null, pill: null };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ─── Session (localStorage) ───
  function getSess() { try { return JSON.parse(localStorage.getItem(SKEY)) || null; } catch (e) { return null; } }
  function setSess(s) { try { localStorage.setItem(SKEY, JSON.stringify(s)); return true; } catch (e) { return false; } }
  function clearSess() { try { localStorage.removeItem(SKEY); } catch (e) {} }

  // ─── Numbers ───
  function parseDigits(t) {
    const d = String(t == null ? "" : t).replace(/[^0-9]/g, "");
    if (!d || d.length > 8) return 0;
    const n = parseInt(d, 10);
    return isFinite(n) && n >= 0 ? n : 0;
  }
  function parseMy(t) {
    let s = String(t || "").trim().toLowerCase().replace(/^[^0-9]+/, "");
    const m = s.match(/^([\d.]+)\s*(k|m|l)?/);
    if (!m) return 0;
    let n = parseFloat(m[1]);
    if (!isFinite(n) || n < 0) return 0;
    if (m[2] === "k") n *= 1000; else if (m[2] === "m") n *= 1000000; else if (m[2] === "l") n *= 100000;
    n = Math.round(n);
    return n <= 99999999 ? n : 0;
  }
  function fmt(n) {
    n = +n || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  // ─── Extract products from any DOM root ───
  function extract(root) {
    const out = [];
    if (IS_F) {
      root.querySelectorAll("div[data-id]").forEach((el) => {
        if (el.querySelector("div[data-id]")) return;
        if (!el.querySelector('a[href*="/p/"]')) return;
        const t = el.textContent || "";
        if (t.indexOf("₹") === -1 || !el.querySelector("img")) return;
        const s = el.querySelector("span.PvbNMB");
        let r = s ? parseDigits(s.textContent) : 0;
        if (!r) { const m = t.match(/\(([\d,]+)\)/); r = m ? parseDigits(m[1]) : 0; }
        out.push({ id: el.getAttribute("data-id"), html: el.outerHTML, ratings: r, sponsored: !!el.querySelector(".IxWX8O") });
      });
    } else {
      root.querySelectorAll("li.product-base").forEach((el) => {
        const rc = el.querySelector(".product-ratingsContainer");
        if (!rc) return;
        const id = el.getAttribute("id");
        if (!id) return;
        const cnt = el.querySelector(".product-ratingsCount");
        const w = el.querySelector(".product-waterMark");
        out.push({ id, html: el.outerHTML, ratings: cnt ? parseMy(cnt.textContent) : 0, sponsored: w ? /AD/i.test(w.textContent || "") : false });
      });
    }
    return out;
  }

  function waitForProducts(maxTries) {
    return new Promise((res) => {
      let n = 0;
      const iv = setInterval(() => {
        n++;
        if (extract(document).length > 0 || n >= (maxTries || 16)) { clearInterval(iv); res(); }
      }, 500);
    });
  }

  function urlWithPage(base, p) {
    const b = base.replace(/([?&])(page|p)=\d+&?/g, "$1").replace(/[?&]$/, "").replace(/#.*$/, "");
    return b + (b.indexOf("?") !== -1 ? "&" : "?") + PARAM + "=" + p;
  }

  // ─── Toast + Overlay ───
  function toast(msg) {
    let t = document.getElementById("fs-toast");
    if (!t) {
      t = document.createElement("div"); t.id = "fs-toast";
      t.style.cssText = "position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#212121;color:#fff;padding:12px 22px;border-radius:10px;font:500 13px/1.4 Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);max-width:80vw;text-align:center;white-space:pre-line;transition:opacity .3s;opacity:0;";
      document.body.appendChild(t);
    }
    t.textContent = msg; t.style.opacity = "1";
    clearTimeout(t._timer); t._timer = setTimeout(() => (t.style.opacity = "0"), 3500);
  }

  function overlay(text) {
    let o = document.getElementById("fs-overlay");
    if (!o) {
      o = document.createElement("div"); o.id = "fs-overlay";
      o.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#0d47a1;color:#fff;padding:14px 26px;border-radius:14px;font:700 14px/1.5 Arial,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.45);text-align:center;white-space:pre-line;";
      document.body.appendChild(o);
    }
    o.textContent = text;
    return o;
  }

  // ─── Hide originals + render sorted grid ───
  function renderSorted(prods) {
    if (!prods || !prods.length) return false;

    prods.sort((a, b) => {
      if (a.sponsored !== b.sponsored) return a.sponsored ? 1 : -1;
      return b.ratings - a.ratings;
    });

    // Hide native results + pagination
    const hides = [];
    if (IS_F) {
      document.querySelectorAll("div.nZIRY7").forEach((r) => {
        if (!r.querySelector('div[data-id] a[href*="/p/"]')) return;
        const s = r.closest(".lvJbLV.col-12-12") || r.parentElement;
        if (s && hides.indexOf(s) === -1) hides.push(s);
      });
    } else {
      const ul = document.querySelector("ul.results-base");
      if (ul) {
        const s = ul.parentElement || ul;
        hides.push(s);
      }
    }
    document.querySelectorAll("div, nav").forEach((d) => {
      if (/Page\s+\d+\s+of\s+\d+/i.test(d.textContent || "") && d.querySelector("nav, a") && d.children.length < 8) hides.push(d);
    });
    hides.forEach((s) => { if (s && !s.getAttribute("data-fshide")) { s.setAttribute("data-fshide", "1"); s.style.display = "none"; } });

    // Our grid
    const grid = document.createElement("div");
    grid.id = "fs-grid";
    grid.style.cssText = "display:flex;flex-wrap:wrap;width:100%;background:#fff;";
    prods.forEach((p, rank) => {
      const wrap = document.createElement("div");
      wrap.style.cssText = "width:" + CARD_W + ";box-sizing:border-box;position:relative;";
      const tpl = document.createElement("template");
      tpl.innerHTML = p.html.trim();
      const card = tpl.content.firstElementChild;
      if (!card) return;
      card.style.cssText = (card.getAttribute("style") || "") + ";width:100%;display:block;position:relative;list-style:none;";
      const b = document.createElement("div");
      b.style.cssText = "position:absolute;top:8px;right:14px;z-index:9;color:#fff;font:700 12px/1 Arial,sans-serif;padding:5px 9px;border-radius:12px;box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:none;background:" + (p.sponsored ? "#9e9e9e" : "linear-gradient(135deg,#ff9800,#f57c00)") + ";";
      b.textContent = p.sponsored ? "📢 AD" : "⭐ " + fmt(p.ratings);
      b.title = "Ratings: " + p.ratings.toLocaleString("en-IN") + " • Rank #" + (rank + 1);
      wrap.appendChild(card);
      wrap.appendChild(b);
      grid.appendChild(wrap);
    });

    const info = document.createElement("div");
    info.style.cssText = "padding:14px 18px;font:600 14px Arial,sans-serif;color:#333;background:#fff;border-bottom:1px solid #eee;";
    const ads = prods.filter((p) => p.sponsored).length;
    info.textContent = "⭐ Sorted " + prods.length + " products by ratings (most → least) | 📢 AD: " + ads + " (last e) | 🔄 Restore = button niche";
    
    const box = document.createElement("div");
    box.id = "fs-resultbox";
    box.appendChild(info);
    box.appendChild(grid);

    const anchor = hides[0];
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor);
    else document.body.appendChild(box);

    state.sorted = true;
    updateBtn();
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast("✅ " + prods.length + " products sorted!\n🏆 Top: " + fmt(prods[0].ratings) + " ratings");
    return true;
  }

  function unhide() {
    document.querySelectorAll("[data-fshide]").forEach((s) => { s.style.display = ""; s.removeAttribute("data-fshide"); });
    const b = document.getElementById("fs-resultbox");
    if (b) b.remove();
  }

  // ─── NAV MODE (page flip collector) ───
  async function navStep() {
    const ses = getSess();
    if (!ses || !ses.nav) return false;

    await waitForProducts(16);
    const cur = extract(document);
    const seen = {};
    ses.collected.forEach((c) => { seen[c.id] = 1; });
    let fresh = 0;
    cur.forEach((c) => { if (!seen[c.id]) { seen[c.id] = 1; ses.collected.push(c); fresh++; } });

    const o = overlay(
      "📦 Page " + ses.cur + "/" + ses.pages + " theke collect hocche\n" +
      " Total: " + ses.collected.length + " products (+" + fresh + ")\n" +
      "⏳ Kichu korben na... auto cholche"
    );
    const stop = document.createElement("div");
    stop.textContent = "🛑 STOP EKHONE";
    stop.style.cssText = "margin-top:8px;background:#d32f2f;border-radius:8px;padding:6px 12px;cursor:pointer;font:700 12px Arial;";
    stop.onclick = () => { ses.stop = true; setSess(ses); };
    o.appendChild(stop);

    const tooBig = JSON.stringify(ses.collected).length > MAX_MEM;
    if (!setSess(ses)) ses.stop = true;

    await sleep(1000);

    if (ses.stop || tooBig || ses.cur > ses.pages) {
      ses.nav = false; ses.render = true; setSess(ses);
      overlay("✅ Collect sesh! Page 1 e firchi...");
      setTimeout(() => { location.href = ses.start.replace(/#.*$/, ""); }, 900);
    } else {
      const next = ses.cur;
      ses.cur = ses.cur + 1; setSess(ses);
      setTimeout(() => { location.href = urlWithPage(ses.start, next); }, 600);
    }
    return true;
  }

  // ─── FETCH MODE (fast, jodi site allow kore) ───
  async function fetchCollect(startUrl, pages, initial) {
    const seen = {};
    const collected = initial.slice();
    collected.forEach((c) => { seen[c.id] = 1; });
    let consecutiveFail = 0;

    for (let p = 2; p <= pages; p++) {
      toast("🔍 Page " + p + "/" + pages + " (fetch)...\n📦 Total: " + collected.length);
      let prods = [];
      try {
        const res = await fetch(urlWithPage(startUrl, p), { credentials: "include" });
        if (res.ok) {
          const doc = new DOMParser().parseFromString(await res.text(), "text/html");
          prods = extract(doc);
        }
      } catch (e) {}
      let fresh = 0;
      prods.forEach((c) => { if (c.id && !seen[c.id]) { seen[c.id] = 1; collected.push(c); fresh++; } });
      if (!prods.length || !fresh) { consecutiveFail++; if (consecutiveFail >= 2) return { collected, blocked: true, atPage: p }; }
      else consecutiveFail = 0;
      if (JSON.stringify(collected).length > MAX_MEM) return { collected, blocked: false, atPage: p, memFull: true };
      await sleep(900);
    }
    return { collected, blocked: false, atPage: pages + 1 };
  }

  // ─── Main click ───
  async function onSort() {
    if (state.sorted) {
      clearSess();
      location.href = state.startUrl.replace(/#.*$/, "");
      return;
    }

    const input = prompt(
      (IS_F ? "Flipkart" : "Myntra") + ": কত PAGE scan করবে?\n\n" +
      "প্রতি page = " + PER_PAGE + " products\n" +
      "10 page = " + PER_PAGE * 10 + " | 20 page = " + PER_PAGE * 20 + "\n" +
      "(memory limit: max 30 page)\n\nসংখ্যা লেখো:",
      "10"
    );
    if (input === null) return;
    let pages = parseInt(input.trim(), 10);
    if (!pages || pages < 1) pages = 1;
    if (pages > 30) pages = 30;

    const startUrl = location.href.replace(/#.*$/, "");
    state.startUrl = startUrl;

    await waitForProducts(10);
    const initial = extract(document);
    if (!initial.length) { alert("❌ Product পাওয়া যায়নি! Page refresh করো।"); return; }

    if (pages === 1) {
      renderSorted(initial);
      return;
    }

    const res = await fetchCollect(startUrl, pages, initial);

    if (!res.blocked) {
      renderSorted(res.collected);
      if (res.memFull) toast("⚠️ Memory full — " + res.collected.length + " product পর্যন্ত হয়েছে");
      return;
    }

    // Fetch blocked → real navigation mode
    const ok = confirm(
      "Site fetch block করছে!\n\n" +
      "এখন BROWSER AUTO PAGE-FLIP mode চলবে:\n" +
      "• নিজে নিজে page " + res.atPage + " → " + pages + " পর্যন্ত যাবে\n" +
      "• ১- মিনিট লাগবে, কিছু click কোরো না\n" +
      "• শেষে page 1 এ ফিরে sort দেখাবে\n\n" +
      "OK = শুরু করো | Cancel = যা পেয়েছি তাই sort করো"
    );
    if (!ok) { renderSorted(res.collected); return; }

    setSess({ nav: true, render: false, stop: false, start: startUrl, pages: pages, cur: res.atPage, collected: res.collected });
    location.href = urlWithPage(startUrl, res.atPage);
  }

  // ─── UI ───
  function createBtn() {
    if (state.btn) return;
    const b = document.createElement("div");
    b.style.cssText = "position:fixed;right:26px;bottom:30px;z-index:2147483647;cursor:pointer;user-select:none;color:#fff;border-radius:30px;padding:13px 22px;font:700 14px Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35);";
    b.addEventListener("click", onSort);
    document.body.appendChild(b);
    state.btn = b;
    updateBtn();
  }
  function updateBtn() {
    if (!state.btn) return;
    if (state.sorted) {
      state.btn.textContent = "🔄 Restore Default (reload)";
      state.btn.style.background = "linear-gradient(135deg,#2e7d32,#1b5e20)";
    } else {
      state.btn.textContent = "⭐ Sort by Ratings";
      state.btn.style.background = "linear-gradient(135deg,#2874f0,#1a4fb7)";
    }
  }
  function createPill() {
    if (state.pill) return;
    const pill = document.createElement("div");
    pill.style.cssText = "position:fixed;top:64px;right:14px;z-index:2147483647;cursor:pointer;user-select:none;padding:8px 14px;border-radius:20px;font:700 12px Arial,sans-serif;color:#fff;box-shadow:0 3px 10px rgba(0,0,0,.3);";
    pill.onclick = () => {
      const on = localStorage.getItem(EKEY) !== "1";
      localStorage.setItem(EKEY, on ? "1" : "0");
      if (!on) { clearSess(); location.href = location.href.replace(/#.*$/, ""); }
      else location.reload();
    };
    document.body.appendChild(pill);
    state.pill = pill;
    const on = localStorage.getItem(EKEY) !== "0";
    pill.textContent = on ? "🟢 Sort ON" : "🔴 Sort OFF";
    pill.style.background = on ? "linear-gradient(135deg,#2e7d32,#1b5e20)" : "linear-gradient(135deg,#c62828,#8e0000)";
    if (!on) { state.pill = pill; return; }
  }

  // ─── Boot ───
  (async function boot() {
    // NAV mode?
    const ses = getSess();
    if (ses && ses.nav) { await navStep(); return; }
    if (ses && ses.render) {
      const prods = ses.collected || [];
      clearSess();
      createPill();
      if (localStorage.getItem(EKEY) === "0") return;
      await waitForProducts(10);
      if (renderSorted(prods)) { createBtn(); }
      return;
    }
    createPill();
    if (localStorage.getItem(EKEY) === "0") return;
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (extract(document).length > 0 || Date.now() - t0 > 20000) { clearInterval(iv); createBtn(); }
    }, 1000);
  })();

  // SPA change e clean
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      const s = getSess();
      if (!s || !s.nav) { unhide(); state.sorted = false; updateBtn(); }
    }
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "s") { e.preventDefault(); onSort(); }
  });
})();
