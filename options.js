/**
 * options.js – Options Page Logic (Redesigned Dashboard)
 *
 * Handles:
 *  - Groq API key save / clear / load
 *  - CSV export via PapaParse
 *  - Toast notification system
 *  - Confirm-delete modal
 */

// ---------------------------------------------------------------------------
// Init on DOM ready
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  loadApiKey();
  updateWordCount();
  setupKeyVisibilityToggle();

  // Attach event listeners (Manifest V3 CSP prevents inline onclick)
  document.getElementById("saveKeyBtn")?.addEventListener("click", saveApiKey);
  document.getElementById("clearKeyBtn")?.addEventListener("click", clearApiKey);
  document.getElementById("exportBtn")?.addEventListener("click", exportToCSV);
  document.getElementById("clearAllBtn")?.addEventListener("click", confirmClearAll);

  // Modal buttons
  document.getElementById("cancelDeleteBtn")?.addEventListener("click", closeConfirmModal);
  document.getElementById("confirmDeleteBtn")?.addEventListener("click", clearAllWords);

  // Close modal on backdrop click
  document.getElementById("confirmModal")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeConfirmModal();
  });
});

// ---------------------------------------------------------------------------
// API Key Management
// ---------------------------------------------------------------------------

/** Loads the stored API key and populates the input. */
function loadApiKey() {
  chrome.storage.local.get("groqApiKey", (data) => {
    if (data.groqApiKey) {
      document.getElementById("apiKeyInput").value = data.groqApiKey;
    }
  });
}

/** Saves the API key entered in the input field. */
function saveApiKey() {
  const key = document.getElementById("apiKeyInput").value.trim();

  if (!key) {
    showToast("⚠️ Please enter an API key first.", "warning");
    return;
  }

  if (!key.startsWith("gsk_")) {
    showToast("⚠️ This doesn't look like a valid Groq API key.", "warning");
    return;
  }

  const btn = document.getElementById("saveKeyBtn");
  btn.disabled = true;
  btn.innerHTML = `<svg class="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
  </svg> Saving…`;

  chrome.storage.local.set({ groqApiKey: key }, () => {
    btn.disabled = false;
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
           stroke-width="2.5" stroke="currentColor" class="w-4 h-4">
        <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/>
      </svg>
      Save Settings`;
    showToast("✅ Settings saved successfully!", "success");

    // Reset button text after 2 seconds
    setTimeout(() => {
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
             stroke-width="2.5" stroke="currentColor" class="w-4 h-4">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/>
        </svg>
        Save Settings`;
    }, 2000);
  });
}

/** Clears the stored API key. */
function clearApiKey() {
  chrome.storage.local.remove("groqApiKey", () => {
    document.getElementById("apiKeyInput").value = "";
    showToast("🗑 API key cleared.", "info");
  });
}

/** Toggles password input visibility. */
function setupKeyVisibilityToggle() {
  const input = document.getElementById("apiKeyInput");
  const btn = document.getElementById("toggleKeyVisibility");
  const icon = document.getElementById("eyeIcon");

  btn.addEventListener("click", () => {
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    icon.innerHTML = isHidden
      ? `<path stroke-linecap="round" stroke-linejoin="round"
           d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12
              19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12
              4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228
              6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0
              0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88"/>`
      : `<path stroke-linecap="round" stroke-linejoin="round"
           d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638
              0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12
              19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/>
         <path stroke-linecap="round" stroke-linejoin="round"
           d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>`;
  });
}

// ---------------------------------------------------------------------------
// Vocabulary Management
// ---------------------------------------------------------------------------

let allWords = [];

/** Loads vocabulary list just to populate word count and export data. */
function updateWordCount() {
  chrome.storage.local.get("vocabList", (data) => {
    allWords = data.vocabList ?? [];
    const el = document.getElementById("word-count");
    if (el) el.textContent = allWords.length;
  });
}

// ---------------------------------------------------------------------------
// Confirm Delete Modal
// ---------------------------------------------------------------------------
function confirmClearAll() {
  document.getElementById("deleteCount").textContent = allWords.length;
  document.getElementById("confirmModal").classList.remove("hidden");
  document.getElementById("confirmModal").classList.add("flex");
}

function closeConfirmModal() {
  document.getElementById("confirmModal").classList.add("hidden");
  document.getElementById("confirmModal").classList.remove("flex");
}

function clearAllWords() {
  chrome.storage.local.set({ vocabList: [] }, () => {
    allWords = [];
    updateWordCount();
    closeConfirmModal();
    showToast("🗑 All words cleared.", "info");
  });
}

// ---------------------------------------------------------------------------
// CSV Export via PapaParse
// ---------------------------------------------------------------------------

/**
 * Exports the vocabulary list to a .csv file formatted for Anki import.
 */
function exportToCSV() {
  if (allWords.length === 0) {
    showToast("📭 No words to export yet.", "warning");
    return;
  }

  // Map to plain objects with clear column names
  const rows = allWords.map((item) => ({
    Word: item.word || "",
    IPA: item.ipa || "",
    Translation: item.translation || "",
    Explanation: item.explanation || "",
    Example: item.example_en ? `${item.example_en} (${item.example_vi})` : (item.example || ""),
    Timestamp: item.timestamp ? new Date(item.timestamp).toLocaleString("vi-VN") : "",
    AudioURL: item.audioUrl || "",
  }));

  // Use PapaParse to safely encode the CSV
  const csv = Papa.unparse(rows, {
    quotes: true,
    quoteChar: '"',
    escapeChar: '"',
    delimiter: ",",
    header: true,
    newline: "\\r\\n",
    skipEmptyLines: true,
  });

  // Prepend UTF-8 BOM so Excel and Anki handle special characters correctly
  const bom = "\\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  // Trigger download
  const filename = `vocablens_${new Date().toISOString().slice(0, 10)}.csv`;
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Cleanup object URL after download starts
  setTimeout(() => URL.revokeObjectURL(url), 3000);

  showToast(`✅ Exported ${allWords.length} words to ${filename}`, "success");
}

// ---------------------------------------------------------------------------
// Toast Notification
// ---------------------------------------------------------------------------

let toastTimeout = null;

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");

  const colors = {
    success: "border-green-500/40 text-green-400",
    warning: "border-amber-500/40 text-amber-400",
    info: "border-slate-600 text-slate-300",
    error: "border-red-500/40 text-red-400",
  };

  toast.className = `fixed top-5 right-5 z-50 flex items-center gap-3 px-4 py-3 bg-[#1E293B] border rounded-xl shadow-2xl text-sm font-medium transition-all duration-300 ${colors[type] ?? colors.info}`;
  toast.textContent = message;

  // Animate in
  requestAnimationFrame(() => {
    toast.style.transform = "translateX(0)";
    toast.style.opacity = "1";
  });

  // Auto-hide after 3 seconds
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.style.transform = "translateX(120%)";
    toast.style.opacity = "0";
  }, 3000);
}
