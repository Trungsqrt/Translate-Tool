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
const DICTIONARY_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en/";
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
 * Orchestrates parallel calls to the Dictionary API and Groq API,
 * then merges the results into a single VocabEntry object.
 * @param {string} word – The selected text from the page.
 * @returns {Promise<object>} Merged vocab entry.
 */
async function handleTranslate(word) {
  // Fire both requests in parallel for speed
  const [dictResult, groqResult] = await Promise.allSettled([
    fetchDictionary(word),
    fetchGroq(word),
  ]);

  // Dictionary data (optional – graceful degradation if not found)
  const dictData =
    dictResult.status === "fulfilled" ? dictResult.value : { ipa: "", audioUrl: "" };

  // Groq data (required – throw if failed)
  if (groqResult.status === "rejected") {
    // If the error is an Error object, we want its message, otherwise just stringify
    const msg = groqResult.reason instanceof Error ? groqResult.reason.message : groqResult.reason;
    throw new Error(msg);
  }
  const groqData = groqResult.value;

  return {
    word,
    ipa: dictData.ipa || "",
    audioUrl: dictData.audioUrl || "",
    translation: groqData.translation || "",
    explanation: groqData.explanation || "",
    example_en: groqData.example_en || "",
    example_vi: groqData.example_vi || "",
    example: groqData.example || "", // For backward compatibility if needed
  };
}

// ---------------------------------------------------------------------------
// Free Dictionary API
// ---------------------------------------------------------------------------

/**
 * Fetches IPA transcription and audio URL from dictionaryapi.dev.
 * Silently returns empty strings on failure (word may not be in dictionary).
 * @param {string} word
 * @returns {Promise<{ipa: string, audioUrl: string}>}
 */
async function fetchDictionary(word) {
  const url = `${DICTIONARY_BASE}${encodeURIComponent(word.toLowerCase())}`;
  const res = await fetch(url);

  if (!res.ok) {
    // 404 = word not found; return graceful empty values
    return { ipa: "", audioUrl: "" };
  }

  const json = await res.json();
  const entry = json[0]; // First dictionary entry

  // Extract first available phonetic object that has both text and audio
  let ipa = "";
  let audioUrl = "";

  if (entry?.phonetics?.length) {
    // Prefer a phonetic that has both text and audio
    const withBoth = entry.phonetics.find((p) => p.text && p.audio);
    const withAudio = entry.phonetics.find((p) => p.audio);
    const withText = entry.phonetics.find((p) => p.text);

    ipa = withBoth?.text ?? withText?.text ?? entry.phonetic ?? "";
    audioUrl = withBoth?.audio ?? withAudio?.audio ?? "";
  } else if (entry?.phonetic) {
    ipa = entry.phonetic;
  }

  return { ipa, audioUrl };
}

// ---------------------------------------------------------------------------
// Groq API
// ---------------------------------------------------------------------------

/**
 * Calls Groq (Llama 3) to get Vietnamese translation, explanation, and an example sentence.
 * @param {string} word
 * @returns {Promise<{translation: string, explanation: string, example: string}>}
 */
async function fetchGroq(word) {
  // Retrieve API key from storage
  const stored = await chrome.storage.local.get("groqApiKey");
  const apiKey = stored.groqApiKey;

  if (!apiKey) {
    throw new Error(
      "Groq API key not set. Please open the extension Options page to add your key."
    );
  }

  const systemInstruction = `You are an English-Vietnamese dictionary assistant.
Return ONLY valid JSON (no markdown fences, no extra text) with exactly these keys:
{
"ipa": "The standard IPA phonetic transcription for "${word}" (e.g., "/rɪˈkwest ˈnʌm.bər/").",
  "translation": "<Short Vietnamese meaning of the word/phrase>",
  "explanation": "<Brief explanation of nuance, tone, or usage context in Vietnamese>",
  "example_en": "One natural English example sentence using the word.",
  "example_vi": "Vietnamese translation of the example sentence.";
} `;

  const body = {
    model: "openai/gpt-oss-120b",
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: `Word or phrase: "${word}"` }
    ],
    temperature: 0.3,
    max_tokens: 512,
  };

  const res = await fetch(GROQ_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey} `
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();

    if (res.status === 429) {
      throw new Error("Groq API Quota Exceeded. Please wait a moment before trying again, or check your API plan.");
    }

    let parsedMsg = errText;
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error && errJson.error.message) {
        parsedMsg = errJson.error.message;
      }
    } catch (e) {
      // Not JSON, use raw text
    }

    throw new Error(`Groq API Error(${res.status}): ${parsedMsg} `);
  }

  const json = await res.json();

  // Extract the text content from Groq's response structure
  const rawText = json?.choices?.[0]?.message?.content ?? "";

  // Strip potential markdown code fences just in case
  const cleaned = rawText
    .replace(/^```json\s */i, "")
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
