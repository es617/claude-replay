/**
 * Claude Code JSONL format parser.
 *
 * Format: JSONL with { type: "user"|"assistant", message: { role, content }, timestamp }
 * Each user message starts a new turn. Assistant blocks are collected and tool results attached.
 */

import { buildTurnsFromEntries } from "./shared.mjs";

export const name = "claude-code";

/**
 * Detect if JSONL lines contain Claude Code format entries.
 */
export function detect(firstObj) {
  return firstObj.type === "user" || firstObj.type === "assistant";
}

/**
 * Read JSONL and return only user/assistant entries in normalized form.
 */
function parseEntries(text) {
  const entries = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; }
    if (obj.type === "user" || obj.type === "assistant") {
      entries.push(obj);
    }
  }
  return entries;
}

/**
 * Parse Claude Code JSONL text into Turn[].
 */
export function parse(text) {
  return buildTurnsFromEntries(parseEntries(text));
}
