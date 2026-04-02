/**
 * Cursor JSONL format parser.
 *
 * Format: JSONL with { role: "user"|"assistant", message: { role, content } }
 * Similar to Claude Code but uses `role` instead of `type`, and reclassifies
 * all assistant blocks except the last per turn as "thinking".
 */

import { buildTurnsFromEntries } from "./shared.mjs";

export const name = "cursor";

/**
 * Detect if JSONL lines contain Cursor format entries.
 * Must check that `type` is absent to avoid matching Claude Code entries.
 */
export function detect(firstObj) {
  if (firstObj.type) return false;
  return firstObj.role === "user" || firstObj.role === "assistant";
}

/**
 * Read Cursor JSONL and normalize entries to Claude Code shape.
 * Only accepts entries without a top-level `type` field (matching original behavior).
 */
function parseEntries(text) {
  const entries = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; }
    // Cursor entries use `role` without `type` — skip any with a `type` field
    if (obj.type) continue;
    const role = obj.message?.role ?? obj.role;
    if (role === "user" || role === "assistant") {
      entries.push({
        type: role,
        message: { role, content: obj.message?.content ?? "" },
        timestamp: obj.timestamp ?? null,
      });
    }
  }
  return entries;
}

/**
 * Parse Cursor JSONL text into Turn[].
 */
export function parse(text) {
  const turns = buildTurnsFromEntries(parseEntries(text));

  // Cursor-specific: reclassify all but last assistant block as thinking
  for (const turn of turns) {
    for (let j = 0; j < turn.blocks.length - 1; j++) {
      if (turn.blocks[j].kind === "text") {
        turn.blocks[j].kind = "thinking";
      }
    }
  }

  return turns;
}
