// ─── Sort Button ───
document.getElementById("sortBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  chrome.tabs.sendMessage(tab.id, { action: "flipsort_sort" }, (res) => {
    if (chrome.runtime.lastError) {
      document.getElementById("status").textContent =
        "❌ Flipkart page open koro, tarpor abar try koro!";
    }
  });
  window.close();
});

// ─── Restore Button ───
document.getElementById("restoreBtn").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  chrome.tabs.sendMessage(tab.id, { action: "flipsort_restore" }, (res) => {
    if (chrome.runtime.lastError) {
      document.getElementById("status").textContent =
        "❌ Flipkart page open koro, tarpor abar try koro!";
    }
  });
  window.close();
});
