import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseTranscript, filterTurns, detectFormat, applyPacedTiming } from "../src/parser.mjs";

const FIXTURE = new URL("./fixture.jsonl", import.meta.url).pathname;

/** Write lines to a temp JSONL file and return the path. */
function writeTempJsonl(lines) {
  const dir = mkdtempSync(join(tmpdir(), "parser-test-"));
  const path = join(dir, "test.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
  return path;
}

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
  const CURSOR_FIXTURE = writeTempJsonl([
    { role: "user", message: { content: [{ type: "text", text: "<user_query>\nscan for ble devices\n</user_query>" }] } },
    { role: "assistant", message: { content: [{ type: "text", text: "**Planning scan**\n\nI'll scan for nearby BLE devices." }] } },
    { role: "assistant", message: { content: [{ type: "text", text: "Found 3 devices nearby." }] } },
    { role: "user", message: { content: [{ type: "text", text: "<user_query>\nconnect to the first one\n</user_query>" }] } },
    { role: "assistant", message: { content: [{ type: "text", text: "Connected successfully." }] } },
  ]);

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

describe("applyPacedTiming", () => {
  const PACED_FIXTURE = writeTempJsonl([
    { role: "user", message: { content: [{ type: "text", text: "hello" }] } },
    { role: "assistant", message: { content: [{ type: "text", text: "short reply" }] } },
    { role: "user", message: { content: [{ type: "text", text: "more" }] } },
    { role: "assistant", message: { content: [{ type: "text", text: "a longer reply with more content to test proportional timing" }] } },
  ]);

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
