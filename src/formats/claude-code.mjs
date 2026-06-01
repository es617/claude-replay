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

/**
 * Extract a human-readable session title from Claude Code JSONL text.
 *
 * Scans all lines and returns the *last* title found (Claude appends updated
 * titles throughout a session). Priority: custom-title > ai-title > agent-name.
 * Returns null when no title entry is present.
 *
 * @param {string} text - Raw JSONL text (may be a tail slice of a large file)
 * @returns {string|null}
 */
export function extractTitle(text) {
  let custom = null;
  let ai = null;
  let agentName = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; }
    if (obj.type === "custom-title" && obj.customTitle) {
      custom = obj.customTitle;
    } else if (obj.type === "ai-title" && obj.aiTitle) {
      ai = obj.aiTitle;
    } else if (obj.type === "agent-name" && obj.agentName) {
      agentName = obj.agentName;
    }
  }

  const raw = custom ?? ai ?? agentName ?? null;
  if (!raw) return null;
  // Strip a single wrapping pair of double-quotes that Claude sometimes adds
  const dequoted = raw.replace(/^"(.*)"$/, "$1").trim();
  return dequoted || null;
}
