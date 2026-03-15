import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const VALIDATOR = new URL("./validate-format.mjs", import.meta.url).pathname;

function run(format, lines) {
  const tmp = join(tmpdir(), `validate-test-${process.pid}-${Date.now()}.jsonl`);
  writeFileSync(tmp, lines.map((l) => JSON.stringify(l)).join("\n"));
  try {
    const { status, stdout, stderr } = spawnSync(process.execPath, [VALIDATOR, format, tmp], {
      encoding: "utf-8",
    });
    return { code: status, stdout: stdout || "", stderr: stderr || "" };
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

describe("validate-format", () => {
  // ── Claude: valid ──────────────────────────────────────

  it("passes for valid Claude format", () => {
    const result = run("claude", [
      { type: "user", message: { role: "user", content: "hello" }, timestamp: "2025-01-01T00:00:00Z" },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
    ]);
    assert.equal(result.code, 0);
  });

  // ── Claude: format changes that should fail ────────────

  it("fails if Claude has no user entries", () => {
    const result = run("claude", [
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No 'user' entries found/);
  });

  it("fails if Claude has no assistant entries", () => {
    const result = run("claude", [
      { type: "user", message: { role: "user", content: "hello" } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No 'assistant' entries found/);
  });

  it("fails if Claude user entry missing message field", () => {
    const result = run("claude", [
      { type: "user", content: "hello" },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing 'message' field/);
  });

  it("fails if Claude user entry has wrong role", () => {
    const result = run("claude", [
      { type: "user", message: { role: "system", content: "hello" } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /role !== 'user'/);
  });

  it("fails if Claude assistant content is not an array", () => {
    const result = run("claude", [
      { type: "user", message: { role: "user", content: "hello" } },
      { type: "assistant", message: { role: "assistant", content: "just a string" } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /not an array/);
  });

  it("warns on unknown entry types", () => {
    const result = run("claude", [
      { type: "user", message: { role: "user", content: "hello" } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
      { type: "new_fancy_type", data: {} },
    ]);
    // Passes (warnings don't fail) but stderr has warning
    assert.equal(result.code, 0);
    assert.match(result.stdout + (result.stderr || ""), /Unknown entry types.*new_fancy_type/);
  });

  it("warns on unknown block types in assistant content", () => {
    const result = run("claude", [
      { type: "user", message: { role: "user", content: "hello" } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "magic_block", text: "hi" }] } },
    ]);
    assert.equal(result.code, 0);
  });

  it("fails on empty file", () => {
    const result = run("claude", []);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /empty/i);
  });

  // ── Claude: tool_use shape (#1) ─────────────────────────

  it("fails if tool_use block missing id", () => {
    const result = run("claude", [
      { type: "user", message: { role: "user", content: "hello" } },
      { type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", name: "Read", input: { file_path: "/tmp/x" } },
      ] } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /tool_use block missing 'id'/);
  });

  it("fails if tool_use block missing name", () => {
    const result = run("claude", [
      { type: "user", message: { role: "user", content: "hello" } },
      { type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "t1", input: {} },
      ] } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /tool_use block missing 'name'/);
  });

  it("fails if tool_use block missing input", () => {
    const result = run("claude", [
      { type: "user", message: { role: "user", content: "hello" } },
      { type: "assistant", message: { role: "assistant", content: [
        { type: "tool_use", id: "t1", name: "Read" },
      ] } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /tool_use block missing 'input'/);
  });

  // ── Claude: text/thinking shape ────────────────────────

  it("fails if text block has no text field", () => {
    const result = run("claude", [
      { type: "user", message: { role: "user", content: "hello" } },
      { type: "assistant", message: { role: "assistant", content: [
        { type: "text", value: "renamed field" },
      ] } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /text block missing 'text' field/);
  });

  it("fails if thinking block has no thinking field", () => {
    const result = run("claude", [
      { type: "user", message: { role: "user", content: "hello" } },
      { type: "assistant", message: { role: "assistant", content: [
        { type: "thinking", text: "wrong field name" },
      ] } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /thinking block missing 'thinking' field/);
  });

  // ── Claude: tool_result in user messages (#4) ──────────

  it("fails if tool_result missing tool_use_id", () => {
    const result = run("claude", [
      { type: "user", message: { role: "user", content: [
        { type: "tool_result", content: "result" },
      ] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /tool_result missing 'tool_use_id'/);
  });

  it("fails if tool_result missing content", () => {
    const result = run("claude", [
      { type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "t1" },
      ] } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /tool_result missing 'content'/);
  });

  // ── Claude: timestamps (#3) ────────────────────────────

  it("fails on unparseable timestamp", () => {
    const result = run("claude", [
      { type: "user", message: { role: "user", content: "hello" }, timestamp: "not-a-date" },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Timestamp not parseable/);
  });

  it("warns if timestamp is not a string", () => {
    const result = run("claude", [
      { type: "user", message: { role: "user", content: "hello" }, timestamp: 1704067200000 },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
    ]);
    // Unix timestamp parses as a valid Date, so no error — but warns about type
    assert.match(result.stderr, /not a string/);
  });

  // ── Codex: valid ───────────────────────────────────────

  it("passes for valid Codex format", () => {
    const result = run("codex", [
      { type: "session_meta", timestamp: "2025-01-01T00:00:00Z", payload: { id: "s1", model_provider: "openai" } },
      { type: "event_msg", timestamp: "2025-01-01T00:00:01Z", payload: { type: "task_started", turn_id: "t1" } },
      { type: "response_item", timestamp: "2025-01-01T00:00:02Z", payload: { type: "message", role: "assistant", content: [{ type: "text", text: "hi" }] } },
    ]);
    assert.equal(result.code, 0);
  });

  // ── Codex: format changes that should fail ─────────────

  it("fails if Codex has no event_msg or response_item", () => {
    const result = run("codex", [
      { type: "session_meta", payload: { id: "s1" } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No 'event_msg' or 'response_item'/);
  });

  it("fails if Codex event_msg missing payload", () => {
    const result = run("codex", [
      { type: "event_msg", event_type: "task_started" },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing 'payload' field/);
  });

  it("fails if Codex response_item missing payload", () => {
    const result = run("codex", [
      { type: "event_msg", payload: { type: "task_started" } },
      { type: "response_item", item: { type: "message" } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing 'payload' field/);
  });

  it("fails if Codex payload missing type", () => {
    const result = run("codex", [
      { type: "event_msg", payload: { data: "no type here" } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /payload missing 'type'/);
  });

  it("warns on unknown Codex entry types", () => {
    const result = run("codex", [
      { type: "event_msg", payload: { type: "task_started" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "text", text: "hi" }] } },
      { type: "telemetry", payload: {} },
    ]);
    assert.equal(result.code, 0);
    assert.match(result.stdout + (result.stderr || ""), /Unknown entry types.*telemetry/);
  });

  // ── Codex: function_call shape (#5) ────────────────────

  it("fails if Codex function_call missing name", () => {
    const result = run("codex", [
      { type: "event_msg", payload: { type: "task_started" } },
      { type: "response_item", payload: { type: "function_call", arguments: '{"cmd":"ls"}' } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /function_call missing 'name'/);
  });

  it("fails if Codex function_call missing arguments", () => {
    const result = run("codex", [
      { type: "event_msg", payload: { type: "task_started" } },
      { type: "response_item", payload: { type: "function_call", name: "exec_command" } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /function_call missing 'arguments'/);
  });

  it("fails if exec_command missing cmd in arguments", () => {
    const result = run("codex", [
      { type: "event_msg", payload: { type: "task_started" } },
      { type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: '{"something":"else"}' } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /exec_command missing 'cmd'/);
  });

  it("fails if apply_patch missing patch in arguments", () => {
    const result = run("codex", [
      { type: "event_msg", payload: { type: "task_started" } },
      { type: "response_item", payload: { type: "function_call", name: "apply_patch", arguments: '{"file":"test.txt"}' } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /apply_patch missing 'patch'/);
  });

  it("passes valid exec_command", () => {
    const result = run("codex", [
      { type: "event_msg", payload: { type: "task_started" } },
      { type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: '{"cmd":"ls","workdir":"/tmp"}' } },
    ]);
    assert.equal(result.code, 0);
  });

  it("passes valid apply_patch", () => {
    const result = run("codex", [
      { type: "event_msg", payload: { type: "task_started" } },
      { type: "response_item", payload: { type: "function_call", name: "apply_patch", arguments: '{"patch":"*** Begin Patch\\n*** End Patch"}' } },
    ]);
    assert.equal(result.code, 0);
  });

  // ── Codex: message/reasoning shape ─────────────────────

  it("fails if Codex message missing role", () => {
    const result = run("codex", [
      { type: "event_msg", payload: { type: "task_started" } },
      { type: "response_item", payload: { type: "message", content: [{ type: "text", text: "hi" }] } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /message.*missing 'role'/);
  });

  it("passes reasoning with null content (encrypted)", () => {
    const result = run("codex", [
      { type: "event_msg", payload: { type: "task_started" } },
      { type: "response_item", payload: { type: "reasoning", content: null, encrypted_content: "gAAA" } },
    ]);
    assert.equal(result.code, 0);
  });

  it("warns on unknown response_item type", () => {
    const result = run("codex", [
      { type: "event_msg", payload: { type: "task_started" } },
      { type: "response_item", payload: { type: "new_fancy_item" } },
    ]);
    assert.equal(result.code, 0);
    assert.match(result.stderr, /Unknown response_item type.*new_fancy_item/);
  });

  it("warns on unknown event_msg type", () => {
    const result = run("codex", [
      { type: "event_msg", payload: { type: "task_started" } },
      { type: "event_msg", payload: { type: "new_event_type" } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [] } },
    ]);
    assert.equal(result.code, 0);
    assert.match(result.stderr, /Unknown event_msg type.*new_event_type/);
  });

  // ── Cursor: valid ──────────────────────────────────────

  it("passes for valid Cursor format", () => {
    const result = run("cursor", [
      { role: "user", message: { content: "hello" } },
      { role: "assistant", message: { content: "hi" } },
    ]);
    assert.equal(result.code, 0);
  });

  // ── Cursor: format changes that should fail ────────────

  it("fails if Cursor has no user entries", () => {
    const result = run("cursor", [
      { role: "assistant", message: { content: "hi" } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No 'user' entries/);
  });

  it("fails if Cursor has no assistant entries", () => {
    const result = run("cursor", [
      { role: "user", message: { content: "hello" } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /No 'assistant' entries/);
  });

  it("fails if Cursor entry missing role", () => {
    const result = run("cursor", [
      { message: { content: "hello" } },
      { role: "assistant", message: { content: "hi" } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing 'role'/);
  });

  it("fails if Cursor entry missing message", () => {
    const result = run("cursor", [
      { role: "user" },
      { role: "assistant", message: { content: "hi" } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing 'message'/);
  });

  it("fails if Cursor message missing content", () => {
    const result = run("cursor", [
      { role: "user", message: { text: "wrong field" } },
      { role: "assistant", message: { content: "hi" } },
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing 'content'/);
  });

  it("warns on unknown Cursor roles", () => {
    const result = run("cursor", [
      { role: "user", message: { content: "hello" } },
      { role: "assistant", message: { content: "hi" } },
      { role: "tool", message: { content: "result" } },
    ]);
    assert.equal(result.code, 0);
    assert.match(result.stderr, /Unknown roles.*tool/);
  });

  it("warns if Cursor entries have type field", () => {
    const result = run("cursor", [
      { role: "user", type: "user", message: { content: "hello" } },
      { role: "assistant", message: { content: "hi" } },
    ]);
    assert.equal(result.code, 0);
    assert.match(result.stderr, /may be Claude Code format/);
  });
});
