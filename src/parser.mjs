/**
 * Parse Claude Code JSONL transcripts into structured turns.
 */

import { readFileSync } from "node:fs";

/**
 * @typedef {{ tool_use_id: string, name: string, input: object, result: string|null }} ToolCall
 * @typedef {{ kind: string, text: string, tool_call: ToolCall|null }} AssistantBlock
 * @typedef {{ index: number, user_text: string, blocks: AssistantBlock[], timestamp: string }} Turn
 */

/**
 * Extract plain text from user message content (string or block array).
 */
function extractText(content) {
  if (typeof content === "string") return content;
  const parts = [];
  for (const block of content) {
    if (block.type === "text") parts.push(block.text);
  }
  return parts.join("\n");
}

/**
 * Check if a user message contains only tool_result blocks.
 */
function isToolResultOnly(content) {
  if (typeof content === "string") return false;
  return content.every((b) => b.type === "tool_result");
}

/**
 * Read JSONL and return only user/assistant entries.
 */
function parseJsonl(filePath) {
  const text = readFileSync(filePath, "utf-8");
  const entries = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const topType = obj.type;
    if (topType === "user" || topType === "assistant") {
      entries.push(obj);
    } else if (topType == null) {
      const role = obj.message?.role;
      if (role === "user" || role === "assistant") {
        entries.push(obj);
      }
    }
  }
  return entries;
}

/**
 * Collect all assistant content blocks starting from index `start`.
 * Returns [blocks, nextIndex].
 */
function collectAssistantBlocks(entries, start) {
  const blocks = [];
  const seenKeys = new Set();
  let i = start;

  while (i < entries.length) {
    const entry = entries[i];
    const role = entry.message?.role ?? entry.type;
    if (role !== "assistant") break;

    const content = entry.message?.content ?? [];
    if (Array.isArray(content)) {
      for (const block of content) {
        const btype = block.type;
        if (btype === "text") {
          const text = (block.text ?? "").trim();
          if (!text) { i++; continue; }
          const key = `text:${text.slice(0, 100)}`;
          if (seenKeys.has(key)) { i++; continue; }
          seenKeys.add(key);
          blocks.push({ kind: "text", text, tool_call: null });
        } else if (btype === "thinking") {
          const text = (block.thinking ?? "").trim();
          if (!text) { i++; continue; }
          const key = `thinking:${text.slice(0, 100)}`;
          if (seenKeys.has(key)) { i++; continue; }
          seenKeys.add(key);
          blocks.push({ kind: "thinking", text, tool_call: null });
        } else if (btype === "tool_use") {
          const toolId = block.id ?? "";
          const key = `tool_use:${toolId}`;
          if (seenKeys.has(key)) { i++; continue; }
          seenKeys.add(key);
          blocks.push({
            kind: "tool_use",
            text: "",
            tool_call: {
              tool_use_id: toolId,
              name: block.name ?? "",
              input: block.input ?? {},
              result: null,
            },
          });
        }
      }
    }
    i++;
  }

  return [blocks, i];
}

/**
 * Scan forward from resultStart for user messages containing tool_result blocks.
 * Match them to tool_use blocks by tool_use_id.
 * Returns index after consumed entries.
 */
function attachToolResults(blocks, entries, resultStart) {
  const pending = new Map();
  for (const b of blocks) {
    if (b.kind === "tool_use" && b.tool_call) {
      pending.set(b.tool_call.tool_use_id, b.tool_call);
    }
  }
  if (pending.size === 0) return resultStart;

  let i = resultStart;
  while (i < entries.length && pending.size > 0) {
    const entry = entries[i];
    const role = entry.message?.role ?? entry.type;
    if (role === "assistant") break;
    if (role === "user") {
      const content = entry.message?.content ?? "";
      if (Array.isArray(content)) {
        let hasToolResult = false;
        for (const block of content) {
          if (block.type === "tool_result") {
            hasToolResult = true;
            const tid = block.tool_use_id ?? "";
            if (pending.has(tid)) {
              const resultContent = block.content;
              let resultText;
              if (Array.isArray(resultContent)) {
                resultText = resultContent
                  .filter((p) => p.type === "text")
                  .map((p) => p.text ?? "")
                  .join("\n");
              } else if (typeof resultContent === "string") {
                resultText = resultContent;
              } else {
                resultText = String(resultContent);
              }
              pending.get(tid).result = resultText;
              pending.delete(tid);
            }
          }
        }
        if (!hasToolResult) break;
      } else {
        break;
      }
    }
    i++;
  }

  return i;
}

/**
 * Parse a JSONL transcript into a list of Turns.
 * @param {string} filePath
 * @returns {Turn[]}
 */
export function parseTranscript(filePath) {
  const entries = parseJsonl(filePath);
  const turns = [];
  let i = 0;
  let turnIndex = 0;

  while (i < entries.length) {
    const entry = entries[i];
    const role = entry.message?.role ?? entry.type;

    if (role === "user") {
      const content = entry.message?.content ?? "";
      if (isToolResultOnly(content)) {
        i++;
        continue;
      }
      const userText = extractText(content);
      const timestamp = entry.timestamp ?? "";
      i++;

      const [assistantBlocks, nextI] = collectAssistantBlocks(entries, i);
      i = nextI;
      i = attachToolResults(assistantBlocks, entries, i);

      turnIndex++;
      turns.push({
        index: turnIndex,
        user_text: userText,
        blocks: assistantBlocks,
        timestamp,
      });
    } else if (role === "assistant") {
      const [assistantBlocks, nextI] = collectAssistantBlocks(entries, i);
      i = nextI;
      i = attachToolResults(assistantBlocks, entries, i);

      // Merge orphan assistant blocks into the previous turn
      if (turns.length > 0) {
        turns[turns.length - 1].blocks.push(...assistantBlocks);
      } else {
        // No previous turn — create one (first entry is assistant)
        turnIndex++;
        turns.push({
          index: turnIndex,
          user_text: "",
          blocks: assistantBlocks,
          timestamp: entry.timestamp ?? "",
        });
      }
    } else {
      i++;
    }
  }

  return turns;
}

/**
 * Filter turns by index range or time range.
 * @param {Turn[]} turns
 * @param {{ turnRange?: [number,number], timeFrom?: string, timeTo?: string }} opts
 * @returns {Turn[]}
 */
export function filterTurns(turns, opts = {}) {
  let result = turns;

  if (opts.turnRange) {
    const [start, end] = opts.turnRange;
    result = result.filter((t) => t.index >= start && t.index <= end);
  }

  if (opts.timeFrom) {
    const dtFrom = new Date(opts.timeFrom).getTime();
    result = result.filter(
      (t) => t.timestamp && new Date(t.timestamp).getTime() >= dtFrom
    );
  }

  if (opts.timeTo) {
    const dtTo = new Date(opts.timeTo).getTime();
    result = result.filter(
      (t) => t.timestamp && new Date(t.timestamp).getTime() <= dtTo
    );
  }

  return result;
}
