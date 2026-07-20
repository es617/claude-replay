/**
 * Kimi Code wire format parser.
 *
 * Format: JSONL with per-turn event streaming.
 *   - turn.prompt: starts a new turn, contains user input and timestamp
 *   - context.append_loop_event: assistant content (think, text, tool calls, tool results)
 *   - context.append_message: user/assistant messages (mirrors turn content)
 *
 * Each turn has one or more steps. Steps are bounded by step.begin/step.end.
 * Tool calls and results are matched by toolCallId within the same turn.
 *
 * Timestamps are Unix milliseconds (turn.prompt.time) → converted to ISO 8601.
 *
 * Session path: ~/.kimi-code/sessions/<project>/<session>/agents/main/wire.jsonl
 */

import { cleanSystemTags, filterEmptyTurns } from "./shared.mjs";

export const name = "kimi-code";

/**
 * Detect if a JSONL line belongs to kimi-code format.
 * kimi-code sessions start with metadata entries and contain
 * turn.prompt or context.append_loop_event type entries.
 */
export function detect(firstObj) {
  return firstObj.type === "turn.prompt" ||
    firstObj.type === "context.append_loop_event";
}

/**
 * Convert Unix milliseconds to ISO 8601 string.
 * @param {number} ms
 * @returns {string}
 */
function msToISO(ms) {
  return new Date(ms).toISOString();
}

/**
 * Extract user text from turn.prompt input array.
 * @param {object[]} input
 * @returns {string}
 */
function extractUserText(input) {
  if (!Array.isArray(input)) return "";
  const parts = [];
  for (const block of input) {
    if (block.type === "text" && block.text) {
      parts.push(block.text);
    }
  }
  return cleanSystemTags(parts.join("\n"));
}

/**
 * Parse kimi-code wire.jsonl text into Turn[].
 * @param {string} text
 * @returns {import("./shared.mjs").Turn[]}
 */
export function parse(text) {
  // Parse all lines into objects
  const entries = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch { /* skip malformed */ }
  }

  // Group loop events by turnId
  const turnPrompts = [];        // { turnId, input, time }
  const loopEvents = new Map();  // turnId → events[]
  let currentTurnId = "";

  for (const entry of entries) {
    if (entry.type === "turn.prompt") {
      currentTurnId = String(turnPrompts.length);
      turnPrompts.push({
        turnId: currentTurnId,
        input: entry.input,
        time: entry.time,
      });
    } else if (entry.type === "context.append_loop_event") {
      const ev = entry.event;
      if (!ev) continue;
      // tool.result events don't have turnId — inherit from current turn
      const turnId = ev.turnId != null ? String(ev.turnId) : currentTurnId;
      if (!loopEvents.has(turnId)) {
        loopEvents.set(turnId, []);
      }
      loopEvents.get(turnId).push(ev);
    }
  }

  // Build turns
  const turns = [];

  for (const tp of turnPrompts) {
    const userText = extractUserText(tp.input);
    const timestamp = tp.time ? msToISO(tp.time) : "";
    const events = loopEvents.get(tp.turnId) ?? [];

    const blocks = [];
    const toolCalls = new Map(); // toolCallId → tool_call object

    for (const ev of events) {
      if (ev.type === "content.part") {
        const part = ev.part;
        if (!part) continue;

        if (part.type === "think") {
          const thinkText = (part.think ?? "").trim();
          if (thinkText) {
            blocks.push({
              kind: "thinking",
              text: thinkText,
              tool_call: null,
              timestamp: null,
            });
          }
        } else if (part.type === "text") {
          const textContent = (part.text ?? "").trim();
          if (textContent) {
            blocks.push({
              kind: "text",
              text: textContent,
              tool_call: null,
              timestamp: null,
            });
          }
        }
      } else if (ev.type === "tool.call") {
        const toolId = ev.toolCallId ?? "";
        const toolName = ev.name ?? "";
        const args = ev.args ?? {};
        const toolCall = {
          tool_use_id: toolId,
          name: toolName,
          input: args,
          result: null,
          resultTimestamp: null,
          is_error: false,
        };
        toolCalls.set(toolId, toolCall);
        blocks.push({
          kind: "tool_use",
          text: "",
          tool_call: toolCall,
          timestamp: null,
        });
      } else if (ev.type === "tool.result") {
        const toolId = ev.toolCallId ?? "";
        const tc = toolCalls.get(toolId);
        if (tc) {
          const result = ev.result ?? {};
          tc.result = result.output ?? null;
          tc.is_error = !!result.isError;
          tc.resultTimestamp = null;
        }
      }
    }

    turns.push({
      index: 0, // Will be re-indexed by filterEmptyTurns
      user_text: userText,
      blocks,
      timestamp,
    });
  }

  return filterEmptyTurns(turns);
}