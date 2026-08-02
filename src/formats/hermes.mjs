/**
 * Hermes Agent format parser.
 *
 * Format: Single JSON object with { session_id, messages[], model, platform, ... }
 * Messages use OpenAI-style role: user/assistant/tool
 * Assistant messages have optional reasoning + tool_calls[]
 * Tool messages have role=tool with name + tool_call_id
 *
 * This is similar to Gemini format, but uses standard OpenAI message shapes.
 */

import { cleanSystemTags, filterEmptyTurns } from "./shared.mjs";

export const name = "hermes";

/**
 * Detect if text is Hermes format (single JSON with session_id + messages).
 * Hermes sessions have 'session_id' (not 'sessionId') and messages array.
 */
export function detectFromText(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const obj = JSON.parse(trimmed);
    // Hermes: has session_id + messages array
    // Also check for model/platform to distinguish from other single-JSON formats
    return !!(obj.session_id && Array.isArray(obj.messages) && obj.model);
  } catch {
    return false;
  }
}

/**
 * Not used for JSONL-based detection — Hermes uses detectFromText instead.
 */
export function detect() {
  return false;
}

/**
 * Tool name mapping: Hermes tool names → Claude Code display names.
 * Hermes uses function names like "terminal", "read_file", "skill_view", etc.
 */
const TOOL_MAP = {
  terminal: "Bash",
  browser_navigate: "WebFetch",
  browser_click: "WebFetch",
  browser_snapshot: "WebFetch",
  browser_vision: "WebFetch",
  read_file: "Read",
  write_file: "Write",
  patch: "Edit",
  search_files: "Grep",
  session_search: "Grep",
  memory: "memory",
  memory_save: "memory_save",
  memory_recall: "memory_recall",
  memory_search: "memory_search",
  skill_view: "Glob",
  skill_manage: "Edit",
  skills_list: "Glob",
  delegate_task: "Task",
  execute_code: "Bash",
  clarify: "AskUserQuestion",
  todo: "TodoWrite",
  cronjob: "cronjob",
  discord: "discord",
  process: "Bash",
  vision_analyze: "vision_analyze",
  browser_console: "WebFetch",
  browser_back: "WebFetch",
  browser_get_images: "WebFetch",
  browser_press: "WebFetch",
  browser_scroll: "WebFetch",
  browser_type: "WebFetch",
  text_to_speech: "text_to_speech",
};

/**
 * Parse Hermes session JSON text into Turn[].
 */
export function parse(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!data.messages || !Array.isArray(data.messages)) return [];

  const turns = [];
  let turnIndex = 0;
  let currentUserText = "";
  let currentTimestamp = "";
  let currentBlocks = [];
  // Track pending tool_use blocks by tool_call_id for result attachment
  let pendingTools = new Map();

  function finalizeTurn() {
    if (!currentUserText && currentBlocks.length === 0) return;
    turnIndex++;
    turns.push({
      index: turnIndex,
      user_text: currentUserText,
      blocks: currentBlocks,
      timestamp: currentTimestamp,
    });
    currentUserText = "";
    currentTimestamp = "";
    currentBlocks = [];
    pendingTools = new Map();
  }

  for (const msg of data.messages) {
    const role = msg.role;

    if (role === "user") {
      finalizeTurn();
      let content = msg.content ?? "";
      // Hermes Discord messages may have [Username] prefix
      content = content.replace(/^\[[^\]]+\]\s*/, "");
      currentUserText = content.trim();
      currentTimestamp = "";
      continue;
    }

    if (role === "tool") {
      // Tool result — attach to pending tool_use block
      const toolCallId = msg.tool_call_id ?? "";
      if (pendingTools.has(toolCallId)) {
        const tc = pendingTools.get(toolCallId);
        let resultText = msg.content ?? "";
        // Try to parse JSON result for better display
        try {
          const parsed = JSON.parse(resultText);
          if (parsed && typeof parsed === "object") {
            // If it has an "output" field, use that
            if (parsed.output !== undefined) {
              resultText = String(parsed.output);
            } else if (parsed.error !== undefined) {
              resultText = String(parsed.error);
              tc.is_error = true;
            }
          }
        } catch {
          // Not JSON, use as-is
        }
        tc.result = resultText;
        tc.resultTimestamp = null;
        pendingTools.delete(toolCallId);
      }
      continue;
    }

    if (role === "assistant") {
      // Reasoning / thinking
      const reasoning = msg.reasoning ?? msg.reasoning_content ?? null;
      if (reasoning && reasoning.trim()) {
        currentBlocks.push({
          kind: "thinking",
          text: reasoning.trim(),
          tool_call: null,
          timestamp: null,
        });
      }

      // Tool calls
      const toolCalls = msg.tool_calls ?? [];
      for (const tc of toolCalls) {
        const rawName = tc.function?.name ?? tc.name ?? "unknown";
        const mappedName = TOOL_MAP[rawName] ?? rawName;
        let input = {};
        try {
          const args = tc.function?.arguments ?? "{}";
          input =
            typeof args === "string" ? JSON.parse(args) : args;
        } catch {
          input = {};
        }
        // Simplify Bash input to show command
        const normalizedInput =
          mappedName === "Bash" && input.command
            ? { command: input.command }
            : input;

        const toolBlock = {
          tool_use_id: tc.id ?? tc.call_id ?? "",
          name: mappedName,
          input: normalizedInput,
          result: null,
          resultTimestamp: null,
          is_error: false,
        };
        currentBlocks.push({
          kind: "tool_use",
          text: "",
          tool_call: toolBlock,
          timestamp: null,
        });
        pendingTools.set(tc.id ?? tc.call_id ?? "", toolBlock);
      }

      // Text content (non-tool-call assistant response)
      const content = (msg.content ?? "").trim();
      if (content) {
        currentBlocks.push({
          kind: "text",
          text: content,
          tool_call: null,
          timestamp: null,
        });
      }
      continue;
    }
  }

  finalizeTurn();

  return filterEmptyTurns(turns);
}