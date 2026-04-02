/**
 * Replay JSONL format parser.
 *
 * Format: JSONL output of `claude-replay extract`.
 * Each line is a turn object with { index, user_text, blocks, timestamp }.
 * An optional final line with { type: "bookmarks" } contains bookmarks.
 */

export const name = "replay";

/**
 * Detect if a JSONL line is a replay format turn.
 */
export function detect(firstObj) {
  return firstObj.user_text !== undefined && firstObj.blocks !== undefined;
}

/**
 * Parse replay JSONL text into Turn[].
 */
export function parse(text) {
  const turns = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.user_text !== undefined || obj.blocks !== undefined) {
        turns.push(obj);
      }
    } catch { continue; }
  }
  return turns;
}
