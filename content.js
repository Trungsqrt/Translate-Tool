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
  const path = e.composedPath ? e.composedPath() : [];
  const clickedInsideIcon = triggerIcon && (triggerIcon.contains(e.target) || path.includes(triggerIcon));
  const clickedInsidePopup = popupHost && (popupHost === e.target || popupHost.contains(e.target) || path.includes(popupHost));

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
    background: "linear-gradient(145deg, #A85A32 0%, #85401C 100%)",
    boxShadow: "0 4px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.15)",
    border: "1px solid rgba(220,180,150,0.3)",
    cursor: "pointer",
    zIndex: "2147483647",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "15px",
    userSelect: "none",
    animation: "vocablens-pop 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards",
  });

  // Inject keyframe animation into host document (one-time)
  if (!document.getElementById("vocablens-anim")) {
    const style = document.createElement("style");
    style.id = "vocablens-anim";
    style.textContent = `
      @keyframes vocablens-pop {
        from { transform: scale(0.6); opacity: 0; }
        to   { transform: scale(1); opacity: 1; }
      }
      @keyframes vocablens-fadein {
        from { opacity: 0; transform: translateY(6px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  triggerIcon.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
         stroke-width="1.8" stroke="#F5EFEB" width="16" height="16">
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
  if (!currentSelection) return;

  removeTriggerIcon();

  // Create Shadow DOM host if not already created
  if (!popupHost) {
    isPopupOpen = true;

    popupHost = document.createElement("div");
    popupHost.id = "vocablens-popup-host";
    Object.assign(popupHost.style, {
      position: "fixed",
      top: "24px",
      right: "24px",
      left: "auto",
      bottom: "auto",
      zIndex: "2147483647",
      width: "380px",
      maxWidth: "calc(100vw - 32px)",
    });

    shadowRoot = popupHost.attachShadow({ mode: "open" });
    injectTailwindToShadow(shadowRoot);
    document.body.appendChild(popupHost);
  } else {
    isPopupOpen = true;
  }

  // Show loading skeleton immediately
  renderLoadingSkeleton(shadowRoot);
  attachDraggable(popupHost, shadowRoot);

  // Request translation from background service worker
  try {
    const response = await chrome.runtime.sendMessage({
      action: "translate",
      word: currentSelection.text,
    });

    if (response.success) {
      renderVocabCard(shadowRoot, response.data);
      attachDraggable(popupHost, shadowRoot);
    } else {
      renderError(shadowRoot, response.error);
      attachDraggable(popupHost, shadowRoot);
    }
  } catch (err) {
    if (err.message && err.message.includes("Extension context invalidated")) {
      renderError(shadowRoot, "Extension was updated. Please refresh this page to use VocabLens.");
    } else {
      renderError(shadowRoot, err.message || "Connection error. Please try again.");
    }
    attachDraggable(popupHost, shadowRoot);
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
    :host { 
      all: initial; 
      font-family: 'Be Vietnam Pro', system-ui, -apple-system, sans-serif; 
      font-weight: 500; 
      -webkit-font-smoothing: antialiased; 
    }

    /* Import Lora (Serif) & Be Vietnam Pro (Engineered for Vietnamese) */
    @import url('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Lora:ital,wght@0,500;0,600;0,700;1,500;1,600&display=swap');

    /* ---------- Wabi-Sabi Card container ---------- */
    .vl-card {
      background: #171513;
      background-image: 
        radial-gradient(ellipse at 50% -10%, rgba(194, 120, 84, 0.15), transparent 70%),
        radial-gradient(circle at 100% 100%, rgba(125, 139, 110, 0.1), transparent 60%);
      border: 1px solid rgba(210, 185, 155, 0.22);
      border-radius: 18px;
      padding: 14px 20px 20px 20px;
      box-shadow:
        0 24px 52px -10px rgba(0,0,0,0.75),
        0 0 0 1px rgba(255,255,255,0.04),
        inset 0 1px 0 rgba(255,255,255,0.08);
      color: #EDE6DD;
      animation: vocablens-fadein 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      position: relative;
      overflow-y: auto;
      max-height: calc(100vh - 48px);
      box-sizing: border-box;
      width: 100%;
    }

    /* Custom smooth slim scrollbar */
    .vl-card::-webkit-scrollbar {
      width: 5px;
    }
    .vl-card::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.12);
      border-radius: 4px;
    }
    .vl-card::-webkit-scrollbar-thumb {
      background: rgba(200, 180, 155, 0.3);
      border-radius: 4px;
    }
    .vl-card::-webkit-scrollbar-thumb:hover {
      background: rgba(200, 180, 155, 0.55);
    }

    /* Subtle top drag handle */
    .vl-drag-handle {
      width: 36px;
      height: 4px;
      background: rgba(200, 180, 155, 0.25);
      border-radius: 3px;
      margin: 0 auto 12px auto;
      cursor: grab;
      transition: all 0.2s ease;
    }
    .vl-drag-handle:hover {
      background: rgba(200, 180, 155, 0.55);
      transform: scaleY(1.3);
    }
    .vl-drag-handle:active {
      cursor: grabbing;
    }

    /* ---------- Header ---------- */
    .vl-word {
      font-family: 'Lora', Georgia, 'Times New Roman', serif;
      font-size: 25px;
      font-weight: 600;
      color: #FFFFFF;
      letter-spacing: -0.01em;
      line-height: 1.25;
    }
    .vl-ipa {
      font-family: 'Lora', Georgia, serif;
      font-size: 15px;
      font-weight: 500;
      color: #B5C9A3;
      font-style: italic;
      margin-top: 3px;
    }
    .vl-audio-btn {
      background: rgba(181, 201, 163, 0.14);
      border: 1px solid rgba(181, 201, 163, 0.32);
      border-radius: 8px;
      padding: 5px 10px;
      cursor: pointer;
      color: #D5E5C6;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .vl-audio-btn:hover {
      background: rgba(181, 201, 163, 0.25);
      color: #FFFFFF;
      transform: translateY(-1px);
    }

    /* ---------- Divider ---------- */
    .vl-divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(200, 180, 155, 0.28), transparent);
      margin: 15px 0;
    }

    /* ---------- Content sections ---------- */
    .vl-label {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.9px;
      text-transform: uppercase;
      color: #D4CBC0;
      margin-bottom: 5px;
    }
    .vl-translation {
      font-family: 'Lora', Georgia, serif;
      font-size: 21px;
      font-weight: 600;
      color: #F5C68A;
      margin-bottom: 12px;
      line-height: 1.4;
    }
    .vl-explanation {
      font-size: 14px;
      font-weight: 500;
      color: #EDE6DD;
      line-height: 1.65;
      margin-bottom: 15px;
    }
    .vl-example {
      font-family: 'Lora', Georgia, serif;
      font-size: 14.5px;
      font-weight: 500;
      color: #F0F6EE;
      line-height: 1.65;
      background: rgba(56, 68, 50, 0.4);
      border-left: 3px solid #8A9E7B;
      padding: 10px 14px;
      border-radius: 0 10px 10px 0;
      font-style: italic;
    }

    /* ---------- Actions ---------- */
    .vl-actions {
      display: flex;
      gap: 8px;
      margin-top: 18px;
      align-items: center;
      justify-content: space-between;
    }
    .vl-save-btn {
      flex: 1;
      background: linear-gradient(145deg, #B5653C 0%, #944820 100%);
      color: #FFFFFF;
      border: 1px solid rgba(240, 200, 170, 0.2);
      border-radius: 11px;
      padding: 10px 16px;
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.25s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      box-shadow: 0 4px 14px rgba(181, 101, 60, 0.3);
    }
    .vl-save-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 18px rgba(181, 101, 60, 0.4);
      background: linear-gradient(145deg, #C47248 0%, #A45228 100%);
    }
    .vl-save-btn:disabled {
      background: rgba(48, 59, 42, 0.95);
      border: 1px solid rgba(145, 163, 128, 0.4);
      color: #D5E5C6;
      box-shadow: none;
      cursor: default;
    }
    .vl-copy-btn {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(200, 180, 155, 0.24);
      border-radius: 11px;
      color: #EDE6DD;
      padding: 10px 14px;
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s ease;
    }
    .vl-copy-btn:hover {
      background: rgba(255,255,255,0.12);
      color: #FFFFFF;
      transform: translateY(-1px);
    }
    .vl-close-btn {
      width: 36px;
      height: 36px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      color: #C4B8AA;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      transition: all 0.2s ease;
      flex-shrink: 0;
    }
    .vl-close-btn:hover {
      background: rgba(255,255,255,0.12);
      color: #FFFFFF;
    }

    /* ---------- Skeleton loading ---------- */
    .vl-skeleton {
      border-radius: 6px;
      background: linear-gradient(90deg,
        rgba(255,255,255,0.05) 0%,
        rgba(255,255,255,0.1) 50%,
        rgba(255,255,255,0.05) 100%);
      background-size: 200% 100%;
      animation: vl-shimmer 1.8s infinite;
    }
    @keyframes vl-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* ---------- Error state ---------- */
    .vl-error {
      color: #FF9E9E;
      font-size: 13.5px;
      font-weight: 500;
      background: rgba(140, 50, 50, 0.2);
      border: 1px solid rgba(200, 80, 80, 0.35);
      border-radius: 10px;
      padding: 11px 15px;
      line-height: 1.5;
    }

    /* ---------- Badge ---------- */
    .vl-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      background: rgba(181, 201, 163, 0.16);
      border: 1px solid rgba(181, 201, 163, 0.35);
      border-radius: 20px;
      padding: 2.5px 9px;
      font-size: 11px;
      font-weight: 600;
      color: #B5C9A3;
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
    <div class="vl-drag-handle" title="Kéo để di chuyển"></div>
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
  const isSingle = data.isSingleWord !== undefined 
    ? data.isSingleWord 
    : (word.trim().split(/\s+/).filter(Boolean).length === 1);

  const card = document.createElement("div");
  card.className = "vl-card";

  // Build HTML depending on single word vs sentence
  if (isSingle) {
    // Single Word: Full vocab card (word, IPA, listen, meaning, explanation, example)
    const explanationHtml = explanation ? `
      <div class="vl-label">Giải thích & Sắc thái</div>
      <div class="vl-explanation">${escapeHtml(explanation)}</div>
    ` : '';

    const hasExample = example_en || example;
    const exampleHtml = hasExample ? `
      <div class="vl-label" style="margin-bottom:5px;">Ví dụ</div>
      <div class="vl-example">
        <div style="font-weight: 600; margin-bottom: 5px; color:#FFFFFF;">"${escapeHtml(example_en || example || "")}"</div>
        ${example_vi ? `<div style="font-style: normal; color: #B5C9A3; font-weight: 500; font-family: 'Be Vietnam Pro', sans-serif;">${escapeHtml(example_vi)}</div>` : ''}
      </div>
    ` : '';

    card.innerHTML = `
      <div class="vl-drag-handle" title="Kéo để di chuyển"></div>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px;">
        <div style="flex:1;min-width:0;">
          <div class="vl-word">${escapeHtml(word)}</div>
          ${ipa ? `<div class="vl-ipa">${escapeHtml(ipa)}</div>` : ''}
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;margin-left:10px;">
          <button class="vl-audio-btn" id="vl-play-audio" title="Nghe phát âm">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                 stroke-width="1.8" stroke="currentColor" width="14" height="14">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0
                   0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0
                   0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009
                   0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51
                   8.25H6.75Z"/>
            </svg>
            Nghe
          </button>
          <span class="vl-badge">Từ vựng</span>
        </div>
      </div>

      <div class="vl-divider"></div>

      <!-- Translation -->
      <div class="vl-label">Nghĩa tiếng Việt</div>
      <div class="vl-translation" style="font-family:'Lora',serif;font-size:21px;font-weight:600;color:#F5C68A;line-height:1.4;">${escapeHtml(translation)}</div>

      ${explanationHtml}
      ${exampleHtml}

      <!-- Action buttons -->
      <div class="vl-actions">
        <button class="vl-save-btn" id="vl-save-btn">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
               stroke-width="1.8" stroke="currentColor" width="14" height="14">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
          </svg>
          Lưu từ
        </button>

        <button class="vl-copy-btn" id="vl-copy-btn" title="Sao chép bản dịch">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
               stroke-width="1.8" stroke="currentColor" width="14" height="14">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375-7.5-7.5"/>
          </svg>
          Sao chép
        </button>

        <button class="vl-close-btn" id="vl-close-btn" title="Đóng">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
               stroke-width="1.8" stroke="currentColor" width="14" height="14">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
    `;
  } else {
    // Sentence / Paragraph: Only show the translated meaning, no original text
    card.innerHTML = `
      <div class="vl-drag-handle" title="Kéo để di chuyển"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#D4CBC0;">Bản dịch tiếng Việt</span>
        <span class="vl-badge" style="background:rgba(194,120,84,0.15);border-color:rgba(194,120,84,0.3);color:#D48B66;">Dịch câu</span>
      </div>

      <!-- Pure Translation Only -->
      <div class="vl-translation" style="font-size:16.5px;line-height:1.65;color:#FFFFFF;font-weight:500;font-family:'Be Vietnam Pro',sans-serif;margin-bottom:18px;">
        ${escapeHtml(translation)}
      </div>

      <!-- Action buttons -->
      <div class="vl-actions">
        <button class="vl-copy-btn" id="vl-copy-btn" style="flex:1;" title="Sao chép bản dịch">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
               stroke-width="1.8" stroke="currentColor" width="14" height="14">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375-7.5-7.5"/>
          </svg>
          Sao chép
        </button>

        <button class="vl-save-btn" id="vl-save-btn" style="flex:1;" title="Lưu bản dịch">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
               stroke-width="1.8" stroke="currentColor" width="14" height="14">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
          </svg>
          Lưu
        </button>

        <button class="vl-close-btn" id="vl-close-btn" title="Đóng">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
               stroke-width="1.8" stroke="currentColor" width="14" height="14">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
    `;
  }

  clearShadowContent(root);
  root.appendChild(card);

  // Wire up audio button (Native Web Speech API - 0ms latency, always works)
  const playBtn = root.getElementById("vl-play-audio");
  if (playBtn) {
    playBtn.addEventListener("click", () => {
      speakWordNative(word);
    });
  }

  // Wire up copy button
  const copyBtn = root.getElementById("vl-copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(translation).then(() => {
        copyBtn.innerHTML = `Đã chép ✓`;
        copyBtn.style.color = "#A3B18A";
        setTimeout(() => {
          copyBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                 stroke-width="1.8" stroke="currentColor" width="14" height="14">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375-7.5-7.5"/>
            </svg>
            Sao chép`;
          copyBtn.style.color = "";
        }, 1800);
      }).catch(console.error);
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
             stroke-width="2" stroke="currentColor" width="14" height="14">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
        </svg>
        Đang lưu…
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
          saveBtn.innerHTML = `⚠ Lỗi – Thử lại`;
        }
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = `⚠ Lỗi – Tải lại trang`;
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
    <div class="vl-drag-handle" title="Kéo để di chuyển"></div>
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

/**
 * Attaches smooth dragging behavior to the popup via its drag handle.
 */
function attachDraggable(host, root) {
  if (!host || !root) return;
  const dragHandle = root.querySelector(".vl-drag-handle");
  if (!dragHandle) return;

  let isDragging = false;
  let startX = 0, startY = 0;
  let initialLeft = 0, initialTop = 0;

  dragHandle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = host.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    host.style.right = "auto";
    host.style.bottom = "auto";
    host.style.left = `${initialLeft}px`;
    host.style.top = `${initialTop}px`;

    const onMouseMove = (moveEvent) => {
      if (!isDragging) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const newLeft = Math.max(8, Math.min(window.innerWidth - host.offsetWidth - 8, initialLeft + dx));
      const newTop = Math.max(8, Math.min(window.innerHeight - 80, initialTop + dy));
      host.style.left = `${newLeft}px`;
      host.style.top = `${newTop}px`;
    };

    const onMouseUp = () => {
      isDragging = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  });
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

function speakWordNative(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.92;
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn("Speech synthesis error:", err);
  }
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
