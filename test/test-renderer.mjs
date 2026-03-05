import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { render } from "../src/renderer.mjs";
import { getTheme } from "../src/themes.mjs";

const SAMPLE_TURNS = [
  {
    index: 1,
    user_text: "Hello",
    blocks: [{ kind: "text", text: "Hi there!", tool_call: null }],
    timestamp: "2025-06-01T10:00:00Z",
  },
  {
    index: 2,
    user_text: "Use a tool",
    blocks: [
      {
        kind: "tool_use",
        text: "",
        tool_call: { name: "Read", input: { file_path: "/tmp/x" }, result: "contents" },
      },
    ],
    timestamp: "2025-06-01T10:01:00Z",
  },
];

describe("render", () => {
  it("produces valid HTML", () => {
    const html = render(SAMPLE_TURNS, { minified: false });
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /<\/html>/);
  });

  it("embeds turns as JSON", () => {
    const html = render(SAMPLE_TURNS, { minified: false });
    assert.match(html, /"user_text":"Hello"/);
    assert.match(html, /"name":"Read"/);
  });

  it("injects theme CSS", () => {
    const html = render(SAMPLE_TURNS, { theme: getTheme("dracula"), minified: false });
    assert.match(html, /--bg: #282a36/);
  });

  it("sets initial speed", () => {
    const html = render(SAMPLE_TURNS, { speed: 2.5, minified: false });
    assert.match(html, /2\.5x/);
  });

  it("respects showThinking=false", () => {
    const html = render(SAMPLE_TURNS, { showThinking: false, minified: false });
    // The thinking checkbox should NOT have "checked"
    assert.match(html, /id="toggle-thinking" >/);
  });

  it("respects showThinking=true", () => {
    const html = render(SAMPLE_TURNS, { showThinking: true, minified: false });
    assert.match(html, /id="toggle-thinking" checked>/);
  });

  it("has no leftover placeholders", () => {
    const html = render(SAMPLE_TURNS, { minified: false });
    assert.doesNotMatch(html, /\/\*THEME_CSS\*\//);
    assert.doesNotMatch(html, /\/\*TURNS_JSON\*\//);
    assert.doesNotMatch(html, /\/\*CHECKED_THINKING\*\//);
    assert.doesNotMatch(html, /\/\*CHECKED_TOOLS\*\//);
  });
});
