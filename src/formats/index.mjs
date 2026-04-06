/**
 * Format registry for claude-replay.
 *
 * Each format module exports: { name, detect(firstObj), parse(text) }
 * To add a new format:
 *   1. Create src/formats/my-format.mjs with name, detect, parse exports
 *   2. Import and add it to the `formats` array below
 *   3. Add a test fixture in test/ and tests in test/test-parser.mjs
 *
 * Detection order matters — more specific formats should come first.
 * Gemini is special: it uses detectFromText() since it's a single JSON object, not JSONL.
 */

import * as claudeCode from "./claude-code.mjs";
import * as cursor from "./cursor.mjs";
import * as codex from "./codex.mjs";
import * as gemini from "./gemini.mjs";
import * as opencode from "./opencode.mjs";
import * as replay from "./replay.mjs";

/**
 * Ordered list of JSONL-based format detectors.
 * Detection is tried in order; first match wins.
 * More specific formats (codex, opencode, replay) must come before
 * generic ones (claude-code, cursor).
 */
export const formats = [
  replay,
  codex,
  opencode,
  claudeCode,
  cursor,
];

/**
 * Special-case formats that need full-text detection (not line-by-line JSONL).
 */
export const textDetectors = [
  gemini,
];

/**
 * Detect format from text content.
 * @param {string} text
 * @returns {string} Format name or "unknown"
 */
export function detectFormatFromText(text) {
  // Check text-level detectors first (e.g. Gemini single-JSON)
  for (const fmt of textDetectors) {
    if (fmt.detectFromText(text)) return fmt.name;
  }

  // Check JSONL-based detectors line by line.
  // Must scan multiple lines — real sessions often start with metadata entries
  // (e.g. queue-operation, session-id) before the first user/assistant entry.
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; }

    for (const fmt of formats) {
      if (fmt.detect(obj)) return fmt.name;
    }
  }

  return "unknown";
}

/**
 * Parse transcript text using the appropriate format parser.
 * @param {string} text
 * @returns {import("./shared.mjs").Turn[]}
 */
export function parseFromText(text) {
  const format = detectFormatFromText(text);
  const allFormats = [...textDetectors, ...formats];
  const fmt = allFormats.find((f) => f.name === format);
  if (fmt) return fmt.parse(text);
  return [];
}
