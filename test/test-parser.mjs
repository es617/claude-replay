import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTranscript, filterTurns, detectFormat, applyPacedTiming } from "../src/parser.mjs";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FIXTURE = new URL("./fixture.jsonl", import.meta.url).pathname;
const CURSOR_FIXTURE = new URL("./fixture-cursor.jsonl", import.meta.url).pathname;
const CODEX_FIXTURE = new URL("./fixture-codex.jsonl", import.meta.url).pathname;
const PACED_FIXTURE = new URL("./fixture-paced.jsonl", import.meta.url).pathname;
const SYSTEM_TAGS_FIXTURE = new URL("./fixture-system-tags.jsonl", import.meta.url).pathname;
const CODEX_PATCH_FIXTURE = new URL("./fixture-codex-patch.jsonl", import.meta.url).pathname;
const CODEX_EDGES_FIXTURE = new URL("./fixture-codex-edges.jsonl", import.meta.url).pathname;
const GEMINI_FIXTURE = new URL("./fixture-gemini.json", import.meta.url).pathname;
const OPENCODE_FIXTURE = new URL("./fixture-opencode.jsonl", import.meta.url).pathname;

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

describe("Replay JSONL format", () => {
  const replayLines = [
    JSON.stringify({ index: 1, user_text: "Hello", blocks: [{ kind: "text", text: "Hi!" }], timestamp: "2025-01-01T00:00:00Z" }),
    JSON.stringify({ index: 2, user_text: "Bye", blocks: [{ kind: "text", text: "Goodbye" }], timestamp: "2025-01-01T00:01:00Z", bookmark: "End" }),
  ];
  let tmpFile;

  it("detectFormat identifies replay format", () => {
    tmpFile = join(tmpdir(), `replay-test-${process.pid}.jsonl`);
    writeFileSync(tmpFile, replayLines.join("\n"));
    assert.equal(detectFormat(tmpFile), "replay");
  });

  it("parseTranscript reads replay JSONL turns", () => {
    const turns = parseTranscript(tmpFile);
    assert.equal(turns.length, 2);
    assert.equal(turns[0].user_text, "Hello");
    assert.equal(turns[0].blocks[0].text, "Hi!");
    assert.equal(turns[1].user_text, "Bye");
  });

  it("preserves bookmark field on turns", () => {
    const turns = parseTranscript(tmpFile);
    assert.equal(turns[1].bookmark, "End");
    assert.equal(turns[0].bookmark, undefined);
    try { unlinkSync(tmpFile); } catch {}
  });

  it("does not confuse replay format with claude-code", () => {
    const claudeLine = JSON.stringify({ type: "user", message: { role: "user", content: "hi" } });
    const tmp = join(tmpdir(), `detect-test-${process.pid}.jsonl`);
    writeFileSync(tmp, claudeLine);
    assert.equal(detectFormat(tmp), "claude-code");
    try { unlinkSync(tmp); } catch {}
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

describe("Gemini format", () => {
  it("detects gemini format", () => {
    assert.equal(detectFormat(GEMINI_FIXTURE), "gemini");
  });

  it("does not confuse gemini with claude-code", () => {
    assert.equal(detectFormat(FIXTURE), "claude-code");
  });

  it("parses turns from Gemini session", () => {
    const turns = parseTranscript(GEMINI_FIXTURE);
    // Fixture has 4 user messages → 4 turns
    assert.equal(turns.length, 4);
  });

  it("extracts user text", () => {
    const turns = parseTranscript(GEMINI_FIXTURE);
    assert.equal(turns[0].user_text, "What files are in the current directory?");
    assert.equal(turns[1].user_text, "Read the README.md file");
    assert.equal(turns[2].user_text, "Thanks!");
    assert.equal(turns[3].user_text, "Run a failing command");
  });

  it("extracts thoughts as thinking blocks with subject", () => {
    const turns = parseTranscript(GEMINI_FIXTURE);
    const thinking = turns[0].blocks.filter((b) => b.kind === "thinking");
    assert.equal(thinking.length, 2);
    assert.match(thinking[0].text, /Analyzing Request/);
    assert.match(thinking[0].text, /directory contents/);
    assert.match(thinking[1].text, /Choosing Tool/);
  });

  it("maps run_shell_command to Bash", () => {
    const turns = parseTranscript(GEMINI_FIXTURE);
    const tool = turns[0].blocks.find((b) => b.kind === "tool_use");
    assert.ok(tool, "should have a tool_use block");
    assert.equal(tool.tool_call.name, "Bash");
    assert.equal(tool.tool_call.input.command, "ls -la");
  });

  it("maps read_file to Read", () => {
    const turns = parseTranscript(GEMINI_FIXTURE);
    const tool = turns[1].blocks.find((b) => b.kind === "tool_use");
    assert.ok(tool, "should have a tool_use block");
    assert.equal(tool.tool_call.name, "Read");
  });

  it("extracts tool results from nested functionResponse", () => {
    const turns = parseTranscript(GEMINI_FIXTURE);
    const tool = turns[0].blocks.find((b) => b.kind === "tool_use");
    assert.ok(tool.tool_call.result, "should have a result");
    assert.match(tool.tool_call.result, /README\.md/);
    assert.match(tool.tool_call.result, /package\.json/);
  });

  it("handles empty content with toolCalls (turn 2)", () => {
    const turns = parseTranscript(GEMINI_FIXTURE);
    // Turn 2: first gemini message has empty content + toolCall, second has text + thought
    const toolBlocks = turns[1].blocks.filter((b) => b.kind === "tool_use");
    assert.equal(toolBlocks.length, 1);
    const textBlocks = turns[1].blocks.filter((b) => b.kind === "text");
    assert.ok(textBlocks.length >= 1, "should have text from follow-up gemini message");
    assert.match(textBlocks[0].text, /README\.md contains/);
  });

  it("handles empty thoughts array", () => {
    const turns = parseTranscript(GEMINI_FIXTURE);
    // Turn 3 (Thanks!) has no thoughts
    const thinking = turns[2].blocks.filter((b) => b.kind === "thinking");
    assert.equal(thinking.length, 0);
  });

  it("marks error tool calls", () => {
    const turns = parseTranscript(GEMINI_FIXTURE);
    const tool = turns[3].blocks.find((b) => b.kind === "tool_use");
    assert.ok(tool, "should have a tool_use block");
    assert.equal(tool.tool_call.is_error, true);
  });

  it("preserves timestamps", () => {
    const turns = parseTranscript(GEMINI_FIXTURE);
    assert.equal(turns[0].timestamp, "2026-03-01T10:00:00.000Z");
  });

  it("assigns sequential turn indices", () => {
    const turns = parseTranscript(GEMINI_FIXTURE);
    assert.deepEqual(
      turns.map((t) => t.index),
      [1, 2, 3, 4]
    );
  });
});

describe("OpenCode format", () => {
  it("detects opencode format", () => {
    assert.equal(detectFormat(OPENCODE_FIXTURE), "opencode");
  });

  it("does not confuse opencode with claude-code", () => {
    assert.equal(detectFormat(FIXTURE), "claude-code");
  });

  it("does not confuse opencode with codex", () => {
    assert.equal(detectFormat(CODEX_FIXTURE), "codex");
  });

  it("parses turns from OpenCode session", () => {
    const turns = parseTranscript(OPENCODE_FIXTURE);
    // Fixture has 2 "stop" step_finish boundaries → 2 turns
    // Turn 1: write + bash + text (fibonacci)
    // Turn 2: error bash + text (file not found)
    assert.equal(turns.length, 2);
  });

  it("maps write tool to Write with normalized input", () => {
    const turns = parseTranscript(OPENCODE_FIXTURE);
    const write = turns[0].blocks.find((b) => b.kind === "tool_use" && b.tool_call.name === "Write");
    assert.ok(write, "should have a Write tool_use block");
    assert.equal(write.tool_call.input.file_path, "/tmp/test/fib.py");
    assert.match(write.tool_call.input.content, /def fib/);
    assert.equal(write.tool_call.result, "Wrote file successfully.");
  });

  it("maps bash tool to Bash with normalized input", () => {
    const turns = parseTranscript(OPENCODE_FIXTURE);
    const bash = turns[0].blocks.find((b) => b.kind === "tool_use" && b.tool_call.name === "Bash");
    assert.ok(bash, "should have a Bash tool_use block");
    assert.equal(bash.tool_call.input.command, "cd /tmp/test && python3 fib.py");
    assert.equal(bash.tool_call.result, "55\n");
    assert.equal(bash.tool_call.is_error, false);
  });

  it("extracts reasoning as thinking blocks", () => {
    const turns = parseTranscript(OPENCODE_FIXTURE);
    const thinking = turns[0].blocks.filter((b) => b.kind === "thinking");
    assert.equal(thinking.length, 1);
    assert.match(thinking[0].text, /output 55/);
  });

  it("extracts text blocks", () => {
    const turns = parseTranscript(OPENCODE_FIXTURE);
    const text = turns[0].blocks.filter((b) => b.kind === "text");
    assert.equal(text.length, 1);
    assert.match(text[0].text, /Fibonacci/);
  });

  it("marks error tool calls", () => {
    const turns = parseTranscript(OPENCODE_FIXTURE);
    const errorBash = turns[1].blocks.find((b) => b.kind === "tool_use");
    assert.ok(errorBash, "should have an error tool_use block");
    assert.equal(errorBash.tool_call.is_error, true);
    assert.match(errorBash.tool_call.result, /No such file/);
  });

  it("preserves timestamps as ISO strings", () => {
    const turns = parseTranscript(OPENCODE_FIXTURE);
    assert.ok(turns[0].timestamp, "should have a timestamp");
    // Timestamps are epoch → ISO
    assert.match(turns[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("assigns sequential turn indices", () => {
    const turns = parseTranscript(OPENCODE_FIXTURE);
    assert.deepEqual(
      turns.map((t) => t.index),
      [1, 2]
    );
  });

  it("groups tool calls, thinking, and text in same turn", () => {
    const turns = parseTranscript(OPENCODE_FIXTURE);
    // Turn 1 should have: write + bash + thinking + text = 4 blocks
    assert.equal(turns[0].blocks.length, 4);
    assert.equal(turns[0].blocks[0].kind, "tool_use");
    assert.equal(turns[0].blocks[1].kind, "tool_use");
    assert.equal(turns[0].blocks[2].kind, "thinking");
    assert.equal(turns[0].blocks[3].kind, "text");
  });
});
