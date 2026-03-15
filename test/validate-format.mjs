#!/usr/bin/env node

/**
 * Validate that generated session files match expected format structure.
 * Used by CI to catch upstream format changes in Claude Code and Codex.
 *
 * Usage: node test/validate-format.mjs <format> <file.jsonl>
 *   format: "claude" or "codex"
 *
 * Exits 0 if valid, 1 if format has unexpected changes.
 */

import { readFileSync } from "node:fs";

const [format, filePath] = process.argv.slice(2);
if (!format || !filePath) {
  console.error("Usage: node validate-format.mjs <claude|codex> <file.jsonl>");
  process.exit(1);
}

const text = readFileSync(filePath, "utf-8");
const lines = text.trim().split("\n").filter(Boolean);
const entries = lines.map((l) => JSON.parse(l));

const errors = [];
const warnings = [];

function check(condition, msg) {
  if (!condition) errors.push(msg);
}

function warn(condition, msg) {
  if (!condition) warnings.push(msg);
}

if (format === "claude") {
  // Expected types in Claude Code JSONL
  const knownTypes = new Set([
    "user", "assistant", "result", "summary",
    "file-history-snapshot", "session-id",
    "queue-operation", "last-prompt",
  ]);
  const foundTypes = new Set(entries.map((e) => e.type));
  const unknownTypes = [...foundTypes].filter((t) => !knownTypes.has(t));

  check(entries.length > 0, "File is empty");
  check(foundTypes.has("user"), "No 'user' entries found");
  check(foundTypes.has("assistant"), "No 'assistant' entries found");

  if (unknownTypes.length > 0) {
    warn(false, `Unknown entry types: ${unknownTypes.join(", ")}`);
  }

  // Check user entry structure
  const userEntries = entries.filter((e) => e.type === "user");
  for (const entry of userEntries.slice(0, 3)) {
    check(entry.message, "User entry missing 'message' field");
    check(entry.message?.role === "user", "User entry message.role !== 'user'");
    check(entry.message?.content !== undefined, "User entry missing message.content");
  }

  // Check assistant entry structure
  const assistantEntries = entries.filter((e) => e.type === "assistant");
  for (const entry of assistantEntries.slice(0, 3)) {
    check(entry.message, "Assistant entry missing 'message' field");
    check(entry.message?.role === "assistant", "Assistant entry message.role !== 'assistant'");
    check(Array.isArray(entry.message?.content), "Assistant entry message.content is not an array");
    if (Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content) {
        const validTypes = ["text", "thinking", "tool_use", "tool_result"];
        warn(validTypes.includes(block.type), `Unknown block type in assistant content: ${block.type}`);

        // #1: tool_use block shape
        if (block.type === "tool_use") {
          check(typeof block.id === "string", "tool_use block missing 'id' field");
          check(typeof block.name === "string", "tool_use block missing 'name' field");
          check(block.input !== undefined, "tool_use block missing 'input' field");
        }

        // text/thinking block shape
        if (block.type === "text") {
          check(typeof block.text === "string", "text block missing 'text' field (got: " + typeof block.text + ")");
        }
        if (block.type === "thinking") {
          check(typeof block.thinking === "string", "thinking block missing 'thinking' field (got: " + typeof block.thinking + ")");
        }
      }
    }
  }

  // #4: tool_result in user messages
  const toolResultUsers = userEntries.filter((e) =>
    Array.isArray(e.message?.content) &&
    e.message.content.some((c) => c.type === "tool_result")
  );
  for (const entry of toolResultUsers.slice(0, 3)) {
    for (const block of entry.message.content) {
      if (block.type === "tool_result") {
        check(typeof block.tool_use_id === "string", "tool_result missing 'tool_use_id' field");
        check(block.content !== undefined, "tool_result missing 'content' field");
      }
    }
  }

  // #3: timestamp format (ISO 8601)
  const hasTimestamps = entries.some((e) => e.timestamp);
  warn(hasTimestamps, "No timestamps found on any entries");
  const timestampEntries = entries.filter((e) => e.timestamp);
  for (const entry of timestampEntries.slice(0, 3)) {
    const d = new Date(entry.timestamp);
    check(!isNaN(d.getTime()), `Timestamp not parseable as Date: ${entry.timestamp}`);
    warn(typeof entry.timestamp === "string", `Timestamp is not a string: ${typeof entry.timestamp}`);
  }

} else if (format === "codex") {
  // Expected types in Codex JSONL
  const knownTypes = new Set([
    "session_meta", "event_msg", "response_item", "turn_context",
  ]);
  const foundTypes = new Set(entries.map((e) => e.type));
  const unknownTypes = [...foundTypes].filter((t) => !knownTypes.has(t));

  check(entries.length > 0, "File is empty");
  check(foundTypes.has("event_msg") || foundTypes.has("response_item"),
    "No 'event_msg' or 'response_item' entries found");

  if (unknownTypes.length > 0) {
    warn(false, `Unknown entry types: ${unknownTypes.join(", ")}`);
  }

  // Check event_msg structure (data is in payload)
  const eventMsgs = entries.filter((e) => e.type === "event_msg");
  for (const entry of eventMsgs.slice(0, 3)) {
    check(entry.payload, "event_msg missing 'payload' field");
    if (entry.payload) {
      check(entry.payload.type, "event_msg.payload missing 'type' field");
    }
  }

  // Check response_item structure (data is in payload)
  const responseItems = entries.filter((e) => e.type === "response_item");
  for (const entry of responseItems.slice(0, 5)) {
    check(entry.payload, "response_item missing 'payload' field");
    if (entry.payload) {
      check(entry.payload.type, "response_item.payload missing 'type' field");
      const knownItemTypes = ["message", "reasoning", "function_call", "function_call_output",
        "custom_tool_call", "custom_tool_call_output"];
      warn(knownItemTypes.includes(entry.payload.type),
        `Unknown response_item type: ${entry.payload.type}`);

      // #1/#5: function_call shape (exec_command, apply_patch)
      if (entry.payload.type === "function_call") {
        check(typeof entry.payload.name === "string", "function_call missing 'name' field");
        check(typeof entry.payload.arguments === "string", "function_call missing 'arguments' field");
        if (entry.payload.name === "exec_command") {
          const args = JSON.parse(entry.payload.arguments || "{}");
          check(typeof args.cmd === "string" || typeof args.command === "string",
            "exec_command missing 'cmd' or 'command' in arguments");
        }
        if (entry.payload.name === "apply_patch") {
          const args = JSON.parse(entry.payload.arguments || "{}");
          check(typeof args.patch === "string",
            "apply_patch missing 'patch' in arguments");
        }
      }

      // message shape
      if (entry.payload.type === "message") {
        check(entry.payload.role, "message response_item missing 'role' field");
        check(Array.isArray(entry.payload.content), "message response_item 'content' is not an array");
      }

      // reasoning shape (content may be null when encrypted)
      if (entry.payload.type === "reasoning") {
        check(Array.isArray(entry.payload.content) || entry.payload.content === null,
          "reasoning response_item 'content' is not an array or null");
      }
    }
  }

  // Check event_msg payload types
  const knownEventTypes = ["task_started", "task_complete", "user_message"];
  for (const entry of eventMsgs.slice(0, 5)) {
    if (entry.payload?.type) {
      warn(knownEventTypes.includes(entry.payload.type),
        `Unknown event_msg type: ${entry.payload.type}`);
    }
  }

  // #3: timestamp format
  const timestampEntries = entries.filter((e) => e.timestamp);
  for (const entry of timestampEntries.slice(0, 3)) {
    const d = new Date(entry.timestamp);
    check(!isNaN(d.getTime()), `Timestamp not parseable as Date: ${entry.timestamp}`);
    warn(typeof entry.timestamp === "string", `Timestamp is not a string: ${typeof entry.timestamp}`);
  }

} else if (format === "cursor") {
  check(entries.length > 0, "File is empty");

  // Cursor format: { role, message: { content } }
  const roles = new Set(entries.map((e) => e.role));
  check(roles.has("user"), "No 'user' entries found");
  check(roles.has("assistant"), "No 'assistant' entries found");

  const knownRoles = new Set(["user", "assistant", "system"]);
  const unknownRoles = [...roles].filter((r) => !knownRoles.has(r));
  if (unknownRoles.length > 0) {
    warn(false, `Unknown roles: ${unknownRoles.join(", ")}`);
  }

  // All entries should have role and message
  for (const entry of entries.slice(0, 5)) {
    check(typeof entry.role === "string", "Entry missing 'role' field");
    check(entry.message !== undefined, "Entry missing 'message' field");
    if (entry.message) {
      check(entry.message.content !== undefined, "Entry message missing 'content' field");
    }
  }

  // Cursor should NOT have a 'type' field (that's Claude Code format)
  const hasType = entries.some((e) => e.type);
  warn(!hasType, "Entries have 'type' field — may be Claude Code format, not Cursor");

} else {
  console.error(`Unknown format: ${format}`);
  process.exit(1);
}

// Report
if (warnings.length > 0) {
  console.error(`⚠ FORMAT WARNINGS (${format}):`);
  for (const w of warnings) console.error(`  - ${w}`);
}

if (errors.length > 0) {
  console.error(`✗ FORMAT ERRORS (${format}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const kinds = format === "cursor"
  ? `roles: ${[...new Set(entries.map((e) => e.role))].join(", ")}`
  : `types: ${[...new Set(entries.map((e) => e.type))].join(", ")}`;
console.log(`✓ Format validation passed (${format}): ${entries.length} entries, ${kinds}`);
