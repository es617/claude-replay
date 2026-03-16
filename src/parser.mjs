/**
 * Parse Claude Code, Cursor, Codex CLI, and GitHub Chat JSONL transcripts into structured turns.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
 * @returns {"claude-code"|"cursor"|"codex"|"github-chat"|"unknown"}
 */
export function detectFormat(filePath) {
  return detectFormatFromText(readFileSync(filePath, "utf-8"));
}

function detectFormatFromText(text) {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj.type === "session_meta") return "codex";
      if (isGitHubChatPatchEvent(obj)) return "github-chat";
      if (isGitHubChatEvent(obj)) return "github-chat";
      if (obj.type === "user" || obj.type === "assistant") return "claude-code";
      if (obj.role === "user" || obj.role === "assistant") return "cursor";
    } catch { continue; }
  }
  return "unknown";
}

function isGitHubChatPatchEvent(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  if (obj.kind === 0) return !!obj.v && typeof obj.v === "object";
  if ((obj.kind === 1 || obj.kind === 2) && Array.isArray(obj.k)) return true;
  return false;
}

function isGitHubChatEvent(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;

  if (obj.type === "tool_use") {
    return typeof obj.id === "string" && typeof obj.name === "string" && obj.input && typeof obj.input === "object";
  }

  if (obj.type === "tool_result") {
    return typeof obj.tool_use_id === "string" && "content" in obj;
  }

  if (obj.type === "assistant") {
    return Array.isArray(obj.content)
      && obj.content.every((part) => part && typeof part === "object" && !Array.isArray(part)
        && ((part.type === "text" && typeof part.text === "string")
          || (part.type === "thinking" && typeof part.thinking === "string")));
  }

  if (obj.type === "user") {
    return typeof obj.content === "string"
      || (Array.isArray(obj.content)
        && obj.content.every((part) => part && typeof part === "object" && !Array.isArray(part) && typeof part.text === "string"));
  }

  if (obj.type === "meta") return true;

  return false;
}

function extractGitHubChatText(content) {
  if (typeof content === "string") return cleanSystemTags(content);
  if (!Array.isArray(content)) return "";
  return cleanSystemTags(content.map((part) => part?.text ?? "").filter(Boolean).join("\n"));
}

function extractGitHubChatResultText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .filter((part) => part?.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

function finalizeGitHubChatTurns(turns) {
  const filtered = turns.filter((t) => {
    if (t.user_text) return true;
    return t.blocks.some((b) => {
      if (b.kind === "tool_use") return true;
      return !!(b.text && b.text.trim());
    });
  });
  for (let i = 0; i < filtered.length; i++) {
    filtered[i].index = i + 1;
  }
  return filtered;
}

function parseGitHubChatTranscript(filePath) {
  const text = readFileSync(filePath, "utf-8");
  const events = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (!isGitHubChatEvent(obj) && !isGitHubChatPatchEvent(obj)) continue;
      events.push(obj);
    } catch {
      continue;
    }
  }

  if (events.some(isGitHubChatPatchEvent)) {
    return parseGitHubChatPatchLogEvents(events);
  }

  const turns = [];
  let currentTurn = null;
  let pendingToolCalls = new Map();

  const ensureTurn = (timestamp = "") => {
    if (currentTurn) return currentTurn;
    currentTurn = {
      index: turns.length + 1,
      user_text: "",
      blocks: [],
      timestamp: timestamp || "",
    };
    turns.push(currentTurn);
    return currentTurn;
  };

  for (const evt of events) {
    const ts = evt.timestamp ?? "";

    if (evt.type === "meta") continue;

    if (evt.type === "user") {
      const userText = extractGitHubChatText(evt.content);
      if (currentTurn && !currentTurn.user_text && currentTurn.blocks.length === 0) {
        currentTurn.user_text = userText;
        currentTurn.timestamp = currentTurn.timestamp || ts;
      } else {
        currentTurn = {
          index: turns.length + 1,
          user_text: userText,
          blocks: [],
          timestamp: ts || "",
        };
        turns.push(currentTurn);
      }
      pendingToolCalls = new Map();
      continue;
    }

    if (evt.type === "assistant") {
      const turn = ensureTurn(ts);
      if (!turn.timestamp) turn.timestamp = ts;
      const content = Array.isArray(evt.content) ? evt.content : [];
      for (const block of content) {
        if (block.type === "text") {
          const text = (block.text ?? "").trim();
          if (!text) continue;
          turn.blocks.push({ kind: "text", text, tool_call: null, timestamp: ts || null });
        } else if (block.type === "thinking") {
          const thinking = (block.thinking ?? "").trim();
          if (!thinking) continue;
          turn.blocks.push({ kind: "thinking", text: thinking, tool_call: null, timestamp: ts || null });
        }
      }
      continue;
    }

    if (evt.type === "tool_use") {
      const turn = ensureTurn(ts);
      if (!turn.timestamp) turn.timestamp = ts;
      const toolCall = {
        tool_use_id: evt.id ?? "",
        name: evt.name ?? "",
        input: evt.input ?? {},
        result: null,
        resultTimestamp: null,
        is_error: false,
      };
      turn.blocks.push({ kind: "tool_use", text: "", tool_call: toolCall, timestamp: ts || null });
      pendingToolCalls.set(toolCall.tool_use_id, toolCall);
      continue;
    }

    if (evt.type === "tool_result") {
      const toolCall = pendingToolCalls.get(evt.tool_use_id ?? "");
      if (!toolCall) continue;
      toolCall.result = extractGitHubChatResultText(evt.content);
      toolCall.resultTimestamp = ts || null;
      toolCall.is_error = !!evt.is_error;
      pendingToolCalls.delete(evt.tool_use_id ?? "");
    }
  }

  return finalizeGitHubChatTurns(turns);
}

function getAtPath(root, path) {
  let cur = root;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = cur[key];
  }
  return cur;
}

function setAtPath(root, path, value) {
  if (!Array.isArray(path) || path.length === 0) return;
  let cur = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const nextKey = path[i + 1];
    if (cur[key] == null || typeof cur[key] !== "object") {
      cur[key] = typeof nextKey === "number" ? [] : {};
    }
    cur = cur[key];
  }
  cur[path[path.length - 1]] = value;
}

function appendAtPath(root, path, values) {
  if (!Array.isArray(path) || path.length === 0) return;
  let target = getAtPath(root, path);
  if (!Array.isArray(target)) {
    setAtPath(root, path, []);
    target = getAtPath(root, path);
  }
  if (!Array.isArray(target)) return;
  if (Array.isArray(values)) target.push(...values);
  else target.push(values);
}

function normalizeTimestamp(value) {
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value;
    return new Date(parsed).toISOString();
  }
  return "";
}

function extractCopilotTextMessage(maybeMessage) {
  if (typeof maybeMessage === "string") return cleanSystemTags(maybeMessage);
  if (!maybeMessage || typeof maybeMessage !== "object") return "";
  if (typeof maybeMessage.text === "string") return cleanSystemTags(maybeMessage.text);
  if (Array.isArray(maybeMessage.parts)) {
    const text = maybeMessage.parts
      .map((part) => extractCopilotItemText(part))
      .filter(Boolean)
      .join("");
    return cleanSystemTags(text);
  }
  return "";
}

function extractCopilotInlineReferenceText(ref) {
  if (!ref || typeof ref !== "object") return "";

  const name = typeof ref.name === "string" ? ref.name.trim() : "";
  if (name) return `\`${name}\``;

  const uriCandidate = ref.location?.uri ?? ref;
  const external = typeof uriCandidate?.external === "string" ? uriCandidate.external : "";
  if (external.startsWith("file://")) {
    return `[](${external})`;
  }

  const uri = typeof uriCandidate?.toString === "function" ? String(uriCandidate) : "";
  if (uri.startsWith("file://")) {
    return `[](${uri})`;
  }

  const filePath = typeof uriCandidate?.fsPath === "string"
    ? uriCandidate.fsPath
    : typeof ref.fsPath === "string"
      ? ref.fsPath
      : "";
  if (filePath) return `\`${filePath}\``;

  return "";
}

function isMeaninglessFenceText(text) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^(?:```[\w-]*\s*)+$/.test(trimmed);
}

function stripMeaninglessFenceArtifacts(text) {
  if (typeof text !== "string" || !text) return "";

  const emptyFenceBlockPattern = /(?:^|\n)```[\w-]*\s*\n(?:[ \t]*\n)*```[ \t]*/g;
  return text.replace(emptyFenceBlockPattern, (match, offset) => (offset === 0 ? "" : "\n"));
}

function extractCopilotItemText(item) {
  if (!item || typeof item !== "object") return "";
  if (item.kind === "inlineReference") {
    return extractCopilotInlineReferenceText(item.inlineReference);
  }
  if (typeof item.value === "string") return item.value;
  if (item.value && typeof item.value === "object" && typeof item.value.value === "string") {
    return item.value.value;
  }
  return "";
}

function extractCopilotToolMessage(messageObj) {
  if (!messageObj) return "";
  if (typeof messageObj === "string") return messageObj;
  if (typeof messageObj.value === "string") return messageObj.value;
  return "";
}

function toPathFromFileUri(uri) {
  if (!uri || typeof uri !== "string") return "";
  try {
    return fileURLToPath(uri);
  } catch {
    try {
      return decodeURIComponent(uri.replace(/^file:\/\//i, ""));
    } catch {
      return uri;
    }
  }
}

function extractFilePathFromMessageText(text) {
  if (!text) return "";

  const uriMatch = text.match(/\((file:\/\/[^)\s]+)\)/i);
  if (uriMatch) return toPathFromFileUri(uriMatch[1]);

  const backtickMatch = text.match(/`([^`]+)`/);
  if (backtickMatch?.[1]) return backtickMatch[1].trim();

  const verbMatch = text.match(/^(?:Reading|Read|Creating|Created|Writing|Wrote|Editing|Edited|Applying(?: patch)? to|Opening|Opened)\s+(.+)$/i);
  if (verbMatch?.[1]) return verbMatch[1].trim();

  return "";
}

function extractCommandFromMessageText(text) {
  if (!text) return "";

  const backtickMatch = text.match(/`([^`]+)`/);
  if (backtickMatch?.[1]) return backtickMatch[1].trim();

  const cmdMatch = text.match(/^(?:Running|Run|Executing|Executed|Ran)\s+(?:command\s*)?(.+)$/i);
  if (cmdMatch?.[1]) return cmdMatch[1].trim();

  return "";
}

function extractCopilotInvocationDetails(toolName, invocationObj, pastObj) {
  const invocationText = extractCopilotToolMessage(invocationObj);
  const pastText = extractCopilotToolMessage(pastObj);

  const uriKeys = invocationObj && typeof invocationObj === "object" && invocationObj.uris && typeof invocationObj.uris === "object"
    ? Object.keys(invocationObj.uris)
    : [];
  const firstUri = uriKeys.find((u) => typeof u === "string" && u.startsWith("file://")) || "";

  let filePath = firstUri ? toPathFromFileUri(firstUri) : "";
  if (!filePath) filePath = extractFilePathFromMessageText(invocationText) || extractFilePathFromMessageText(pastText);

  const command = toolName === "Bash"
    ? (extractCommandFromMessageText(invocationText) || extractCommandFromMessageText(pastText))
    : "";

  return { invocationText, pastText, filePath, command, uri: firstUri };
}

function extractCopilotToolSpecificInput(toolSpecificData) {
  if (!toolSpecificData || typeof toolSpecificData !== "object") return {};

  const kind = String(toolSpecificData.kind || "").toLowerCase();

  if (kind === "terminal") {
    const command =
      toolSpecificData.commandLine?.original
      || toolSpecificData.commandLine?.toolEdited
      || toolSpecificData.confirmation?.commandLine
      || toolSpecificData.presentationOverrides?.commandLine
      || "";

    const cwd =
      toolSpecificData.cwd?.fsPath
      || toolSpecificData.cwd?.path
      || "";

    return {
      command,
      cwd,
      language: toolSpecificData.language || "",
      is_background: !!toolSpecificData.isBackground,
    };
  }

  if (kind === "todolist") {
    const list = Array.isArray(toolSpecificData.todoList) ? toolSpecificData.todoList : [];
    const todoSummary = list
      .slice(0, 8)
      .map((t) => `${t.status || "?"}: ${t.title || t.id || ""}`)
      .join(" | ");

    return {
      todo_list: list,
      todo_summary: todoSummary,
    };
  }

  return {};
}

function mapCopilotToolName(toolId = "", invocationText = "") {
  const id = String(toolId || "").toLowerCase();
  const inv = String(invocationText || "").toLowerCase();

  if (id.includes("readfile") || inv.startsWith("reading ")) return "Read";
  if (id.includes("createfile") || inv.startsWith("creating ")) return "Write";
  if (id.includes("applypatch") || inv.includes("generating patch") || inv.includes("apply patch")) return "Edit";
  if (id.includes("run_in_terminal") || id.includes("terminal") || inv.includes("running command")) return "Bash";
  if (id.includes("findfiles") || id.includes("findtextinfiles") || inv.includes("searching for")) return "Grep";

  if (toolId) return toolId;
  return "Tool";
}

function parseGitHubChatPatchLogEvents(events) {
  let state = {};

  for (const evt of events) {
    if (!isGitHubChatPatchEvent(evt)) continue;
    if (evt.kind === 0) {
      state = evt.v && typeof evt.v === "object" ? evt.v : {};
      continue;
    }
    if (evt.kind === 1) {
      setAtPath(state, evt.k, evt.v);
      continue;
    }
    if (evt.kind === 2) {
      appendAtPath(state, evt.k, evt.v);
    }
  }

  const requests = Array.isArray(state.requests) ? state.requests : [];
  const turns = [];

  for (const req of requests) {
    const userText = extractCopilotTextMessage(req?.message);
    const timestamp = normalizeTimestamp(req?.timestamp);
    const blocks = [];
    const responseItems = Array.isArray(req?.response) ? req.response : [];
    let pendingText = "";

    const flushPendingText = () => {
      const text = stripMeaninglessFenceArtifacts(cleanSystemTags(pendingText)).trim();
      pendingText = "";
      if (!text || isMeaninglessFenceText(text)) return;
      blocks.push({ kind: "text", text, tool_call: null, timestamp: timestamp || null });
    };

    for (const item of responseItems) {
      const kind = item?.kind ?? "";

      if (kind === "thinking") {
        flushPendingText();
        const thinking = extractCopilotItemText(item).trim();
        if (thinking) {
          blocks.push({ kind: "thinking", text: thinking, tool_call: null, timestamp: timestamp || null });
        }
        continue;
      }

      if (kind === "toolInvocationSerialized") {
        flushPendingText();
        const initialInvocation = extractCopilotToolMessage(item?.invocationMessage);
        const toolName = mapCopilotToolName(item?.toolId, initialInvocation);
        const details = extractCopilotInvocationDetails(toolName, item?.invocationMessage, item?.pastTenseMessage);
        const specificInput = extractCopilotToolSpecificInput(item?.toolSpecificData);
        const input = {
          tool_id: item?.toolId ?? "",
          invocation: details.invocationText,
        };
        if (details.filePath) input.file_path = details.filePath;
        if (details.command) input.command = details.command;
        if (details.uri) input.uri = details.uri;
        for (const [k, v] of Object.entries(specificInput)) {
          if (v === "" || v == null) continue;
          if (Array.isArray(v) && v.length === 0) continue;
          input[k] = v;
        }

        const toolCall = {
          tool_use_id: String(item?.toolCallId ?? ""),
          name: toolName,
          input,
          result: details.pastText || null,
          resultTimestamp: details.pastText ? (timestamp || null) : null,
          is_error: false,
        };
        blocks.push({ kind: "tool_use", text: "", tool_call: toolCall, timestamp: timestamp || null });
        continue;
      }

      const text = extractCopilotItemText(item);
      if (text) {
        pendingText += text;
      }
    }

    flushPendingText();

    turns.push({
      index: turns.length + 1,
      user_text: userText,
      blocks,
      timestamp,
    });
  }

  return finalizeGitHubChatTurns(turns);
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
 * Parse a Codex CLI JSONL transcript into Turn[].
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
  const text = readFileSync(filePath, "utf-8");
  const format = detectFormatFromText(text);
  if (format === "codex") return parseCodexTranscript(text);
  if (format === "github-chat") return parseGitHubChatTranscript(filePath);
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
