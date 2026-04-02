/**
 * Gemini CLI format parser.
 *
 * Format: Single JSON object with { sessionId, messages[] }
 * Messages have type "user" or "gemini" with thoughts, toolCalls, and content.
 */

import { cleanSystemTags, filterEmptyTurns } from "./shared.mjs";

export const name = "gemini";

/**
 * Detect if text is Gemini format (single JSON with sessionId + messages).
 * This is checked before JSONL parsing since Gemini uses a single JSON object.
 */
export function detectFromText(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const obj = JSON.parse(trimmed);
    return !!(obj.sessionId && Array.isArray(obj.messages));
  } catch { return false; }
}

/**
 * Not used for JSONL-based detection — Gemini uses detectFromText instead.
 */
export function detect() {
  return false;
}

const TOOL_MAP = {
  run_shell_command: "Bash",
  shell: "Bash",
  read_file: "Read",
  read_many_files: "Read",
  edit_file: "Edit",
  write_file: "Write",
  write_to_file: "Write",
  list_directory: "Glob",
  search_files: "Grep",
  grep_search: "Grep",
  web_search: "WebSearch",
  web_fetch: "WebFetch",
  complete_task: "complete_task",
};

/**
 * Extract tool result text from Gemini's nested result structure.
 */
function extractToolResult(result) {
  if (!result) return null;
  if (typeof result === "string") return result;
  if (!Array.isArray(result) || result.length === 0) return null;
  const fr = result[0]?.functionResponse;
  if (!fr) return null;
  const resp = fr.response;
  if (!resp) return null;
  const output = resp.output ?? "";
  const error = resp.error ?? "";
  if (!output && error && error !== "(none)") return error;
  return output || null;
}

/**
 * Parse Gemini CLI JSON text into Turn[].
 */
export function parse(text) {
  let data;
  try { data = JSON.parse(text); } catch { return []; }
  if (!data.messages || !Array.isArray(data.messages)) return [];

  const turns = [];
  let turnIndex = 0;
  let currentUserText = "";
  let currentTimestamp = "";
  let currentBlocks = [];

  function finalizeTurn() {
    if (!currentUserText && currentBlocks.length === 0) return;
    turnIndex++;
    turns.push({ index: turnIndex, user_text: currentUserText, blocks: currentBlocks, timestamp: currentTimestamp });
    currentUserText = "";
    currentTimestamp = "";
    currentBlocks = [];
  }

  for (const msg of data.messages) {
    const type = msg.type;
    const ts = msg.timestamp ?? null;

    if (type === "user") {
      finalizeTurn();
      currentUserText = cleanSystemTags(msg.content ?? "");
      currentTimestamp = ts ?? "";
      continue;
    }

    if (type === "gemini") {
      const thoughts = msg.thoughts ?? [];
      for (const thought of thoughts) {
        const subject = (thought.subject ?? "").trim();
        const description = (thought.description ?? "").trim();
        if (!description && !subject) continue;
        const thinkText = subject ? `${subject}: ${description}` : description;
        currentBlocks.push({ kind: "thinking", text: thinkText, tool_call: null, timestamp: thought.timestamp ?? ts });
      }

      const toolCalls = msg.toolCalls ?? [];
      for (const tc of toolCalls) {
        const rawName = tc.name ?? "unknown";
        const mappedName = TOOL_MAP[rawName] ?? rawName;
        const input = tc.args ?? {};
        const normalizedInput = mappedName === "Bash" && input.command ? { command: input.command } : input;
        const resultText = extractToolResult(tc.result);
        const isError = tc.status === "error" ||
          (tc.result?.[0]?.functionResponse?.response?.exitCode != null &&
           tc.result[0].functionResponse.response.exitCode !== 0);
        currentBlocks.push({
          kind: "tool_use", text: "",
          tool_call: {
            tool_use_id: tc.id ?? "", name: mappedName, input: normalizedInput,
            result: resultText, resultTimestamp: tc.timestamp ?? null, is_error: isError,
          },
          timestamp: ts,
        });
      }

      const content = (msg.content ?? "").trim();
      if (content) {
        currentBlocks.push({ kind: "text", text: content, tool_call: null, timestamp: ts });
      }
      continue;
    }
  }

  finalizeTurn();

  return filterEmptyTurns(turns);
}
