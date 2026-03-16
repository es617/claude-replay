import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractData } from "../src/extract.mjs";
import { render } from "../src/renderer.mjs";

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
        tool_call: {
          name: "Read",
          input: { file_path: "/tmp/x" },
          result: "contents",
          is_error: false,
        },
      },
    ],
    timestamp: "2025-06-01T10:01:00Z",
  },
];

const SAMPLE_BOOKMARKS = [
  { turn: 1, label: "Start" },
  { turn: 2, label: "Tool usage" },
];

describe("extract", () => {
  it("extracts turns from compressed HTML", () => {
    const html = render(SAMPLE_TURNS, { minified: false, redactSecrets: false });
    const data = extractData(html);
    assert.equal(data.turns.length, 2);
    assert.equal(data.turns[0].user_text, "Hello");
    assert.equal(data.turns[1].blocks[0].tool_call.name, "Read");
  });

  it("extracts turns from uncompressed HTML", () => {
    const html = render(SAMPLE_TURNS, { minified: false, compress: false, redactSecrets: false });
    const data = extractData(html);
    assert.equal(data.turns.length, 2);
    assert.equal(data.turns[0].user_text, "Hello");
  });

  it("extracts bookmarks", () => {
    const html = render(SAMPLE_TURNS, {
      minified: false,
      redactSecrets: false,
      bookmarks: SAMPLE_BOOKMARKS,
    });
    const data = extractData(html);
    assert.equal(data.bookmarks.length, 2);
    assert.equal(data.bookmarks[0].label, "Start");
    assert.equal(data.bookmarks[1].turn, 2);
  });

  it("roundtrip: extract then re-render produces identical HTML", () => {
    const opts = {
      minified: false,
      redactSecrets: false,
      bookmarks: SAMPLE_BOOKMARKS,
      title: "Roundtrip Test",
    };
    const html1 = render(SAMPLE_TURNS, opts);
    const data = extractData(html1);
    const html2 = render(data.turns, { ...opts, bookmarks: data.bookmarks });
    assert.equal(html1, html2);
  });

  it("roundtrip: uncompressed extract then re-render produces identical HTML", () => {
    const opts = {
      minified: false,
      compress: false,
      redactSecrets: false,
      bookmarks: SAMPLE_BOOKMARKS,
      title: "Roundtrip Uncompressed",
    };
    const html1 = render(SAMPLE_TURNS, opts);
    const data = extractData(html1);
    const html2 = render(data.turns, { ...opts, bookmarks: data.bookmarks });
    assert.equal(html1, html2);
  });

  it("roundtrip handles quotes, backslashes, and newlines in uncompressed mode", () => {
    const tricky = [
      {
        index: 1,
        user_text: 'He said "hello\\world"\nand then\r\nleft',
        blocks: [
          {
            kind: "text",
            text: 'Path is C:\\Users\\test and <script></script>',
            tool_call: null,
          },
          {
            kind: "tool_use",
            text: "",
            tool_call: {
              name: "Read",
              input: { file_path: '/tmp/"quoted"' },
              result: '<!-- comment -->\nline2</script>',
              is_error: false,
            },
          },
        ],
        timestamp: "2025-06-01T10:00:00Z",
      },
    ];
    const html = render(tricky, { minified: false, compress: false, redactSecrets: false });
    const data = extractData(html);
    assert.equal(data.turns.length, 1);
    assert.equal(data.turns[0].user_text, tricky[0].user_text);
    assert.equal(data.turns[0].blocks[0].text, tricky[0].blocks[0].text);
    assert.equal(data.turns[0].blocks[1].tool_call.result, tricky[0].blocks[1].tool_call.result);
    assert.equal(data.turns[0].blocks[1].tool_call.input.file_path, '/tmp/"quoted"');
  });

  it("extracts turns from minified compressed HTML", () => {
    const html = render(SAMPLE_TURNS, { minified: true, redactSecrets: false });
    const data = extractData(html);
    assert.equal(data.turns.length, 2);
    assert.equal(data.turns[0].user_text, "Hello");
  });

  it("extracts turns from minified uncompressed HTML", () => {
    const html = render(SAMPLE_TURNS, { minified: true, compress: false, redactSecrets: false });
    const data = extractData(html);
    assert.equal(data.turns.length, 2);
    assert.equal(data.turns[0].user_text, "Hello");
  });

  it("throws on invalid HTML", () => {
    assert.throws(() => extractData("<html><body>no data</body></html>"), {
      message: /Could not find data blobs/,
    });
  });
});
