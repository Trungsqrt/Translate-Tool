/**
 * background.js – Service Worker
 *
 * Handles all network requests on behalf of content scripts.
 * Runs in the extension's background context, so no CORS issues.
 *
 * Message API:
 *   Request:  { action: "translate", word: string }
 *   Response: { success: bool, data: VocabEntry | null, error?: string }
 *
 * VocabEntry shape:
 *   { word, ipa, audioUrl, translation, explanation, example }
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const GROQ_BASE =
  "https://api.groq.com/openai/v1/chat/completions";

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "translate") {
    handleTranslate(request.word)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) =>
        sendResponse({ success: false, error: err.message ?? String(err) })
      );
    // Return true to keep the message channel open for async sendResponse
    return true;
  }

  if (request.action === "saveWord") {
    saveWord(request.entry)
      .then(() => sendResponse({ success: true }))
      .catch((err) =>
        sendResponse({ success: false, error: err.message ?? String(err) })
      );
    return true;
  }
});

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Orchestrates translation directly through Groq for blazing speed (~0.3s):
 * - Single word: Groq generates standard IPA, Vietnamese meaning, nuance explanation & example.
 * - Multi-word (phrases/sentences/paragraphs): Groq directly translates to Vietnamese only.
 * No third-party dictionary delays or timeouts.
 * @param {string} text – The selected text from the page.
 * @returns {Promise<object>} VocabEntry or translation result.
 */
async function handleTranslate(text) {
  const trimmed = text.trim();
  const wordTokens = trimmed.split(/\s+/).filter(Boolean);
  const isSingleWord = wordTokens.length === 1;

  if (isSingleWord) {
    // 1 single word: fetch detailed dictionary data directly from Groq
    const groqData = await fetchGroqSingleWord(trimmed);

    return {
      word: trimmed,
      isSingleWord: true,
      ipa: groqData.ipa || "",
      audioUrl: "", // Browser synthesizes native speech via Web Speech API
      translation: groqData.translation || "",
      explanation: groqData.explanation || "",
      example_en: groqData.example_en || "",
      example_vi: groqData.example_vi || "",
      example: groqData.example || "",
    };
  } else {
    // Multiple words / sentence / paragraph: fast direct translation
    const groqData = await fetchGroqFastTranslate(trimmed);

    return {
      word: trimmed,
      isSingleWord: false,
      ipa: "",
      audioUrl: "",
      translation: groqData.translation || "",
      explanation: "",
      example_en: "",
      example_vi: "",
      example: "",
    };
  }
}

// ---------------------------------------------------------------------------
// Groq API Callers
// ---------------------------------------------------------------------------

/**
 * Detailed dictionary entry for a single word.
 */
async function fetchGroqSingleWord(word) {
  const stored = await chrome.storage.local.get(["groqApiKey", "groqModel"]);
  const apiKey = stored.groqApiKey;
  const model = stored.groqModel?.trim() || "llama-3.3-70b-versatile";

  if (!apiKey) {
    throw new Error(
      "Groq API key not set. Please click the extension icon to enter your API key."
    );
  }

  const systemInstruction = `You are an English-Vietnamese dictionary assistant.
Return ONLY valid JSON (no markdown fences, no extra text) with exactly these keys:
{
  "ipa": "Standard IPA transcription for \\"${word}\\"",
  "translation": "<Short Vietnamese meaning>",
  "explanation": "<Brief nuance or usage context in Vietnamese>",
  "example_en": "One natural English example sentence.",
  "example_vi": "Vietnamese translation of the example sentence."
}`;

  const body = {
    model: model,
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: `Word: "${word}"` }
    ],
    temperature: 0.2,
    max_tokens: 384,
  };

  return await callGroqAPI(body, apiKey);
}

/**
 * Ultra-fast direct translation for sentences, phrases, and paragraphs.
 * Only outputs the Vietnamese translation, saving massive compute and tokens.
 */
async function fetchGroqFastTranslate(text) {
  const stored = await chrome.storage.local.get(["groqApiKey", "groqModel"]);
  const apiKey = stored.groqApiKey;
  const model = stored.groqModel?.trim() || "llama-3.3-70b-versatile";

  if (!apiKey) {
    throw new Error(
      "Groq API key not set. Please click the extension icon to enter your API key."
    );
  }

  const systemInstruction = `You are an expert English-to-Vietnamese translator.
Translate the user's English text into fluent, natural Vietnamese.
Return ONLY valid JSON with a single key "translation":
{"translation": "<Vietnamese translation>"}`;

  const body = {
    model: model,
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: text }
    ],
    temperature: 0.2,
    max_tokens: 1024,
  };

  return await callGroqAPI(body, apiKey);
}

/**
 * Common caller for Groq chat completions.
 */
async function callGroqAPI(body, apiKey) {
  const res = await fetch(GROQ_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();

    if (res.status === 429) {
      throw new Error("Groq API Quota Exceeded. Please wait a moment or check your API plan.");
    }

    let parsedMsg = errText;
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error && errJson.error.message) {
        parsedMsg = errJson.error.message;
      }
    } catch {
      // Not JSON, use raw text
    }

    throw new Error(`Groq API Error(${res.status}): ${parsedMsg}`);
  }

  const json = await res.json();
  const rawText = json?.choices?.[0]?.message?.content ?? "";

  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Groq returned non-JSON response: ${rawText}`);
  }
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * Saves a vocabulary entry to chrome.storage.local.
 * Avoids duplicate words by checking the existing array.
 * @param {object} entry
 */
async function saveWord(entry) {
  const stored = await chrome.storage.local.get("vocabList");
  const list = stored.vocabList ?? [];

  // Prevent exact duplicate words (case-insensitive)
  const isDuplicate = list.some(
    (item) => item.word.toLowerCase() === entry.word.toLowerCase()
  );

  if (!isDuplicate) {
    list.unshift({ ...entry, timestamp: new Date().toISOString() });
    await chrome.storage.local.set({ vocabList: list });
  }
}
