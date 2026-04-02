/**
 * Shared utilities for all format parsers.
 * @module
 */

/**
 * @typedef {{ tool_use_id: string, name: string, input: object, result: string|null, resultTimestamp: string|null, is_error: boolean }} ToolCall
 * @typedef {{ kind: string, text: string, tool_call: ToolCall|null, timestamp: string|null }} AssistantBlock
 * @typedef {{ index: number, user_text: string, blocks: AssistantBlock[], timestamp: string }} Turn
 */

/**
 * Strip system tags, IDE context, and command metadata from user text.
 */
export function cleanSystemTags(text) {
  text = text.replace(/<task-notification>\s*<task-id>[^<]*<\/task-id>\s*<output-file>[^<]*<\/output-file>\s*<status>([^<]*)<\/status>\s*<summary>([^<]*)<\/summary>\s*<\/task-notification>/g,
    (_, status, summary) => `[bg-task: ${summary}]`);
  text = text.replace(/\n*Read the output file to retrieve the result:[^\n]*/g, "");
  text = text.replace(/<user_query>([\s\S]*?)<\/user_query>\s*/g, (_, inner) => inner.trim());
  text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "");
  text = text.replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>\s*/g, "");
  text = text.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>\s*/g, "");
  text = text.replace(/<command-name>([\s\S]*?)<\/command-name>\s*/g, (_, name) => name.trim() + "\n");
  text = text.replace(/<command-message>[\s\S]*?<\/command-message>\s*/g, "");
  text = text.replace(/<command-args>\s*<\/command-args>\s*/g, "");
  text = text.replace(/<command-args>([\s\S]*?)<\/command-args>\s*/g, (_, args) => {
    const trimmed = args.trim();
    return trimmed ? trimmed + "\n" : "";
  });
  text = text.replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>\s*/g, "");
  return text.trim();
}

/**
 * Extract plain text from user message content (string or block array).
 */
export function extractText(content) {
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
export function isToolResultOnly(content) {
  if (typeof content === "string") return false;
  return content.every((b) => b.type === "tool_result");
}

/**
 * Collect all assistant content blocks starting from index `start`.
 * Returns [blocks, nextIndex].
 */
export function collectAssistantBlocks(entries, start) {
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
export function attachToolResults(blocks, entries, resultStart) {
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
 * Build turns from normalized JSONL entries (Claude Code shape).
 * Shared by claude-code.mjs and cursor.mjs since both use the same
 * user→assistant→tool_result entry pattern.
 *
 * @param {object[]} entries - Normalized entries with { type, message, timestamp }
 * @returns {Turn[]}
 */
export function buildTurnsFromEntries(entries) {
  const turns = [];
  let i = 0;
  let turnIndex = 0;

  while (i < entries.length) {
    const entry = entries[i];
    const role = entry.message?.role ?? entry.type;

    if (role === "user") {
      const content = entry.message?.content ?? "";
      if (isToolResultOnly(content)) { i++; continue; }
      let userText = extractText(content);
      const timestamp = entry.timestamp ?? "";
      i++;

      // Absorb consecutive non-tool-result user messages
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

      // Extract system events (bg-task notifications)
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
      const turn = { index: turnIndex, user_text: userText, blocks: assistantBlocks, timestamp };
      if (systemEvents.length) turn.system_events = systemEvents;
      turns.push(turn);
    } else if (role === "assistant") {
      const [assistantBlocks, nextI] = collectAssistantBlocks(entries, i);
      i = nextI;
      i = attachToolResults(assistantBlocks, entries, i);

      if (turns.length > 0) {
        turns[turns.length - 1].blocks.push(...assistantBlocks);
      } else {
        turnIndex++;
        turns.push({ index: turnIndex, user_text: "", blocks: assistantBlocks, timestamp: entry.timestamp ?? "" });
      }
    } else {
      i++;
    }
  }

  return filterEmptyTurns(turns);
}

/**
 * Filter empty turns and re-index sequentially.
 */
export function filterEmptyTurns(turns) {
  const filtered = turns.filter((t) => {
    if (t.user_text) return true;
    if (t.system_events?.length) return true;
    return t.blocks.some((b) => {
      if (b.kind === "tool_use") return true;
      if (b.kind === "text" && b.text && b.text !== "No response requested.") return true;
      if (b.kind === "thinking" && b.text) return true;
      return false;
    });
  });
  for (let j = 0; j < filtered.length; j++) {
    filtered[j].index = j + 1;
  }
  return filtered;
}
