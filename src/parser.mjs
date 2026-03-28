/**
 * Parse Claude Code, Cursor, Codex CLI, and Gemini CLI transcripts into structured turns.
 */

import { readFileSync } from "node:fs";

/**
 * @typedef {{ tool_use_id: string, name: string, input: object, result: string|null, resultTimestamp: string|null, is_error: boolean }} ToolCall
 * @typedef {{ kind: string, text: string, tool_call: ToolCall|null, timestamp: string|null }} AssistantBlock
 * @typedef {{ index: number, user_text: string, blocks: AssistantBlock[], timestamp: string }} Turn
 */

/**
 * Extract plain text from user message content (string or block array).
 */
function cleanSystemTags(text) {
  // Replace <task-notification> blocks with a compact marker the renderer can style
  text = text.replace(/<task-notification>\s*<task-id>[^<]*<\/task-id>\s*<output-file>[^<]*<\/output-file>\s*<status>([^<]*)<\/status>\s*<summary>([^<]*)<\/summary>\s*<\/task-notification>/g,
    (_, status, summary) => `[bg-task: ${summary}]`);
  // Remove trailing "Read the output file..." lines that follow notifications
  text = text.replace(/\n*Read the output file to retrieve the result:[^\n]*/g, "");
  // Unwrap Cursor's <user_query> tags
  text = text.replace(/<user_query>([\s\S]*?)<\/user_query>\s*/g, (_, inner) => inner.trim());
  // Remove <system-reminder> blocks
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "");
  // Remove IDE context tags (VS Code extension)
  text = text.replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>\s*/g, "");
  // Remove internal caveat boilerplate (not useful to viewers)
  text = text.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>\s*/g, "");
  // Extract slash command name, keep as visible text
  text = text.replace(/<command-name>([\s\S]*?)<\/command-name>\s*/g, (_, name) => name.trim() + "\n");
  // Remove command-message (redundant with command-name) and empty args
  text = text.replace(/<command-message>[\s\S]*?<\/command-message>\s*/g, "");
  text = text.replace(/<command-args>\s*<\/command-args>\s*/g, "");
  // Keep non-empty command args
  text = text.replace(/<command-args>([\s\S]*?)<\/command-args>\s*/g, (_, args) => {
    const trimmed = args.trim();
    return trimmed ? trimmed + "\n" : "";
  });
  // Remove local command stdout (system output, not user text)
  text = text.replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>\s*/g, "");
  return text.trim();
}

function extractText(content) {
  if (typeof content === "string") return cleanSystemTags(content);
  const parts = [];
  for (const block of content) {
    if (block.type === "text") parts.push(block.text);
  }
  return cleanSystemTags(parts.join("\n"));
}

/**
 * Check if a user message contains only tool_result blocks.
 */
function isToolResultOnly(content) {
  if (typeof content === "string") return false;
  return content.every((b) => b.type === "tool_result");
}

/**
 * Detect transcript format by peeking at the first entry.
 * @param {string} filePath
 * @returns {"claude-code"|"cursor"|"codex"|"gemini"|"opencode"|"unknown"}
 */
export function detectFormat(filePath) {
  return detectFormatFromText(readFileSync(filePath, "utf-8"));
}

export function detectFormatFromText(text) {
  // Gemini CLI: single JSON object with sessionId + messages array
  const trimmedFull = text.trim();
  if (trimmedFull.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmedFull);
      if (obj.sessionId && Array.isArray(obj.messages)) return "gemini";
    } catch { /* not valid single-object JSON, fall through to JSONL */ }
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.user_text !== undefined && obj.blocks !== undefined) return "replay";
      if (obj.type === "session_meta") return "codex";
      // OpenCode: JSONL with step_start/step_finish/tool_use/text events + sessionID
      if (obj.sessionID && (obj.type === "step_start" || obj.type === "step_finish" || obj.type === "tool_use" || obj.type === "text" || obj.type === "reasoning" || obj.type === "error")) return "opencode";
      if (obj.type === "user" || obj.type === "assistant") return "claude-code";
      if (obj.role === "user" || obj.role === "assistant") return "cursor";
    } catch { continue; }
  }
  return "unknown";
}

/**
 * Read JSONL and return only user/assistant entries.
 * Returns { entries, format }.
 */
function parseJsonl(text) {
  const entries = [];
  let format = "unknown";
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
      if (format === "unknown") format = "claude-code";
      entries.push(obj);
    } else if (topType === undefined || topType === null) {
      // Cursor format: { role, message: { content } } — normalize to Claude Code shape
      const role = obj.message?.role ?? obj.role;
      if (role === "user" || role === "assistant") {
        if (format === "unknown") format = "cursor";
        entries.push({ type: role, message: { role, content: obj.message?.content ?? "" }, timestamp: obj.timestamp ?? null });
      }
    }
  }
  return { entries, format };
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

    const entryTs = entry.timestamp ?? null;
    const content = entry.message?.content ?? [];
    if (Array.isArray(content)) {
      for (const block of content) {
        const btype = block.type;
        if (btype === "text") {
          const text = (block.text ?? "").trim();
          if (!text || text === "No response requested.") continue;
          const key = `text:${text}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          blocks.push({ kind: "text", text, tool_call: null, timestamp: entryTs });
        } else if (btype === "thinking") {
          const text = (block.thinking ?? "").trim();
          if (!text) continue;
          const key = `thinking:${text}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          blocks.push({ kind: "thinking", text, tool_call: null, timestamp: entryTs });
        } else if (btype === "tool_use") {
          const toolId = block.id ?? "";
          const key = `tool_use:${toolId}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          blocks.push({
            kind: "tool_use",
            text: "",
            tool_call: {
              tool_use_id: toolId,
              name: block.name ?? "",
              input: block.input ?? {},
              result: null,
              resultTimestamp: null,
              is_error: false,
            },
            timestamp: entryTs,
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
              // Strip <tool_use_error> wrapper if present
              resultText = resultText.replace(/^<tool_use_error>([\s\S]*)<\/tool_use_error>$/, "$1");
              pending.get(tid).result = resultText;
              pending.get(tid).resultTimestamp = entry.timestamp ?? null;
              pending.get(tid).is_error = !!block.is_error;
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
 * Parse a Codex apply_patch string into Edit/Write-compatible input.
 * Patch format:
 *   *** Begin Patch
 *   *** Add File: /path        → Write (new file)
 *   *** Update File: /path     → Edit (modify)
 *   +added line / -removed line / @@context@@
 *   *** End Patch
 */
function parseCodexPatch(patchStr) {
  const lines = patchStr.split("\n");
  // Remove trailing empty string from final newline in patch text
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  let filePath = "";
  let isNew = false;
  const oldLines = [];
  const newLines = [];

  for (const line of lines) {
    if (line.startsWith("*** Begin Patch") || line.startsWith("*** End Patch")) continue;
    if (line.startsWith("*** Add File:")) {
      filePath = line.replace("*** Add File:", "").trim();
      isNew = true;
      continue;
    }
    if (line.startsWith("*** Update File:")) {
      filePath = line.replace("*** Update File:", "").trim();
      isNew = false;
      continue;
    }
    if (line.startsWith("@@")) continue; // context marker
    if (line.startsWith("+")) {
      newLines.push(line.slice(1));
    } else if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
    } else {
      // Context line (unchanged, may be blank) — appears in both old and new
      oldLines.push(line);
      newLines.push(line);
    }
  }

  if (isNew) {
    return { file_path: filePath, content: newLines.join("\n"), isNew: true };
  }
  return {
    file_path: filePath,
    old_string: oldLines.join("\n"),
    new_string: newLines.join("\n"),
    isNew: false,
  };
}

/**
 * Extract the actual user request from Codex user messages.
 * Codex prepends IDE context, environment, permissions, and skills;
 * the real user text follows "## My request for Codex:".
 */
function extractCodexUserText(text) {
  const marker = "## My request for Codex:";
  const idx = text.indexOf(marker);
  if (idx !== -1) return text.slice(idx + marker.length).trim();
  // Also try "## My request for Codex" without colon
  const marker2 = "## My request for Codex";
  const idx2 = text.indexOf(marker2);
  if (idx2 !== -1) {
    const after = text.slice(idx2 + marker2.length);
    // Skip optional colon and newline
    return after.replace(/^:?\s*/, "").trim();
  }
  return text.trim();
}

/**
 * Map Gemini CLI tool names to their claude-replay equivalents.
 */
const GEMINI_TOOL_MAP = {
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
 * Gemini stores results as: [{ functionResponse: { response: { output, error } } }]
 */
function extractGeminiToolResult(result) {
  if (!result) return null;
  if (typeof result === "string") return result;
  if (!Array.isArray(result) || result.length === 0) return null;
  const fr = result[0]?.functionResponse;
  if (!fr) return null;
  const resp = fr.response;
  if (!resp) return null;
  const output = resp.output ?? "";
  const error = resp.error ?? "";
  // Prefer error text if output is empty and error is meaningful
  if (!output && error && error !== "(none)") return error;
  return output || null;
}

/**
 * Parse a Gemini CLI JSON session into Turn[].
 * Gemini stores sessions as a single JSON object with a messages array,
 * unlike the JSONL format used by Claude Code, Cursor, and Codex.
 */
function parseGeminiTranscript(text) {
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
  }

  for (const msg of data.messages) {
    const type = msg.type;
    const ts = msg.timestamp ?? null;

    if (type === "user") {
      // Start a new turn — finalize previous if any
      finalizeTurn();
      currentUserText = cleanSystemTags(msg.content ?? "");
      currentTimestamp = ts ?? "";
      continue;
    }

    if (type === "gemini") {
      // Thoughts → thinking blocks
      const thoughts = msg.thoughts ?? [];
      for (const thought of thoughts) {
        const subject = (thought.subject ?? "").trim();
        const description = (thought.description ?? "").trim();
        if (!description && !subject) continue;
        const thinkText = subject ? `${subject}: ${description}` : description;
        currentBlocks.push({ kind: "thinking", text: thinkText, tool_call: null, timestamp: thought.timestamp ?? ts });
      }

      // Tool calls → tool_use blocks
      const toolCalls = msg.toolCalls ?? [];
      for (const tc of toolCalls) {
        const rawName = tc.name ?? "unknown";
        const mappedName = GEMINI_TOOL_MAP[rawName] ?? rawName;
        const input = tc.args ?? {};
        // For Bash-mapped tools, normalize args.command
        const normalizedInput = mappedName === "Bash" && input.command ? { command: input.command } : input;
        const resultText = extractGeminiToolResult(tc.result);
        const isError = tc.status === "error" ||
          (tc.result?.[0]?.functionResponse?.response?.exitCode != null &&
           tc.result[0].functionResponse.response.exitCode !== 0);
        currentBlocks.push({
          kind: "tool_use",
          text: "",
          tool_call: {
            tool_use_id: tc.id ?? "",
            name: mappedName,
            input: normalizedInput,
            result: resultText,
            resultTimestamp: tc.timestamp ?? null,
            is_error: isError,
          },
          timestamp: ts,
        });
      }

      // Content → text block
      const content = (msg.content ?? "").trim();
      if (content) {
        currentBlocks.push({ kind: "text", text: content, tool_call: null, timestamp: ts });
      }
      continue;
    }

    // Skip unknown message types
  }

  // Finalize last turn
  finalizeTurn();

  // Drop empty turns and re-index
  const filtered = turns.filter((t) => {
    if (t.user_text) return true;
    return t.blocks.some((b) => b.kind === "tool_use" || (b.kind === "text" && b.text) || (b.kind === "thinking" && b.text));
  });
  for (let j = 0; j < filtered.length; j++) {
    filtered[j].index = j + 1;
  }
  return filtered;
}

/**
 * Map OpenCode tool names to their claude-replay equivalents.
 */
const OPENCODE_TOOL_MAP = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  patch: "Edit",
  glob: "Glob",
  grep: "Grep",
  ls: "Glob",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  codesearch: "Grep",
  task: "Task",
  todo: "TodoWrite",
};

/**
 * Parse an OpenCode JSONL transcript into Turn[].
 * OpenCode uses step_start/step_finish boundaries with tool_use and text events.
 * Each step (message) is grouped into turns by messageID changes.
 */
function parseOpenCodeTranscript(text) {
  const events = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { events.push(JSON.parse(trimmed)); } catch { continue; }
  }

  // Group events into steps by messageID sequences.
  // A "turn" in replay terms maps to a complete agent response cycle
  // (potentially multiple steps: tool calls then final text).
  const turns = [];
  let turnIndex = 0;
  let currentBlocks = [];
  let currentTimestamp = "";
  let lastMessageID = null;

  function finalizeTurn() {
    if (currentBlocks.length === 0) return;
    turnIndex++;
    turns.push({
      index: turnIndex,
      user_text: "",
      blocks: currentBlocks,
      timestamp: currentTimestamp,
    });
    currentBlocks = [];
    currentTimestamp = "";
  }

  for (const evt of events) {
    const type = evt.type;
    const part = evt.part ?? {};
    const ts = evt.timestamp ? new Date(evt.timestamp).toISOString() : null;

    if (type === "step_start") {
      const msgID = part.messageID ?? null;
      // New messageID means new step — but consecutive tool-call steps
      // followed by a text step form one logical turn, so we only split
      // when the previous step ended with reason "stop".
      if (!currentTimestamp && ts) currentTimestamp = ts;
      lastMessageID = msgID;
      continue;
    }

    if (type === "tool_use") {
      const rawName = part.tool ?? "unknown";
      const mappedName = OPENCODE_TOOL_MAP[rawName] ?? rawName;
      const state = part.state ?? {};
      const input = state.input ?? {};
      const output = state.output ?? "";
      const isError = state.status === "error" ||
        (state.metadata?.exit != null && state.metadata.exit !== 0);
      const resultTs = state.time?.end ? new Date(state.time.end).toISOString() : null;

      // Normalize tool inputs for consistent rendering
      let normalizedInput = input;
      if (mappedName === "Bash" && input.command) {
        normalizedInput = input.workdir
          ? { command: `cd ${input.workdir} && ${input.command}` }
          : { command: input.command };
      } else if (mappedName === "Write" && input.filePath) {
        normalizedInput = { file_path: input.filePath, content: input.content ?? "" };
      } else if (mappedName === "Read" && input.filePath) {
        normalizedInput = { file_path: input.filePath };
      } else if (mappedName === "Edit" && input.filePath) {
        normalizedInput = { file_path: input.filePath, ...input };
      }

      currentBlocks.push({
        kind: "tool_use",
        text: "",
        tool_call: {
          tool_use_id: part.callID ?? "",
          name: mappedName,
          input: normalizedInput,
          result: typeof output === "string" ? output : JSON.stringify(output),
          resultTimestamp: resultTs,
          is_error: isError,
        },
        timestamp: ts,
      });
      continue;
    }

    if (type === "reasoning") {
      const content = (part.text ?? "").trim();
      if (content) {
        currentBlocks.push({ kind: "thinking", text: content, tool_call: null, timestamp: ts });
      }
      continue;
    }

    if (type === "text") {
      const content = (part.text ?? "").trim();
      if (content) {
        currentBlocks.push({ kind: "text", text: content, tool_call: null, timestamp: ts });
      }
      continue;
    }

    if (type === "step_finish") {
      const reason = part.reason ?? "";
      // "stop" means the agent finished responding — finalize the turn
      if (reason === "stop") {
        finalizeTurn();
      }
      // "tool-calls" means more steps follow in this turn — keep accumulating
      continue;
    }

    if (type === "error") {
      const errData = evt.error ?? {};
      const errMsg = errData.data?.message ?? errData.name ?? "Unknown error";
      currentBlocks.push({ kind: "text", text: `Error: ${errMsg}`, tool_call: null, timestamp: ts });
      finalizeTurn();
      continue;
    }
  }

  // Capture any remaining blocks (session ended without step_finish reason=stop)
  finalizeTurn();

  // Re-index
  for (let j = 0; j < turns.length; j++) {
    turns[j].index = j + 1;
  }
  return turns;
}

/**
 * Parse a Codex CLI JSONL transcript into Turn[].
 */
/**
 * Parse a replay JSONL file (output of `claude-replay extract`).
 * Each line is a turn object with { index, user_text, blocks, timestamp }.
 * An optional final line with { type: "bookmarks" } contains bookmarks.
 */
function parseReplayJsonl(text) {
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

/**
 * Codex uses an event-based format with task_started/task_complete boundaries.
 */
function parseCodexTranscript(text) {
  const events = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { events.push(JSON.parse(trimmed)); } catch { continue; }
  }

  const turns = [];
  let turnIndex = 0;
  let currentUserText = "";
  let currentTimestamp = "";
  let currentBlocks = [];
  // Map call_id → tool_call ref for attaching results
  let pendingCalls = new Map();
  let inTurn = false;

  for (const evt of events) {
    const type = evt.type;
    const payload = evt.payload ?? {};
    const ts = evt.timestamp ?? null;

    if (type === "event_msg" && payload.type === "task_started") {
      // Start a new turn
      inTurn = true;
      currentUserText = "";
      currentTimestamp = ts ?? "";
      currentBlocks = [];
      pendingCalls = new Map();
      continue;
    }

    if (type === "event_msg" && payload.type === "task_complete") {
      // Finalize the turn
      if (inTurn) {
        turnIndex++;
        turns.push({
          index: turnIndex,
          user_text: currentUserText,
          blocks: currentBlocks,
          timestamp: currentTimestamp,
        });
      }
      inTurn = false;
      continue;
    }

    if (!inTurn) continue;

    if (type === "event_msg" && payload.type === "user_message") {
      // The user_message event has the actual user text
      const msg = payload.message ?? "";
      currentUserText = extractCodexUserText(msg);
      if (ts) currentTimestamp = ts;
      continue;
    }

    if (type === "response_item") {
      const ptype = payload.type;
      const role = payload.role ?? "";
      const phase = payload.phase ?? "";

      // User message as response_item — use as fallback if event_msg didn't fire
      if (ptype === "message" && role === "user") {
        const content = payload.content ?? [];
        if (Array.isArray(content)) {
          const textParts = content.filter((b) => b.type === "input_text").map((b) => b.text ?? "");
          const raw = textParts.join("\n");
          const extracted = extractCodexUserText(raw);
          if (extracted && !currentUserText) currentUserText = extracted;
        }
        continue;
      }

      // Skip developer messages (system prompts, permissions, etc.)
      if (ptype === "message" && role === "developer") continue;

      // Assistant text: commentary = thinking, final_answer = text
      if (ptype === "message" && role === "assistant") {
        const content = payload.content ?? [];
        const textParts = [];
        if (Array.isArray(content)) {
          for (const b of content) {
            if (b.type === "output_text") textParts.push(b.text ?? "");
          }
        }
        const blockText = textParts.join("\n").trim();
        if (!blockText) continue;
        const kind = phase === "commentary" ? "thinking" : "text";
        currentBlocks.push({ kind, text: blockText, tool_call: null, timestamp: ts });
        continue;
      }

      // Encrypted reasoning — skip (OpenAI encrypts chain-of-thought)
      if (ptype === "reasoning") continue;

      // exec_command tool call
      if (ptype === "function_call") {
        const callId = payload.call_id ?? "";
        const name = payload.name ?? "unknown";
        let input = {};
        try { input = JSON.parse(payload.arguments ?? "{}"); } catch { input = { raw: payload.arguments }; }
        // Normalize exec_command → Bash: map cmd → command
        if (name === "exec_command" && input.cmd) {
          const cmd = input.workdir ? `cd ${input.workdir} && ${input.cmd}` : input.cmd;
          input = { command: cmd };
        }
        const toolCall = {
          tool_use_id: callId,
          name: name === "exec_command" ? "Bash" : name,
          input,
          result: null,
          resultTimestamp: null,
          is_error: false,
        };
        currentBlocks.push({ kind: "tool_use", text: "", tool_call: toolCall, timestamp: ts });
        pendingCalls.set(callId, toolCall);
        continue;
      }

      // exec_command result
      if (ptype === "function_call_output") {
        const callId = payload.call_id ?? "";
        const output = payload.output ?? "";
        // Strip Codex metadata prefix (Chunk ID, Wall time, Process exited)
        const cleaned = output.replace(/^Chunk ID:.*\n?/m, "")
          .replace(/^Wall time:.*\n?/m, "")
          .replace(/^Process exited with code \d+\n?/m, "")
          .replace(/^Original token count:.*\n?/m, "")
          .replace(/^Output:\n?/m, "")
          .trim();
        if (pendingCalls.has(callId)) {
          const tc = pendingCalls.get(callId);
          tc.result = cleaned;
          tc.resultTimestamp = ts;
          tc.is_error = output.includes("Process exited with code") && !output.includes("code 0");
          pendingCalls.delete(callId);
        }
        continue;
      }

      // apply_patch / other custom tool calls
      if (ptype === "custom_tool_call") {
        const callId = payload.call_id ?? "";
        const name = payload.name ?? "unknown";
        let mappedName = name;
        let input;
        if (name === "apply_patch") {
          const parsed = parseCodexPatch(payload.input ?? "");
          mappedName = parsed.isNew ? "Write" : "Edit";
          input = parsed;
        } else {
          input = { raw: payload.input ?? "" };
        }
        const toolCall = {
          tool_use_id: callId,
          name: mappedName,
          input,
          result: null,
          resultTimestamp: null,
          is_error: false,
        };
        currentBlocks.push({ kind: "tool_use", text: "", tool_call: toolCall, timestamp: ts });
        pendingCalls.set(callId, toolCall);
        continue;
      }

      // custom tool call result
      if (ptype === "custom_tool_call_output") {
        const callId = payload.call_id ?? "";
        let output = "";
        if (typeof payload.output === "string") {
          output = payload.output;
        } else if (payload.output?.output) {
          output = payload.output.output;
        }
        if (pendingCalls.has(callId)) {
          const tc = pendingCalls.get(callId);
          tc.result = output.trim();
          tc.resultTimestamp = ts;
          tc.is_error = typeof payload.output === "object" && payload.output?.metadata?.exit_code !== 0;
          pendingCalls.delete(callId);
        }
        continue;
      }
    }
  }

  // Handle case where session ends without task_complete
  if (inTurn && (currentUserText || currentBlocks.length)) {
    turnIndex++;
    turns.push({
      index: turnIndex,
      user_text: currentUserText,
      blocks: currentBlocks,
      timestamp: currentTimestamp,
    });
  }

  // Drop empty turns and re-index
  const filtered = turns.filter((t) => {
    if (t.user_text) return true;
    return t.blocks.some((b) => b.kind === "tool_use" || (b.kind === "text" && b.text) || (b.kind === "thinking" && b.text));
  });
  for (let j = 0; j < filtered.length; j++) {
    filtered[j].index = j + 1;
  }
  return filtered;
}

/**
 * Parse a JSONL transcript into a list of Turns.
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
  const format = detectFormatFromText(text);
  if (format === "gemini") return parseGeminiTranscript(text);
  if (format === "opencode") return parseOpenCodeTranscript(text);
  if (format === "codex") return parseCodexTranscript(text);
  if (format === "replay") return parseReplayJsonl(text);
  const { entries, format: fmt } = parseJsonl(text);
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
      let userText = extractText(content);
      const timestamp = entry.timestamp ?? "";
      i++;

      // Absorb consecutive non-tool-result user messages into the same turn
      // (e.g. CLI command sequences: caveat + /exit + stdout)
      while (i < entries.length) {
        const next = entries[i];
        const nextRole = next.message?.role ?? next.type;
        if (nextRole !== "user") break;
        const nextContent = next.message?.content ?? "";
        if (isToolResultOnly(nextContent)) break;
        const nextText = extractText(nextContent);
        if (nextText) userText = userText ? userText + "\n" + nextText : nextText;
        i++;
      }

      // Extract system events (bg-task notifications) from user text
      const systemEvents = [];
      userText = userText.replace(/\[bg-task:\s*(.+)\]/g, (_, summary) => {
        systemEvents.push(summary);
        return "";
      });
      userText = userText.trim();

      const [assistantBlocks, nextI] = collectAssistantBlocks(entries, i);
      i = nextI;
      i = attachToolResults(assistantBlocks, entries, i);

      turnIndex++;
      const turn = {
        index: turnIndex,
        user_text: userText,
        blocks: assistantBlocks,
        timestamp,
      };
      if (systemEvents.length) turn.system_events = systemEvents;
      turns.push(turn);
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

  // Drop empty turns (e.g. slash commands that produce no visible content)
  const filtered = turns.filter((t) => {
    if (t.user_text) return true;
    if (t.system_events?.length) return true;
    // Keep if there are meaningful assistant blocks
    return t.blocks.some((b) => {
      if (b.kind === "tool_use") return true;
      if (b.kind === "text" && b.text && b.text !== "No response requested.") return true;
      if (b.kind === "thinking" && b.text) return true;
      return false;
    });
  });
  // Re-index after filtering
  for (let j = 0; j < filtered.length; j++) {
    filtered[j].index = j + 1;
  }

  // Cursor: all assistant blocks except the last per turn are thinking
  if (fmt === "cursor") {
    for (const turn of filtered) {
      for (let j = 0; j < turn.blocks.length - 1; j++) {
        if (turn.blocks[j].kind === "text") {
          turn.blocks[j].kind = "thinking";
        }
      }
    }
  }

  return filtered;
}

/**
 * Replace timestamps with synthetic pacing based on content length.
 * Drives presentation timing, not historical accuracy.
 * @param {Turn[]} turns
 */
export function applyPacedTiming(turns) {
  let cursor = 0; // ms from epoch
  for (const turn of turns) {
    turn.timestamp = new Date(cursor).toISOString();
    cursor += 500; // brief pause before assistant responds
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
