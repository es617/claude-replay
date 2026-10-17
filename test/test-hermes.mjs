import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTranscriptFromText, detectFormatFromText } from "../src/parser.mjs";
import { readFileSync } from "node:fs";

const HERMES_FIXTURE = new URL("./fixture-hermes.json", import.meta.url).pathname;

describe("hermes", () => {
  it("detects hermes export format", () => {
    const text = readFileSync(HERMES_FIXTURE, "utf-8");
    assert.equal(detectFormatFromText(text), "hermes");
  });

  it("parses turns from hermes export", () => {
    const text = readFileSync(HERMES_FIXTURE, "utf-8");
    const turns = parseTranscriptFromText(text);
    assert.equal(turns.length, 2);
  });

  it("preserves the session model on each response", () => {
    const text = readFileSync(HERMES_FIXTURE, "utf-8");
    const turns = parseTranscriptFromText(text);
    assert.deepEqual(turns.map((turn) => turn.response?.model), ["test-model", "test-model"]);
  });

  it("turns have required fields", () => {
    const text = readFileSync(HERMES_FIXTURE, "utf-8");
    const turns = parseTranscriptFromText(text);
    for (const t of turns) {
      assert.equal(typeof t.index, "number");
      assert.equal(typeof t.user_text, "string");
      assert.ok(Array.isArray(t.blocks));
      assert.equal(typeof t.timestamp, "string");
    }
  });

  it("round-trips tool call and result", () => {
    const text = readFileSync(HERMES_FIXTURE, "utf-8");
    const turns = parseTranscriptFromText(text);
    const tool = turns[0].blocks.find((b) => b.kind === "tool_use");
    assert.ok(tool, "expected a tool_use block");
    assert.equal(tool.tool_call.name, "Bash");
    assert.equal(tool.tool_call.result, "file.txt");
  });

  it("preserves thinking blocks", () => {
    const text = readFileSync(HERMES_FIXTURE, "utf-8");
    const turns = parseTranscriptFromText(text);
    const thinking = turns[0].blocks.filter((b) => b.kind === "thinking");
    assert.equal(thinking.length, 1);
    assert.match(thinking[0].text, /thinking about ls/);
  });
});
