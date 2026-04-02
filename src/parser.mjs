/**
 * Parse AI coding session transcripts into structured turns.
 *
 * Supports: Claude Code, Cursor, Codex CLI, Gemini CLI, OpenCode, and replay JSONL.
 *
 * This module is the public API — it delegates to format-specific parsers in src/formats/.
 * To add support for a new agent/CLI, see CONTRIBUTING.md.
 */

import { readFileSync } from "node:fs";
import { detectFormatFromText, parseFromText } from "./formats/index.mjs";

/**
 * @typedef {import("./formats/shared.mjs").ToolCall} ToolCall
 * @typedef {import("./formats/shared.mjs").AssistantBlock} AssistantBlock
 * @typedef {import("./formats/shared.mjs").Turn} Turn
 */

// Re-export for consumers
export { detectFormatFromText };

/**
 * Detect transcript format by reading a file.
 * @param {string} filePath
 * @returns {string}
 */
export function detectFormat(filePath) {
  return detectFormatFromText(readFileSync(filePath, "utf-8"));
}

/**
 * Parse a JSONL/JSON transcript file into Turn[].
 * @param {string} filePath
 * @returns {Turn[]}
 */
export function parseTranscript(filePath) {
  return parseTranscriptFromText(readFileSync(filePath, "utf-8"));
}

/**
 * Parse a transcript from text content (browser-compatible, no filesystem access).
 * @param {string} text
 * @returns {Turn[]}
 */
export function parseTranscriptFromText(text) {
  return parseFromText(text);
}

/**
 * Replace timestamps with synthetic pacing based on content length.
 * Drives presentation timing, not historical accuracy.
 * @param {Turn[]} turns
 */
export function applyPacedTiming(turns) {
  let cursor = 0;
  for (const turn of turns) {
    turn.timestamp = new Date(cursor).toISOString();
    cursor += 500;
    for (const block of turn.blocks) {
      block.timestamp = new Date(cursor).toISOString();
      const len = (block.text || "").length;
      cursor += Math.min(Math.max(len * 30, 1000), 10000);
      if (block.tool_call) {
        block.tool_call.resultTimestamp = new Date(cursor).toISOString();
      }
    }
  }
}

/**
 * Filter turns by index range or time range.
 * @param {Turn[]} turns
 * @param {{ turnRange?: [number,number], excludeTurns?: number[], timeFrom?: string, timeTo?: string }} opts
 * @returns {Turn[]}
 */
export function filterTurns(turns, opts = {}) {
  let result = turns;

  if (opts.turnRange) {
    const [start, end] = opts.turnRange;
    result = result.filter((t) => t.index >= start && t.index <= end);
  }

  if (opts.excludeTurns) {
    const excluded = new Set(opts.excludeTurns);
    result = result.filter((t) => !excluded.has(t.index));
  }

  if (opts.timeFrom) {
    const dtFrom = new Date(opts.timeFrom).getTime();
    if (isNaN(dtFrom)) throw new Error(`Invalid --from date: ${opts.timeFrom}`);
    result = result.filter(
      (t) => t.timestamp && new Date(t.timestamp).getTime() >= dtFrom
    );
  }

  if (opts.timeTo) {
    const dtTo = new Date(opts.timeTo).getTime();
    if (isNaN(dtTo)) throw new Error(`Invalid --to date: ${opts.timeTo}`);
    result = result.filter(
      (t) => t.timestamp && new Date(t.timestamp).getTime() <= dtTo
    );
  }

  return result;
}
