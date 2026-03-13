/**
 * Parse Claude Code and Cursor JSONL transcripts into structured turns.
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
 * @returns {"claude-code"|"cursor"|"unknown"}
 */
export function detectFormat(filePath) {
  const text = readFileSync(filePath, "utf-8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
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
function parseJsonl(filePath) {
  const text = readFileSync(filePath, "utf-8");
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
 * Parse a JSONL transcript into a list of Turns.
 * @param {string} filePath
 * @returns {Turn[]}
 */
export function parseTranscript(filePath) {
  const { entries, format } = parseJsonl(filePath);
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
  if (format === "cursor") {
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
