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

  it("embeds turns as compressed base64 by default", () => {
    const html = render(SAMPLE_TURNS, { minified: false });
    // Data is deflate+base64 compressed, not raw JSON
    assert.match(html, /await decodeData\("/);
    assert.doesNotMatch(html, /"user_text":"Hello"/);
  });

  it("embeds raw JSON with compress=false", () => {
    const html = render(SAMPLE_TURNS, { minified: false, compress: false });
    // Quotes are escaped for safe embedding in JS string literals
    assert.match(html, /\\"user_text\\":\\"Hello\\"/);
    assert.match(html, /\\"name\\":\\"Read\\"/);
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

  it("applies custom redact rules", () => {
    const html = render(SAMPLE_TURNS, {
      minified: false, compress: false, redactSecrets: false,
      redactRules: [{ search: "/tmp/x", replacement: "/safe/path" }],
    });
    assert.match(html, /\/safe\/path/);
    assert.doesNotMatch(html, /\/tmp\/x/);
  });

  it("redacts with default [REDACTED] replacement", () => {
    const html = render(SAMPLE_TURNS, {
      minified: false, compress: false, redactSecrets: false,
      redactRules: [{ search: "Hello", replacement: "[REDACTED]" }],
    });
    assert.doesNotMatch(html, /"user_text":"Hello"/);
    assert.match(html, /\[REDACTED\]/);
  });

  it("custom redact works with auto-redact disabled", () => {
    const turns = [
      {
        index: 1,
        user_text: "my key is sk-abc12345678901234567890",
        blocks: [{ kind: "text", text: "Hello from /Users/jdoe/project", tool_call: null }],
        timestamp: "2025-06-01T10:00:00Z",
      },
    ];
    const html = render(turns, {
      minified: false, compress: false,
      redactSecrets: false,
      redactRules: [{ search: "jdoe", replacement: "anonymous" }],
    });
    // Auto-redact disabled: secret key should survive
    assert.match(html, /sk-abc12345678901234567890/);
    // Custom redact still applied
    assert.match(html, /anonymous/);
    assert.doesNotMatch(html, /jdoe/);
  });

  it("renders custom title and labels", () => {
    const html = render(SAMPLE_TURNS, {
      minified: false,
      title: "My Custom Title",
      userLabel: "Developer",
      assistantLabel: "Bot",
    });
    assert.match(html, /<title>My Custom Title<\/title>/);
    assert.match(html, /My Custom Title/);
    assert.match(html, /Developer/);
    assert.match(html, /Bot/);
  });

  it("embeds bookmarks in output", () => {
    const bookmarks = [
      { turn: 1, label: "Start here" },
      { turn: 2, label: "Tool usage" },
    ];
    const html = render(SAMPLE_TURNS, { minified: false, compress: false, bookmarks });
    assert.match(html, /Start here/);
    assert.match(html, /Tool usage/);
  });

  it("renders description and OG image meta tags", () => {
    const html = render(SAMPLE_TURNS, {
      minified: false,
      description: "A fascinating session",
      ogImage: "https://example.com/preview.png",
    });
    assert.match(html, /A fascinating session/);
    assert.match(html, /https:\/\/example\.com\/preview\.png/);
    assert.match(html, /<meta property="og:description" content="A fascinating session">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/example\.com\/preview\.png">/);
  });

  it("respects showToolCalls=false", () => {
    const html = render(SAMPLE_TURNS, { showToolCalls: false, minified: false });
    // The tools checkbox should NOT have "checked"
    assert.match(html, /id="toggle-tools" >/);
  });

  it("respects showToolCalls=true", () => {
    const html = render(SAMPLE_TURNS, { showToolCalls: true, minified: false });
    assert.match(html, /id="toggle-tools" checked>/);
  });

  it("has no leftover placeholders", () => {
    const html = render(SAMPLE_TURNS, { minified: false });
    assert.doesNotMatch(html, /\/\*THEME_CSS\*\//);
    assert.doesNotMatch(html, /\/\*THEME_BG\*\//);
    assert.doesNotMatch(html, /\/\*TURNS_DATA\*\//);
    assert.doesNotMatch(html, /\/\*BOOKMARKS_DATA\*\//);
    assert.doesNotMatch(html, /\/\*CHECKED_THINKING\*\//);
    assert.doesNotMatch(html, /\/\*CHECKED_TOOLS\*\//);
    assert.doesNotMatch(html, /\/\*PAGE_DESCRIPTION\*\//);
    assert.doesNotMatch(html, /\/\*OG_IMAGE\*\//);
  });
});
