/**
 * content.js – Content Script
 *
 * Responsible for:
 *  1. Detecting text selection via mouseup
 *  2. Rendering a floating trigger icon near the selection
 *  3. On icon click: creating a Shadow DOM popup and fetching translation data
 *  4. Rendering the rich vocabulary card inside the Shadow DOM
 *  5. Handling "Add to Vocab" save action
 *  6. Click-outside cleanup
 *
 * All UI is isolated inside a Shadow DOM attached to a <div> appended to
 * document.body, ensuring zero CSS bleed between extension and host page.
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let triggerIcon = null;       // Floating icon element (host DOM)
let popupHost = null;         // Shadow DOM host element
let shadowRoot = null;        // The actual shadow root
let currentSelection = null;  // { text, rect }
let isPopupOpen = false;



// ---------------------------------------------------------------------------
// Entry point: listen for text selections
// ---------------------------------------------------------------------------
document.addEventListener("mouseup", handleMouseUp);
document.addEventListener("mousedown", handleMouseDown);

/**
 * On mouse up, check if user selected meaningful text.
 * If so, show the floating trigger icon.
 */
function handleMouseUp(e) {
  // Small delay so selection is fully committed
  setTimeout(() => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    // Ignore empty selections or if click was inside our own popup
    if (!selectedText || selectedText.length < 2) {
      return;
    }
    if (popupHost && popupHost.contains(e.target)) return;
    if (triggerIcon && triggerIcon.contains(e.target)) return;

    // Remove any existing icon before creating a new one
    removeTriggerIcon();

    // Capture selection data
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    currentSelection = {
      text: selectedText,
      rect: {
        top: rect.top + window.scrollY,
        bottom: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        right: rect.right + window.scrollX,
        width: rect.width,
        height: rect.height,
      },
    };

    showTriggerIcon(currentSelection.rect);
  }, 10);
}

/**
 * On mouse down, check if click is outside both icon and popup → cleanup.
 */
function handleMouseDown(e) {
  const clickedInsideIcon = triggerIcon && triggerIcon.contains(e.target);
  const clickedInsidePopup = popupHost && popupHost.contains(e.target);

  if (!clickedInsideIcon && !clickedInsidePopup) {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// Trigger Icon
// ---------------------------------------------------------------------------

/**
 * Creates and positions the small floating book icon near the selected text.
 * @param {object} rect – Bounding rect (absolute page coordinates)
 */
function showTriggerIcon(rect) {
  triggerIcon = document.createElement("div");
  triggerIcon.id = "vocablens-trigger";

  // Inline critical styles so they can't be overridden by host CSS
  Object.assign(triggerIcon.style, {
    position: "absolute",
    top: `${rect.top - 42}px`,
    left: `${rect.left + rect.width / 2 - 16}px`,
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
    boxShadow: "0 4px 15px rgba(99,102,241,0.5)",
    cursor: "pointer",
    zIndex: "2147483647",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "15px",
    userSelect: "none",
    animation: "vocablens-pop 0.2s cubic-bezier(0.34,1.56,0.64,1) forwards",
  });

  // Inject keyframe animation into host document (one-time)
  if (!document.getElementById("vocablens-anim")) {
    const style = document.createElement("style");
    style.id = "vocablens-anim";
    style.textContent = `
      @keyframes vocablens-pop {
        from { transform: scale(0); opacity: 0; }
        to   { transform: scale(1); opacity: 1; }
      }
      @keyframes vocablens-fadein {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  triggerIcon.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
         stroke-width="2" stroke="white" width="16" height="16">
      <path stroke-linecap="round" stroke-linejoin="round"
        d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987
           8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1
           6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967
           8.967 0 0 0-6 2.292m0-14.25v14.25"/>
    </svg>`;

  triggerIcon.addEventListener("click", handleIconClick);
  document.body.appendChild(triggerIcon);
}

function removeTriggerIcon() {
  if (triggerIcon) {
    triggerIcon.remove();
    triggerIcon = null;
  }
}

// ---------------------------------------------------------------------------
// Popup creation
// ---------------------------------------------------------------------------

/**
 * Handles the trigger icon click: creates the Shadow DOM popup and fetches data.
 */
async function handleIconClick(e) {
  e.stopPropagation();
  if (!currentSelection || isPopupOpen) return;

  removeTriggerIcon();
  isPopupOpen = true;

  // Create Shadow DOM host
  popupHost = document.createElement("div");
  popupHost.id = "vocablens-popup-host";
  Object.assign(popupHost.style, {
    position: "absolute",
    top: `${currentSelection.rect.top - 8}px`,
    left: `${Math.min(
      currentSelection.rect.left,
      window.scrollX + window.innerWidth - 380
    )}px`,
    zIndex: "2147483647",
    width: "360px",
  });

  shadowRoot = popupHost.attachShadow({ mode: "open" });

  // Inject Tailwind into the shadow root
  injectTailwindToShadow(shadowRoot);

  // Show loading skeleton immediately
  renderLoadingSkeleton(shadowRoot);

  document.body.appendChild(popupHost);

  // Request translation from background service worker
  try {
    const response = await chrome.runtime.sendMessage({
      action: "translate",
      word: currentSelection.text,
    });

    if (response.success) {
      renderVocabCard(shadowRoot, response.data);
    } else {
      renderError(shadowRoot, response.error);
    }
  } catch (err) {
    if (err.message && err.message.includes("Extension context invalidated")) {
      renderError(shadowRoot, "Extension was updated. Please refresh this page to use VocabLens.");
    } else {
      renderError(shadowRoot, err.message || "Connection error. Please try again.");
    }
  }
}

// ---------------------------------------------------------------------------
// Shadow DOM helpers
// ---------------------------------------------------------------------------

/**
 * Injects Tailwind CSS CDN script into a shadow root.
 * Tailwind's CDN build can style inside shadow DOM when loaded this way.
 */
function injectTailwindToShadow(root) {
  // Add base reset styles directly into shadow root so Tailwind can work
  const baseStyle = document.createElement("style");
  baseStyle.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host { all: initial; font-family: 'Inter', system-ui, -apple-system, sans-serif; }

    /* Import Inter font */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

    /* ---------- Card container ---------- */
    .vl-card {
      background: linear-gradient(145deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%);
      border: 1px solid rgba(139,92,246,0.3);
      border-radius: 16px;
      padding: 20px;
      box-shadow:
        0 25px 50px rgba(0,0,0,0.5),
        0 0 0 1px rgba(139,92,246,0.15),
        inset 0 1px 0 rgba(255,255,255,0.07);
      color: #e2e8f0;
      animation: vocablens-fadein 0.25s ease forwards;
      position: relative;
      overflow: hidden;
      min-width: 340px;
      max-width: 380px;
    }
    .vl-card::before {
      content: '';
      position: absolute;
      top: -60px; right: -60px;
      width: 140px; height: 140px;
      background: radial-gradient(circle, rgba(139,92,246,0.25) 0%, transparent 70%);
      pointer-events: none;
    }

    /* ---------- Header ---------- */
    .vl-word {
      font-size: 22px;
      font-weight: 700;
      color: #f1f5f9;
      letter-spacing: -0.3px;
      line-height: 1.2;
    }
    .vl-ipa {
      font-size: 14px;
      color: #a78bfa;
      font-style: italic;
      margin-top: 2px;
    }
    .vl-audio-btn {
      background: rgba(139,92,246,0.2);
      border: 1px solid rgba(139,92,246,0.4);
      border-radius: 8px;
      padding: 4px 8px;
      cursor: pointer;
      color: #a78bfa;
      font-size: 13px;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .vl-audio-btn:hover {
      background: rgba(139,92,246,0.35);
      color: #c4b5fd;
      transform: scale(1.05);
    }

    /* ---------- Divider ---------- */
    .vl-divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(139,92,246,0.4), transparent);
      margin: 14px 0;
    }

    /* ---------- Content sections ---------- */
    .vl-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      color: #7c3aed;
      margin-bottom: 4px;
    }
    .vl-translation {
      font-size: 18px;
      font-weight: 600;
      color: #fbbf24;
      margin-bottom: 10px;
    }
    .vl-explanation {
      font-size: 13px;
      color: #94a3b8;
      line-height: 1.6;
      margin-bottom: 14px;
    }
    .vl-example {
      font-size: 13px;
      color: #c7d2fe;
      line-height: 1.6;
      background: rgba(99,102,241,0.1);
      border-left: 3px solid #6366f1;
      padding: 8px 12px;
      border-radius: 0 8px 8px 0;
      font-style: italic;
    }

    /* ---------- Actions ---------- */
    .vl-actions {
      display: flex;
      gap: 8px;
      margin-top: 16px;
      align-items: center;
      justify-content: space-between;
    }
    .vl-save-btn {
      flex: 1;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: white;
      border: none;
      border-radius: 10px;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.25s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      box-shadow: 0 4px 12px rgba(99,102,241,0.35);
    }
    .vl-save-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(99,102,241,0.5);
    }
    .vl-save-btn:disabled {
      background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
      box-shadow: 0 4px 12px rgba(34,197,94,0.3);
      cursor: default;
    }
    .vl-close-btn {
      width: 36px;
      height: 36px;
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #94a3b8;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      transition: all 0.2s;
      flex-shrink: 0;
    }
    .vl-close-btn:hover {
      background: rgba(255,255,255,0.12);
      color: #f1f5f9;
    }

    /* ---------- Skeleton loading ---------- */
    .vl-skeleton {
      border-radius: 6px;
      background: linear-gradient(90deg,
        rgba(255,255,255,0.06) 0%,
        rgba(255,255,255,0.12) 50%,
        rgba(255,255,255,0.06) 100%);
      background-size: 200% 100%;
      animation: vl-shimmer 1.5s infinite;
    }
    @keyframes vl-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* ---------- Error state ---------- */
    .vl-error {
      color: #f87171;
      font-size: 13px;
      background: rgba(239,68,68,0.1);
      border: 1px solid rgba(239,68,68,0.25);
      border-radius: 8px;
      padding: 10px 12px;
      line-height: 1.5;
    }

    /* ---------- Badge ---------- */
    .vl-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      background: rgba(99,102,241,0.15);
      border: 1px solid rgba(99,102,241,0.3);
      border-radius: 20px;
      padding: 2px 8px;
      font-size: 11px;
      color: #a5b4fc;
    }
  `;
  root.appendChild(baseStyle);
}

// ---------------------------------------------------------------------------
// Render: Loading skeleton
// ---------------------------------------------------------------------------
function renderLoadingSkeleton(root) {
  const card = document.createElement("div");
  card.className = "vl-card";
  card.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px;">
      <div>
        <div class="vl-skeleton" style="width:120px;height:22px;margin-bottom:6px;"></div>
        <div class="vl-skeleton" style="width:80px;height:14px;"></div>
      </div>
      <div class="vl-skeleton" style="width:36px;height:36px;border-radius:8px;"></div>
    </div>
    <div class="vl-divider"></div>
    <div class="vl-skeleton" style="width:60%;height:22px;margin-bottom:10px;"></div>
    <div class="vl-skeleton" style="width:100%;height:14px;margin-bottom:6px;"></div>
    <div class="vl-skeleton" style="width:90%;height:14px;margin-bottom:6px;"></div>
    <div class="vl-skeleton" style="width:75%;height:14px;margin-bottom:14px;"></div>
    <div class="vl-skeleton" style="width:100%;height:52px;border-radius:8px;margin-bottom:16px;"></div>
    <div style="display:flex;gap:8px;">
      <div class="vl-skeleton" style="flex:1;height:38px;border-radius:10px;"></div>
      <div class="vl-skeleton" style="width:36px;height:36px;border-radius:8px;"></div>
    </div>
  `;

  // Clear shadow root content and append card
  clearShadowContent(root);
  root.appendChild(card);
}

// ---------------------------------------------------------------------------
// Render: Vocabulary card with full data
// ---------------------------------------------------------------------------
function renderVocabCard(root, data) {
  const { word, ipa, audioUrl, translation, explanation, example_en, example_vi, example } = data;

  const card = document.createElement("div");
  card.className = "vl-card";

  card.innerHTML = `
    <!-- Header: word + IPA + audio -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px;">
      <div style="flex:1;min-width:0;">
        <div class="vl-word">${escapeHtml(word)}</div>
        ${ipa
      ? `<div class="vl-ipa">${escapeHtml(ipa)}</div>`
      : `<div class="vl-ipa" style="color:#475569;font-size:12px;">No IPA found</div>`}
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;margin-left:10px;">
        ${audioUrl
      ? `<button class="vl-audio-btn" id="vl-play-audio" title="Play pronunciation">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                     stroke-width="2" stroke="currentColor" width="14" height="14">
                  <path stroke-linecap="round" stroke-linejoin="round"
                    d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0
                       0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0
                       0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009
                       0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51
                       8.25H6.75Z"/>
                </svg>
                Listen
              </button>`
      : ""
    }
        <span class="vl-badge">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
               stroke-width="2" stroke="currentColor" width="10" height="10">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"/>
          </svg>
          AI
        </span>
      </div>
    </div>

    <div class="vl-divider"></div>

    <!-- Translation -->
    <div class="vl-label">Nghĩa tiếng Việt</div>
    <div class="vl-translation">${escapeHtml(translation)}</div>

    <!-- Explanation -->
    <div class="vl-label">Giải thích & Sắc thái</div>
    <div class="vl-explanation">${escapeHtml(explanation)}</div>

    <!-- Example -->
    <div class="vl-label" style="margin-bottom:4px;">Ví dụ</div>
    <div class="vl-example">
      <div style="font-weight: 500; margin-bottom: 4px;">"${escapeHtml(example_en || example || "")}"</div>
      ${example_vi ? `<div style="font-style: normal; color: #a5b4fc;">${escapeHtml(example_vi)}</div>` : ''}
    </div>

    <!-- Action buttons -->
    <div class="vl-actions">
      <button class="vl-save-btn" id="vl-save-btn">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
             stroke-width="2" stroke="currentColor" width="14" height="14">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
        </svg>
        Add to Vocab
      </button>
      <button class="vl-close-btn" id="vl-close-btn" title="Close">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
             stroke-width="2" stroke="currentColor" width="14" height="14">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
  `;

  clearShadowContent(root);
  root.appendChild(card);

  // Wire up audio button
  const playBtn = root.getElementById("vl-play-audio");
  if (playBtn && audioUrl) {
    playBtn.addEventListener("click", () => {
      const audio = new Audio(audioUrl);
      audio.play().catch(console.error);
    });
  }

  // Wire up save button
  const saveBtn = root.getElementById("vl-save-btn");
  if (saveBtn) {
    // Check if already saved
    chrome.storage.local.get("vocabList", (stored) => {
      const list = stored.vocabList ?? [];
      const alreadySaved = list.some(
        (item) => item.word.toLowerCase() === word.toLowerCase()
      );
      if (alreadySaved) {
        setSavedState(saveBtn);
      }
    });

    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      saveBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
             stroke-width="2.5" stroke="currentColor" width="14" height="14">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
        </svg>
        Saving…
      `;

      try {
        const response = await chrome.runtime.sendMessage({
          action: "saveWord",
          entry: { word, ipa, audioUrl, translation, explanation, example_en, example_vi, example },
        });

        if (response.success) {
          setSavedState(saveBtn);
        } else {
          saveBtn.disabled = false;
          saveBtn.innerHTML = `⚠ Error – Try again`;
          saveBtn.style.background = "linear-gradient(135deg,#ef4444,#dc2626)";
        }
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = `⚠ Error - Refresh page`;
        saveBtn.style.background = "linear-gradient(135deg,#ef4444,#dc2626)";
      }
    });
  }

  // Wire up close button
  const closeBtn = root.getElementById("vl-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", cleanup);
  }
}

// ---------------------------------------------------------------------------
// Render: Error state
// ---------------------------------------------------------------------------
function renderError(root, message) {
  const card = document.createElement("div");
  card.className = "vl-card";
  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
           stroke-width="2" stroke="#f87171" width="18" height="18">
        <path stroke-linecap="round" stroke-linejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0
             2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898
             0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/>
      </svg>
      <span style="font-weight:600;color:#f87171;font-size:14px;">Something went wrong</span>
    </div>
    <div class="vl-error">${escapeHtml(message)}</div>
    <div class="vl-actions" style="margin-top:14px;">
      <button class="vl-close-btn" id="vl-close-btn" style="width:auto;padding:0 14px;gap:6px;font-size:13px;font-weight:500;color:#f1f5f9;" title="Close">
        Dismiss
      </button>
    </div>
  `;
  clearShadowContent(root);
  root.appendChild(card);

  root.getElementById("vl-close-btn")?.addEventListener("click", cleanup);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function setSavedState(btn) {
  btn.disabled = true;
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
         stroke-width="2.5" stroke="currentColor" width="14" height="14">
      <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/>
    </svg>
    Saved ✓
  `;
}

function clearShadowContent(root) {
  // Remove all children except the <style> element we injected
  Array.from(root.childNodes).forEach((node) => {
    if (node.nodeName !== "STYLE") node.remove();
  });
}

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanup() {
  removeTriggerIcon();
  if (popupHost) {
    popupHost.remove();
    popupHost = null;
    shadowRoot = null;
  }
  isPopupOpen = false;
  currentSelection = null;
}
