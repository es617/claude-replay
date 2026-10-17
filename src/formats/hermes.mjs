/**
 * Hermes Agent format parser.
 *
 * Two on-disk shapes:
 *
 * 1. Raw export: `hermes sessions export --format jsonl [--session-id <id>] <out>`
 *    - Single session → one JSON object: { id, source, model, messages: [...] }
 *    - Multi  session → JSONL where each line is one such object
 *    Messages use the SQLite state.db shape:
 *      { role: "user"|"assistant"|"tool", content, tool_calls, tool_call_id,
 *        tool_name, timestamp, reasoning_content, compacted, ... }
 *    Assistant rows carry tool_calls as a JSON string (array of
 *    { id/call_id, function:{name,arguments} }), tool results live in
 *    separate role:"tool" rows matched by tool_call_id.
 *
 * 2. Trace export: `hermes sessions export --format trace` emits Claude Code
 *    JSONL (type:user/assistant + version:hermes-agent). Those files are
 *    handled by the claude-code parser, so this module focuses only on (1).
 */

export const name = "hermes";

// Map Hermes implementation tool names (lowercase) → the canonical names the
// renderer keys off for shell-output and diff scenes. Unrecognised tools
// (MCP servers, future builtins) pass through unchanged.
const TOOL_MAP = {
  terminal: "Bash",
  read_file: "Read",
  write_file: "Write",
  patch: "Edit",
  search_files: "Grep",
  web_search: "WebSearch",
  web_extract: "WebFetch",
  delegate_task: "Task",
  clarify: "AskUserQuestion",
  todo: "TodoWrite",
  skill_view: "Skill",
  skill_manage: "Skill",
  skills_list: "Skill",
  vision_analyze: "Vision",
  computer_use: "ComputerUse",
  execute_code: "Bash",
  session_search: "SessionSearch",
  text_to_speech: "TTS",
  browser_navigate: "BrowserNavigate",
  browser_click: "BrowserClick",
  browser_type: "BrowserType",
  browser_snapshot: "BrowserSnapshot",
  cronjob: "Cron",
};

function mapHermesToolName(name) {
  return TOOL_MAP[name] || name;
}

function mapHermesToolArgs(rawName, input) {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? input
      : null;
  if (!obj) return obj || {};
  if (rawName === "patch") {
    return {
      file_path: obj.path ?? "",
      old_string: obj.old_string ?? "",
      new_string: obj.new_string ?? "",
    };
  }
  if (rawName === "write_file") {
    return { file_path: obj.path ?? "", content: obj.content ?? "" };
  }
  if (rawName === "read_file") {
    return { file_path: obj.path ?? "" };
  }
  if (rawName === "terminal") {
    return {
      command: obj.command ?? "",
      ...(typeof obj.workdir === "string" ? { workdir: obj.workdir } : {}),
    };
  }
  if (rawName === "delegate_task") {
    return {
      description: obj.goal ?? "",
      prompt: obj.context ?? "",
      subagent_type: obj.role === "orchestrator" ? "orchestrator" : "subagent",
    };
  }
  return obj;
}

function toIso(timestamp) {
  if (timestamp == null || timestamp === "") return "";
  const n = typeof timestamp === "string" ? parseFloat(timestamp) : timestamp;
  if (!Number.isFinite(n) || n <= 0) return "";
  // Hermes stores REAL as unix seconds (e.g. 1787164125.236).
  // Anything < 1_577_836_800_000 is seconds; convert to ms.
  const ms = n < 1_577_836_800_000 ? n * 1000 : n;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function parseToolCalls(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function parseArgs(raw) {
  if (!raw) return {};
  // Already an object (exported JSON may store args inline)
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

// ── detection ───────────────────────────────────────────────────────────────

/**
 * Hermes raw export contains a single top-level object with `messages` array
 * and session metadata (source/model). Detect from the first parsed JSON value.
 */
export function detect(obj) {
  return !!(
    obj &&
    typeof obj === "object" &&
    Array.isArray(obj.messages) &&
    (obj.source !== undefined || obj.id !== undefined) &&
    // At least hint it's Hermes: messages use {role,timestamp} with numeric
    // timestamp or have tool_calls, not Claude's {type,message,timestamp}.
    (obj.messages.length === 0 ||
      (obj.messages[0] && typeof obj.messages[0].role === "string"))
  );
}

/**
 * Single-JSON-object format (one big object), so detection needs the full text
 * — same pattern as gemini.mjs (exported as textDetector).
 */
export function detectFromText(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return false;
  // Single-session export: the whole file is one JSON object with .messages
  try {
    const obj = JSON.parse(trimmed);
    if (detect(obj)) return true;
  } catch {
    // Might be JSONL of multiple Hermes sessions — check first line
  }
  const firstLine = trimmed.split("\n").find((l) => l.trim());
  if (!firstLine) return false;
  try {
    const obj = JSON.parse(firstLine.trim());
    return detect(obj);
  } catch {
    return false;
  }
}

// ── title extraction (for editor discovery labels) ─────────────────────────

export function extractTitle(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Try single JSON object first
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj.title === "string" && obj.title.trim()) {
      return obj.title.trim();
    }
    if (obj && typeof obj.id === "string" && obj.id) return obj.id;
  } catch {
    // fall through to line-by-line
  }

  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj.title === "string" && obj.title.trim()) {
        return obj.title.trim();
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ── parsing ─────────────────────────────────────────────────────────────────

function buildTurnsFromHermesMessages(messages, sessionModel = "") {
  const turns = [];
  let turnIndex = 0;

  // Pending tool_use blocks awaiting their role:"tool" result, keyed by call id.
  const pending = new Map();
  let currentTurn = null;
  const newTurn = (userText, ts) => {
    turnIndex++;
    const t = { index: turnIndex, user_text: userText, blocks: [], timestamp: ts || "" };
    turns.push(t);
    currentTurn = t;
    return t;
  };

  // Sort defensively — exported messages already ordered but legacy files may
  // not be. Hermes uses timestamp ASC, id ASC.
  const sorted = [...messages].sort((a, b) => {
    const ta = a.timestamp ?? 0;
    const tb = b.timestamp ?? 0;
    if (ta !== tb) return ta - tb;
    return (a.id ?? 0) - (b.id ?? 0);
  });

  for (const msg of sorted) {
    const role = msg.role;
    const ts = toIso(msg.timestamp);

    if (role === "user") {
      const text = (msg.content || "").trim();
      if (!text) continue;
      newTurn(text, ts);
      continue;
    }

    if (role === "assistant") {
      const blocks = [];
      const thinking = (msg.reasoning_content || msg.reasoning || "").trim();
      if (thinking) {
        blocks.push({ kind: "thinking", text: thinking, tool_call: null, timestamp: ts });
      }
      const text = (msg.content || "").trim();
      if (text) {
        blocks.push({ kind: "text", text, tool_call: null, timestamp: ts });
      }

      const calls = parseToolCalls(msg.tool_calls, msg.id);
      for (const call of calls) {
        const rawName = call.function?.name || call.name || "";
        const input = parseArgs(call.function?.arguments);
        const mappedName = mapHermesToolName(rawName);
        const mappedInput = mapHermesToolArgs(rawName, input);
        const toolId = call.call_id || call.id || `hermes-${rawName}-${msg.id}`;
        const toolCall = {
          tool_use_id: toolId,
          name: mappedName,
          input: mappedInput,
          result: null,
          resultTimestamp: null,
          is_error: false,
          _hermes_raw_name: rawName,
        };
        blocks.push({ kind: "tool_use", text: "", tool_call: toolCall, timestamp: ts });
        pending.set(toolId, toolCall);
        if (call.id && call.id !== toolId) pending.set(call.id, toolCall);
        if (call.call_id && call.call_id !== toolId) pending.set(call.call_id, toolCall);
      }

      if (blocks.length === 0) continue;

      // All assistant rows until the next user belong to the same turn.
      if (!currentTurn) {
        newTurn("", ts);
      }
      currentTurn.blocks.push(...blocks);
      if (!currentTurn.timestamp) currentTurn.timestamp = ts;
      const model = msg.model || sessionModel;
      if (model) currentTurn.response = { ...(currentTurn.response ?? {}), model };
      continue;
    }

    if (role === "tool") {
      const tcid = msg.tool_call_id;
      if (!tcid) continue;
      const block = pending.get(tcid);
      if (!block) continue;
      const result = (msg.content || "").trim();
      if (result) {
        try {
          const parsed = JSON.parse(result);
          if (typeof parsed === "object" && parsed !== null) {
            if (typeof parsed.output === "string") {
              block.result = parsed.output;
            } else {
              block.result = JSON.stringify(parsed, null, 2);
            }
          } else {
            block.result = result;
          }
        } catch {
          block.result = result;
        }
      }
      block.resultTimestamp = ts || null;
      if (msg.tool_name) {
        if (result.includes('"success": false') || result.includes('"success":false')) {
          block.is_error = true;
        }
      }
      pending.delete(tcid);
      for (const [k, v] of pending) {
        if (v === block) pending.delete(k);
      }
      continue;
    }

    // role === "session_meta" / "system" / unknown — skip
  }

  // Re-index sequentially after dropping empties, and drop empty turns.
  const filtered = turns.filter((t) => {
    if (t.user_text && t.user_text.trim()) return true;
    return t.blocks.some((b) => {
      if (b.kind === "tool_use") return true;
      if (b.kind === "text" && b.text && b.text !== "No response requested.") return true;
      if (b.kind === "thinking" && b.text) return true;
      return false;
    });
  });
  for (let i = 0; i < filtered.length; i++) filtered[i].index = i + 1;
  return filtered;
}

export function parse(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Try single JSON object (one session export)
  try {
    const obj = JSON.parse(trimmed);
    if (Array.isArray(obj.messages)) {
      return buildTurnsFromHermesMessages(obj.messages, obj.model);
    }
  } catch {
    // not single object — try JSONL of many Hermes session objects
  }

  // JSONL where each line is a Hermes session JSON object: merge all messages
  const allMessages = [];
  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (Array.isArray(obj.messages)) {
        allMessages.push(...obj.messages.map((message) => ({ ...message, model: message.model || obj.model })));
      } else if (obj.role) {
        // Fallback: raw messages JSONL (unlikely but handle)
        allMessages.push(obj);
      }
    } catch {
      continue;
    }
  }

  if (allMessages.length > 0) {
    // Sort globally and build turns sorted by timestamp so multi-session files
    // interleave chronologically.
    return buildTurnsFromHermesMessages(allMessages);
  }

  return [];
}
