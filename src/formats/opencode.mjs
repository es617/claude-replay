/**
 * OpenCode JSONL format parser.
 *
 * Format: JSONL with step_start/step_finish boundaries, tool_use, text, and reasoning events.
 * Each step is grouped into turns by step_finish reason="stop".
 */

export const name = "opencode";

/**
 * Detect if a JSONL line is an OpenCode event.
 */
export function detect(firstObj) {
  const validTypes = new Set(["step_start", "step_finish", "tool_use", "text", "reasoning", "error"]);
  return !!(firstObj.sessionID && validTypes.has(firstObj.type));
}

const TOOL_MAP = {
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
 * Parse OpenCode JSONL text into Turn[].
 */
export function parse(text) {
  const events = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { events.push(JSON.parse(trimmed)); } catch { continue; }
  }

  const turns = [];
  let turnIndex = 0;
  let currentBlocks = [];
  let currentTimestamp = "";

  function finalizeTurn() {
    if (currentBlocks.length === 0) return;
    turnIndex++;
    turns.push({ index: turnIndex, user_text: "", blocks: currentBlocks, timestamp: currentTimestamp });
    currentBlocks = [];
    currentTimestamp = "";
  }

  for (const evt of events) {
    const type = evt.type;
    const part = evt.part ?? {};
    const ts = evt.timestamp ? new Date(evt.timestamp).toISOString() : null;

    if (type === "step_start") {
      if (!currentTimestamp && ts) currentTimestamp = ts;
      continue;
    }

    if (type === "tool_use") {
      const rawName = part.tool ?? "unknown";
      const mappedName = TOOL_MAP[rawName] ?? rawName;
      const state = part.state ?? {};
      const input = state.input ?? {};
      const output = state.output ?? "";
      const isError = state.status === "error" ||
        (state.metadata?.exit != null && state.metadata.exit !== 0);
      const resultTs = state.time?.end ? new Date(state.time.end).toISOString() : null;

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
        kind: "tool_use", text: "",
        tool_call: {
          tool_use_id: part.callID ?? "", name: mappedName, input: normalizedInput,
          result: typeof output === "string" ? output : JSON.stringify(output),
          resultTimestamp: resultTs, is_error: isError,
        },
        timestamp: ts,
      });
      continue;
    }

    if (type === "reasoning") {
      const content = (part.text ?? "").trim();
      if (content) currentBlocks.push({ kind: "thinking", text: content, tool_call: null, timestamp: ts });
      continue;
    }

    if (type === "text") {
      const content = (part.text ?? "").trim();
      if (content) currentBlocks.push({ kind: "text", text: content, tool_call: null, timestamp: ts });
      continue;
    }

    if (type === "step_finish") {
      const reason = part.reason ?? "";
      if (reason === "stop") finalizeTurn();
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

  finalizeTurn();

  for (let j = 0; j < turns.length; j++) {
    turns[j].index = j + 1;
  }
  return turns;
}
