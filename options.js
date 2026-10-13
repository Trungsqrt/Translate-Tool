/**
 * options.js – Options Page Logic (Redesigned Dashboard)
 *
 * Handles:
 *  - Groq API key save / clear / load
 *  - CSV export via PapaParse
 *  - Toast notification system
 *  - Confirm-delete modal
 */

const DEFAULT_MODEL = "llama-3.3-70b-versatile";

// ---------------------------------------------------------------------------
// Init on DOM ready
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  updateWordCount();
  setupKeyVisibilityToggle();
  setupModelPresets();

  // Attach event listeners (Manifest V3 CSP prevents inline onclick)
  document.getElementById("saveKeyBtn")?.addEventListener("click", saveSettings);
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
// AI Provider & Model Management
// ---------------------------------------------------------------------------

/** Loads the stored API key and model, and populates the inputs. */
function loadSettings() {
  chrome.storage.local.get(["groqApiKey", "groqModel"], (data) => {
    const keyInput = document.getElementById("apiKeyInput");
    const modelInput = document.getElementById("modelInput");
    const activeBadge = document.getElementById("activeModelBadge");

    if (data.groqApiKey && keyInput) {
      keyInput.value = data.groqApiKey;
    }

    const currentModel = data.groqModel || DEFAULT_MODEL;
    if (modelInput) {
      modelInput.value = currentModel;
    }

    if (activeBadge) {
      activeBadge.textContent = currentModel;
      activeBadge.classList.remove("hidden");
    }
  });
}

/** Handles preset button clicks to fill in model input. */
function setupModelPresets() {
  const presetButtons = document.querySelectorAll(".model-preset-btn");
  const modelInput = document.getElementById("modelInput");

  presetButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const selectedModel = btn.getAttribute("data-model");
      if (selectedModel && modelInput) {
        modelInput.value = selectedModel;
        modelInput.focus();

        // Visual feedback on clicked button
        btn.classList.add("ring-2", "ring-indigo-400");
        setTimeout(() => {
          btn.classList.remove("ring-2", "ring-indigo-400");
        }, 300);
      }
    });
  });
}

/** Saves both the API key and Model entered in the input fields. */
function saveSettings() {
  const key = document.getElementById("apiKeyInput").value.trim();
  const rawModel = document.getElementById("modelInput").value.trim();
  const model = rawModel || DEFAULT_MODEL;

  if (!key) {
    showToast("🍂 Vui lòng nhập Groq API key trước.", "warning");
    return;
  }

  if (!key.startsWith("gsk_")) {
    showToast("🍂 Lưu ý: Groq API key thường bắt đầu bằng 'gsk_'.", "warning");
  }

  const btn = document.getElementById("saveKeyBtn");
  btn.disabled = true;
  btn.innerHTML = `<svg class="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
  </svg> Đang lưu…`;

  chrome.storage.local.set({ groqApiKey: key, groqModel: model }, () => {
    btn.disabled = false;
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
           stroke-width="2" stroke="currentColor" class="w-4 h-4">
        <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/>
      </svg>
      Lưu Cấu Hình`;

    // Update active badge
    const activeBadge = document.getElementById("activeModelBadge");
    if (activeBadge) {
      activeBadge.textContent = model;
      activeBadge.classList.remove("hidden");
    }

    showToast(`🍵 Đã lưu cấu hình! Model: ${model}`, "success");

    // Reset button text after 2 seconds
    setTimeout(() => {
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
             stroke-width="2" stroke="currentColor" class="w-4 h-4">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/>
        </svg>
        Lưu Cấu Hình`;
    }, 2000);
  });
}

/** Clears the stored API key. */
function clearApiKey() {
  chrome.storage.local.remove("groqApiKey", () => {
    document.getElementById("apiKeyInput").value = "";
    showToast("🍃 Đã xóa API key.", "info");
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
    showToast("🍂 Đã dọn sạch kho từ vựng.", "info");
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
    showToast("📭 Chưa có từ vựng nào để xuất.", "warning");
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
    newline: "\r\n",
    skipEmptyLines: true,
  });

  // Prepend UTF-8 BOM so Excel and Anki handle special characters correctly
  const bom = "\uFEFF";
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

  showToast(`🌾 Đã xuất ${allWords.length} từ vựng sang ${filename}`, "success");
}

// ---------------------------------------------------------------------------
// Toast Notification (Wabi-Sabi Palette)
// ---------------------------------------------------------------------------

let toastTimeout = null;

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  if (!toast) return;

  const colors = {
    success: "border-[#4A5941] text-[#A3B18A] bg-[#1A1F18]",
    warning: "border-[#734F32] text-[#D48B66] bg-[#221B16]",
    info: "border-[#3E372E] text-[#D6CEC3] bg-[#1D1B18]",
    error: "border-[#6E3535] text-[#D98282] bg-[#221616]",
  };

  toast.className = `fixed top-5 right-5 z-50 flex items-center gap-3 px-5 py-3.5 border rounded-2xl shadow-2xl text-sm font-medium transition-all duration-300 font-wabi-serif ${colors[type] ?? colors.info}`;
  toast.textContent = message;

  // Animate in
  requestAnimationFrame(() => {
    toast.style.transform = "translateX(0)";
    toast.style.opacity = "1";
  });

  // Auto-hide after 3.2 seconds
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.style.transform = "translateX(120%)";
    toast.style.opacity = "0";
  }, 3200);
}
