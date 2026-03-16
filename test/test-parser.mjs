import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { parseTranscript, filterTurns, detectFormat, applyPacedTiming } from "../src/parser.mjs";

const FIXTURE = fileURLToPath(new URL("./fixture.jsonl", import.meta.url));
const CURSOR_FIXTURE = fileURLToPath(new URL("./fixture-cursor.jsonl", import.meta.url));
const CODEX_FIXTURE = fileURLToPath(new URL("./fixture-codex.jsonl", import.meta.url));
const PACED_FIXTURE = fileURLToPath(new URL("./fixture-paced.jsonl", import.meta.url));
const SYSTEM_TAGS_FIXTURE = fileURLToPath(new URL("./fixture-system-tags.jsonl", import.meta.url));
const CODEX_PATCH_FIXTURE = fileURLToPath(new URL("./fixture-codex-patch.jsonl", import.meta.url));
const CODEX_EDGES_FIXTURE = fileURLToPath(new URL("./fixture-codex-edges.jsonl", import.meta.url));
const GITHUB_CHAT_BASIC_FIXTURE = fileURLToPath(new URL("./fixtures/github-chat-basic.jsonl", import.meta.url));
const GITHUB_CHAT_TOOL_FIXTURE = fileURLToPath(new URL("./fixtures/github-chat-tool-calls.jsonl", import.meta.url));
const GITHUB_CHAT_NO_TS_FIXTURE = fileURLToPath(new URL("./fixtures/github-chat-no-timestamps.jsonl", import.meta.url));
const GITHUB_CHAT_VSCODE_PATCHLOG_FIXTURE = fileURLToPath(new URL("./fixtures/github-chat-vscode-patchlog.jsonl", import.meta.url));
const GITHUB_CHAT_VSCODE_INLINE_REF_FIXTURE = fileURLToPath(new URL("./fixtures/github-chat-vscode-inline-ref.jsonl", import.meta.url));
const GITHUB_CHAT_VSCODE_EDIT_FENCE_FIXTURE = fileURLToPath(new URL("./fixtures/github-chat-vscode-edit-fence.jsonl", import.meta.url));

describe("parseTranscript", () => {
  // Fixture produces 3 turns (orphan assistant after tool result merges into previous):
  //   1: user "Hello" → thinking + text
  //   2: user "use a tool" → tool_use (with result) + text "The file contains..."
  //   3: user "Thanks!" → text "You're welcome!"
  it("parses turns from JSONL", () => {
    const turns = parseTranscript(FIXTURE);
    assert.equal(turns.length, 3);
  });

  it("extracts user text", () => {
    const turns = parseTranscript(FIXTURE);
    assert.equal(turns[0].user_text, "Hello, what is 2+2?");
    assert.equal(turns[2].user_text, "Thanks!");
  });

  it("merges continuation assistant blocks into previous turn", () => {
    const turns = parseTranscript(FIXTURE);
    // Turn 2 should have both the tool_use and the follow-up text block
    const toolBlocks = turns[1].blocks.filter((b) => b.kind === "tool_use");
    assert.equal(toolBlocks.length, 1);
    const textBlocks = turns[1].blocks.filter((b) => b.kind === "text");
    assert.equal(textBlocks.length, 1);
    assert.match(textBlocks[0].text, /file contains/);
  });

  it("extracts thinking blocks", () => {
    const turns = parseTranscript(FIXTURE);
    const thinking = turns[0].blocks.filter((b) => b.kind === "thinking");
    assert.equal(thinking.length, 1);
    assert.match(thinking[0].text, /simple math/);
  });

  it("extracts text blocks", () => {
    const turns = parseTranscript(FIXTURE);
    const text = turns[0].blocks.filter((b) => b.kind === "text");
    assert.equal(text.length, 1);
    assert.equal(text[0].text, "2 + 2 = 4");
  });

  it("extracts tool calls with results", () => {
    const turns = parseTranscript(FIXTURE);
    const toolBlocks = turns[1].blocks.filter((b) => b.kind === "tool_use");
    assert.equal(toolBlocks.length, 1);
    assert.equal(toolBlocks[0].tool_call.name, "Read");
    assert.equal(toolBlocks[0].tool_call.result, "file contents here");
  });

  it("assigns sequential turn indices", () => {
    const turns = parseTranscript(FIXTURE);
    assert.deepEqual(
      turns.map((t) => t.index),
      [1, 2, 3]
    );
  });

  it("preserves timestamps", () => {
    const turns = parseTranscript(FIXTURE);
    assert.equal(turns[0].timestamp, "2025-06-01T10:00:00Z");
  });
});

describe("filterTurns", () => {
  it("filters by turn range", () => {
    const turns = parseTranscript(FIXTURE);
    const filtered = filterTurns(turns, { turnRange: [2, 3] });
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].index, 2);
  });

  it("filters by time range", () => {
    const turns = parseTranscript(FIXTURE);
    const filtered = filterTurns(turns, {
      timeFrom: "2025-06-01T10:01:00Z",
      timeTo: "2025-06-01T10:02:05Z",
    });
    // Turns 2 (10:01:00) and 3 (10:02:00) fall in range
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].index, 2);
  });

  it("excludes specific turns", () => {
    const turns = parseTranscript(FIXTURE);
    const filtered = filterTurns(turns, { excludeTurns: [1, 3] });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].index, 2);
  });

  it("combines turn range with exclude", () => {
    const turns = parseTranscript(FIXTURE);
    const filtered = filterTurns(turns, { turnRange: [1, 3], excludeTurns: [2] });
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].index, 1);
    assert.equal(filtered[1].index, 3);
  });

  it("returns all turns with no filters", () => {
    const turns = parseTranscript(FIXTURE);
    const filtered = filterTurns(turns);
    assert.equal(filtered.length, 3);
  });
});

describe("Cursor format", () => {
  it("parses Cursor entries into turns", () => {
    const turns = parseTranscript(CURSOR_FIXTURE);
    assert.equal(turns.length, 2);
  });

  it("strips <user_query> tags", () => {
    const turns = parseTranscript(CURSOR_FIXTURE);
    assert.equal(turns[0].user_text, "scan for ble devices");
    assert.equal(turns[1].user_text, "connect to the first one");
  });

  it("merges consecutive assistant messages into one turn", () => {
    const turns = parseTranscript(CURSOR_FIXTURE);
    assert.equal(turns[0].blocks.length, 2);
    assert.match(turns[0].blocks[0].text, /Planning scan/);
    assert.match(turns[0].blocks[1].text, /Found 3 devices/);
  });

  it("reclassifies all but last assistant block as thinking", () => {
    const turns = parseTranscript(CURSOR_FIXTURE);
    // Turn 1: 2 blocks — first is thinking, last is text
    assert.equal(turns[0].blocks[0].kind, "thinking");
    assert.equal(turns[0].blocks[1].kind, "text");
    // Turn 2: 1 block — stays as text
    assert.equal(turns[1].blocks[0].kind, "text");
  });

  it("has no timestamps before applyPacedTiming", () => {
    const turns = parseTranscript(CURSOR_FIXTURE);
    assert.equal(turns[0].timestamp, "");
  });

  it("detects cursor format", () => {
    assert.equal(detectFormat(CURSOR_FIXTURE), "cursor");
    assert.equal(detectFormat(FIXTURE), "claude-code");
  });
});

describe("Codex format", () => {
  it("detects codex format", () => {
    assert.equal(detectFormat(CODEX_FIXTURE), "codex");
  });

  it("parses turns from task boundaries", () => {
    const turns = parseTranscript(CODEX_FIXTURE);
    assert.equal(turns.length, 3);
  });

  it("extracts user text after 'My request for Codex:' marker", () => {
    const turns = parseTranscript(CODEX_FIXTURE);
    assert.equal(turns[0].user_text, "list files here");
    assert.equal(turns[1].user_text, "create hello.txt");
    assert.equal(turns[2].user_text, "fix the typo");
  });

  it("maps commentary to thinking and final_answer to text", () => {
    const turns = parseTranscript(CODEX_FIXTURE);
    const thinking = turns[0].blocks.filter((b) => b.kind === "thinking");
    const text = turns[0].blocks.filter((b) => b.kind === "text");
    assert.equal(thinking.length, 1);
    assert.match(thinking[0].text, /Checking the directory/);
    assert.equal(text.length, 1);
    assert.equal(text[0].text, "Found 2 files.");
  });

  it("skips encrypted reasoning blocks", () => {
    const turns = parseTranscript(CODEX_FIXTURE);
    const reasoning = turns[0].blocks.filter((b) => b.text?.includes("gAAAA"));
    assert.equal(reasoning.length, 0);
  });

  it("maps exec_command to Bash with normalized input", () => {
    const turns = parseTranscript(CODEX_FIXTURE);
    const bash = turns[0].blocks.find((b) => b.kind === "tool_use");
    assert.equal(bash.tool_call.name, "Bash");
    assert.equal(bash.tool_call.input.command, "cd /tmp/test && ls");
  });

  it("strips Codex metadata from tool output", () => {
    const turns = parseTranscript(CODEX_FIXTURE);
    const bash = turns[0].blocks.find((b) => b.kind === "tool_use");
    assert.equal(bash.tool_call.result, "file1.txt\nfile2.txt");
    assert.ok(!bash.tool_call.result.includes("Chunk ID"));
  });

  it("maps apply_patch Add File to Write with file_path and content", () => {
    const turns = parseTranscript(CODEX_FIXTURE);
    const write = turns[1].blocks.find((b) => b.kind === "tool_use");
    assert.equal(write.tool_call.name, "Write");
    assert.equal(write.tool_call.input.file_path, "/tmp/hello.txt");
    assert.equal(write.tool_call.input.content, "hello world");
  });

  it("maps apply_patch Update File to Edit with old_string and new_string", () => {
    const turns = parseTranscript(CODEX_FIXTURE);
    const edit = turns[2].blocks.find((b) => b.kind === "tool_use");
    assert.equal(edit.tool_call.name, "Edit");
    assert.equal(edit.tool_call.input.file_path, "/tmp/hello.txt");
    assert.equal(edit.tool_call.input.old_string, "hello world");
    assert.equal(edit.tool_call.input.new_string, "hello, world!");
  });

  it("attaches tool results with timestamps", () => {
    const turns = parseTranscript(CODEX_FIXTURE);
    const edit = turns[2].blocks.find((b) => b.kind === "tool_use");
    assert.equal(edit.tool_call.result, "Success.");
    assert.ok(edit.tool_call.resultTimestamp);
  });

  it("preserves timestamps on turns", () => {
    const turns = parseTranscript(CODEX_FIXTURE);
    assert.ok(turns[0].timestamp.startsWith("2026-03-13"));
  });
});

describe("GitHub Chat format", () => {
  it("detects github-chat format", () => {
    assert.equal(detectFormat(GITHUB_CHAT_BASIC_FIXTURE), "github-chat");
  });

  it("parses github-chat turns and filters empty ones", () => {
    const turns = parseTranscript(GITHUB_CHAT_BASIC_FIXTURE);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].index, 1);
    assert.equal(turns[0].user_text, "Create a dark mode toggle");
  });

  it("extracts thinking and text assistant blocks", () => {
    const turns = parseTranscript(GITHUB_CHAT_BASIC_FIXTURE);
    assert.equal(turns[0].blocks[0].kind, "thinking");
    assert.match(turns[0].blocks[0].text, /inspect current theme variables/);
    assert.equal(turns[0].blocks[1].kind, "text");
    assert.equal(turns[0].blocks[2].kind, "text");
  });

  it("pairs tool calls with results and ignores malformed/orphan lines", () => {
    const turns = parseTranscript(GITHUB_CHAT_TOOL_FIXTURE);
    assert.equal(turns.length, 1);
    const toolBlock = turns[0].blocks.find((b) => b.kind === "tool_use");
    assert.ok(toolBlock);
    assert.equal(toolBlock.tool_call.name, "Bash");
    assert.equal(toolBlock.tool_call.input.command, "ls src");
    assert.equal(toolBlock.tool_call.result, "parser.mjs\nrenderer.mjs");
    assert.equal(toolBlock.tool_call.resultTimestamp, "2026-03-13T11:00:04.000Z");
  });

  it("supports content arrays for user and tool_result blocks", () => {
    const turns = parseTranscript(GITHUB_CHAT_TOOL_FIXTURE);
    assert.equal(turns[0].user_text, "List the source files");

    const noTsTurns = parseTranscript(GITHUB_CHAT_NO_TS_FIXTURE);
    const toolBlock = noTsTurns[0].blocks.find((b) => b.kind === "tool_use");
    assert.equal(toolBlock.tool_call.name, "Read");
    assert.equal(toolBlock.tool_call.result, "# claude-replay");
  });

  it("leaves timestamps empty when the transcript does not include them", () => {
    const turns = parseTranscript(GITHUB_CHAT_NO_TS_FIXTURE);
    assert.equal(turns[0].timestamp, "");
    assert.equal(turns[0].blocks[0].timestamp, null);
  });

  it("works with paced timing fallback", () => {
    const turns = parseTranscript(GITHUB_CHAT_NO_TS_FIXTURE);
    applyPacedTiming(turns);
    assert.ok(turns[0].timestamp);
    assert.ok(turns[0].blocks[0].timestamp);
    const toolBlock = turns[0].blocks.find((b) => b.kind === "tool_use");
    assert.ok(toolBlock.tool_call.resultTimestamp);
  });

  it("parses VS Code patch-log sessions (kind 0/1/2)", () => {
    assert.equal(detectFormat(GITHUB_CHAT_VSCODE_PATCHLOG_FIXTURE), "github-chat");

    const turns = parseTranscript(GITHUB_CHAT_VSCODE_PATCHLOG_FIXTURE);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].user_text, "Check README");

    const kinds = turns[0].blocks.map((b) => b.kind);
    assert.deepEqual(kinds, ["text", "thinking", "tool_use", "tool_use", "tool_use", "text"]);

    const readTool = turns[0].blocks.find((b) => b.kind === "tool_use" && b.tool_call?.name === "Read");
    assert.ok(readTool);
    assert.match(readTool.tool_call.input.file_path, /README\.md$/);
    assert.equal(readTool.tool_call.result, "Read [](file:///c%3A/Users/test/Workspace/repo/README.md)");

    const bashTool = turns[0].blocks.find((b) => b.kind === "tool_use" && b.tool_call?.name === "Bash");
    assert.ok(bashTool);
    assert.equal(bashTool.tool_call.input.command, "npm test");
    assert.equal(bashTool.tool_call.input.language, "pwsh");
    assert.match(bashTool.tool_call.input.cwd, /repo$/);
    assert.equal(bashTool.tool_call.result, "Ran command `npm test`");

    const todoTool = turns[0].blocks.find((b) => b.kind === "tool_use" && b.tool_call?.input?.tool_id === "manage_todo_list");
    assert.ok(todoTool);
    assert.equal(todoTool.tool_call.input.invocation, "");
    assert.equal(todoTool.tool_call.input.todo_list.length, 2);
    assert.match(todoTool.tool_call.input.todo_summary, /completed: Audit markdown file-ref rendering/);
  });

  it("preserves VS Code inlineReference items inside assistant text", () => {
    const turns = parseTranscript(GITHUB_CHAT_VSCODE_INLINE_REF_FIXTURE);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].blocks.length, 1);
    assert.equal(turns[0].blocks[0].kind, "text");
    assert.match(turns[0].blocks[0].text, /inlineMarkdown/);
    assert.match(turns[0].blocks[0].text, /file:\/\/\/c%3A\/Users\/test\/Workspace\/repo\/template\/player\.html/);
    assert.match(turns[0].blocks[0].text, /file-ref/);
  });

  it("drops fence-only text artifacts emitted after VS Code Edit tool blocks", () => {
    const turns = parseTranscript(GITHUB_CHAT_VSCODE_EDIT_FENCE_FIXTURE);
    assert.equal(turns.length, 1);
    assert.deepEqual(turns[0].blocks.map((b) => b.kind), ["tool_use", "text"]);
    assert.equal(turns[0].blocks[0].tool_call?.name, "Edit");
    assert.equal(turns[0].blocks[1].text, "Correctif appliqué.");
  });
});

describe("applyPacedTiming", () => {
  it("generates ordered synthetic timestamps", () => {
    const turns = parseTranscript(PACED_FIXTURE);
    applyPacedTiming(turns);
    assert.ok(turns[0].timestamp, "turn should have a timestamp");
    assert.ok(turns[0].blocks[0].timestamp, "block should have a timestamp");
    const t0 = new Date(turns[0].timestamp).getTime();
    const t1 = new Date(turns[1].timestamp).getTime();
    assert.ok(t1 > t0, "turn 2 timestamp should be after turn 1");
  });

  it("scales duration with content length", () => {
    const turns = parseTranscript(PACED_FIXTURE);
    applyPacedTiming(turns);
    const gap0 = new Date(turns[0].blocks[0].timestamp).getTime() - new Date(turns[0].timestamp).getTime();
    const gap1 = new Date(turns[1].blocks[0].timestamp).getTime() - new Date(turns[1].timestamp).getTime();
    // Both gaps should be the same (500ms user→assistant pause)
    assert.equal(gap0, gap1);
  });

  it("works on Claude Code transcripts too", () => {
    const turns = parseTranscript(FIXTURE);
    const origTs = turns[0].timestamp;
    applyPacedTiming(turns);
    // Should overwrite real timestamps
    assert.notEqual(turns[0].timestamp, origTs);
  });
});

describe("cleanSystemTags", () => {
  it("strips multiple system-reminder blocks from user text", () => {
    const turns = parseTranscript(SYSTEM_TAGS_FIXTURE);
    assert.equal(turns[0].user_text, "Before reminder\nAfter reminder");
  });

  it("strips ide_opened_file tags", () => {
    const turns = parseTranscript(SYSTEM_TAGS_FIXTURE);
    assert.equal(turns[1].user_text, "Check this\nPlease review");
  });

  it("extracts command-name and keeps non-empty command-args", () => {
    const turns = parseTranscript(SYSTEM_TAGS_FIXTURE);
    assert.match(turns[2].user_text, /review/);
    assert.match(turns[2].user_text, /src\/main\.ts/);
  });

  it("removes empty command-args tags", () => {
    const turns = parseTranscript(SYSTEM_TAGS_FIXTURE);
    // Turn 4 (mixed tags) has empty command-args — should not appear
    assert.ok(!turns[4].user_text.includes("command-args"));
  });

  it("strips local-command-caveat and local-command-stdout", () => {
    const turns = parseTranscript(SYSTEM_TAGS_FIXTURE);
    assert.equal(turns[3].user_text, "Run this");
  });

  it("handles mixed tags in one message", () => {
    const turns = parseTranscript(SYSTEM_TAGS_FIXTURE);
    const text = turns[4].user_text;
    // Should not contain any tag artifacts
    assert.ok(!text.includes("<system-reminder>"));
    assert.ok(!text.includes("<ide_opened_file>"));
    assert.ok(!text.includes("<local-command-caveat>"));
    assert.ok(!text.includes("<local-command-stdout>"));
    // Should contain the extracted command name and actual user text
    assert.match(text, /deploy/);
    assert.match(text, /Actual user message/);
  });
});

describe("parseCodexPatch", () => {
  it("handles patch with context lines", () => {
    const turns = parseTranscript(CODEX_PATCH_FIXTURE);
    const edit = turns[0].blocks.find((b) => b.kind === "tool_use");
    assert.equal(edit.tool_call.name, "Edit");
    assert.equal(edit.tool_call.input.file_path, "/src/app.js");
    // Context lines appear in both old and new strings
    assert.match(edit.tool_call.input.old_string, /const x = 1;/);
    assert.match(edit.tool_call.input.old_string, /const y = 2;/);
    assert.match(edit.tool_call.input.old_string, /const z = 4;/);
    assert.match(edit.tool_call.input.new_string, /const x = 1;/);
    assert.match(edit.tool_call.input.new_string, /const y = 3;/);
    assert.match(edit.tool_call.input.new_string, /const z = 4;/);
  });

  it("handles empty patch (just Begin/End markers)", () => {
    const turns = parseTranscript(CODEX_PATCH_FIXTURE);
    const tool = turns[1].blocks.find((b) => b.kind === "tool_use");
    // Empty patch produces Edit with empty file_path and empty strings
    assert.equal(tool.tool_call.input.file_path, "");
    assert.equal(tool.tool_call.input.old_string, "");
    assert.equal(tool.tool_call.input.new_string, "");
  });

  it("handles multiple files via separate tool calls in one turn", () => {
    const turns = parseTranscript(CODEX_PATCH_FIXTURE);
    const toolBlocks = turns[2].blocks.filter((b) => b.kind === "tool_use");
    assert.equal(toolBlocks.length, 2);
    // First is a Write (Add File)
    assert.equal(toolBlocks[0].tool_call.name, "Write");
    assert.equal(toolBlocks[0].tool_call.input.file_path, "/src/new.js");
    // Second is an Edit (Update File)
    assert.equal(toolBlocks[1].tool_call.name, "Edit");
    assert.equal(toolBlocks[1].tool_call.input.file_path, "/src/old.js");
  });
});

describe("Codex edge cases", () => {
  it("handles session that ends without task_complete (truncated)", () => {
    const turns = parseTranscript(CODEX_EDGES_FIXTURE);
    // Last turn has no task_complete — should still be captured
    const truncated = turns.find((t) => t.user_text === "truncated session");
    assert.ok(truncated, "truncated turn should be captured");
    assert.ok(truncated.blocks.length > 0);
  });

  it("handles tool call with no result (pending)", () => {
    const turns = parseTranscript(CODEX_EDGES_FIXTURE);
    const pendingTurn = turns.find((t) => t.user_text === "pending tool call");
    assert.ok(pendingTurn, "should find the pending tool call turn");
    const toolBlock = pendingTurn.blocks.find((b) => b.kind === "tool_use");
    assert.ok(toolBlock, "should have a tool_use block");
    assert.equal(toolBlock.tool_call.name, "Bash");
    assert.equal(toolBlock.tool_call.result, null);
  });

  it("uses full text when 'My request for Codex:' marker is absent", () => {
    const turns = parseTranscript(CODEX_EDGES_FIXTURE);
    const noMarker = turns.find((t) => t.user_text === "Just do something without the marker");
    assert.ok(noMarker, "should find turn with full text as user_text");
  });

  it("captures multiple commentary blocks in one turn as thinking", () => {
    const turns = parseTranscript(CODEX_EDGES_FIXTURE);
    const multiTurn = turns.find((t) => t.user_text === "multiple commentary blocks");
    assert.ok(multiTurn, "should find the multi-commentary turn");
    const thinking = multiTurn.blocks.filter((b) => b.kind === "thinking");
    assert.equal(thinking.length, 3);
    assert.equal(thinking[0].text, "First thought.");
    assert.equal(thinking[1].text, "Second thought.");
    assert.equal(thinking[2].text, "Third thought.");
    const text = multiTurn.blocks.filter((b) => b.kind === "text");
    assert.equal(text.length, 1);
    assert.equal(text[0].text, "Final answer here.");
  });
});
