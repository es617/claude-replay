import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { render } from "../src/renderer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, "e2e", "fixture.jsonl");
const HELPER_PATH = join(tmpdir(), `editor-test-helper-${process.pid}.mjs`);

let baseUrl;

describe("editor-server API", () => {
  let child;

  before(async () => {
    const port = 10000 + Math.floor(Math.random() * 50000);
    baseUrl = `http://127.0.0.1:${port}`;

    const srcPath = resolve(__dirname, "..", "src", "editor-server.mjs").replace(/\\/g, "/");
    writeFileSync(
      HELPER_PATH,
      `import { startEditor } from "${srcPath}";\nstartEditor(${port}, { open: false });\n`,
    );

    child = spawn(process.execPath, [HELPER_PATH], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise((res, rej) => {
      let output = "";
      const timeout = setTimeout(() => rej(new Error("Server did not start in time")), 10000);
      child.stdout.on("data", (data) => {
        output += data.toString();
        if (output.includes("running at")) {
          clearTimeout(timeout);
          res();
        }
      });
      child.stderr.on("data", (data) => {
        output += data.toString();
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        rej(new Error(`Server exited with code ${code}: ${output}`));
      });
    });
  });

  after(() => {
    if (child) child.kill();
    try { unlinkSync(HELPER_PATH); } catch { /* ignore */ }
  });

  it("GET /api/sessions returns groups array", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.groups));
    assert.ok(typeof data.homedir === "string");
  });

  it("GET /api/themes returns theme list", async () => {
    const res = await fetch(`${baseUrl}/api/themes`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data));
    assert.ok(data.length > 0);
    assert.ok(typeof data[0] === "string");
  });

  it("POST /api/load with fixture path returns turns", async () => {
    const res = await fetch(`${baseUrl}/api/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: FIXTURE_PATH }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.sessionId);
    assert.ok(Array.isArray(data.turns));
    assert.ok(data.turns.length > 0);
    assert.equal(data.hasEdits, false);
    assert.ok(data.format);
  });

  it("POST /api/load with non-existent path returns error", async () => {
    const res = await fetch(`${baseUrl}/api/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: resolve(homedir(), "nonexistent-file-abc123.jsonl") }),
    });
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.ok(data.error);
  });

  it("POST /api/edit updates user text and reports hasEdits=true", async () => {
    const loadRes = await fetch(`${baseUrl}/api/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: FIXTURE_PATH }),
    });
    const loadData = await loadRes.json();
    const sid = loadData.sessionId;
    const turnIndex = loadData.turns[0].index;

    const res = await fetch(`${baseUrl}/api/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, turnIndex, user_text: "Edited text" }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.hasEdits, true);
  });

  it("POST /api/reset restores original turns", async () => {
    const loadRes = await fetch(`${baseUrl}/api/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: FIXTURE_PATH }),
    });
    const loadData = await loadRes.json();
    const sid = loadData.sessionId;

    const res = await fetch(`${baseUrl}/api/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.turns));
    assert.notEqual(data.turns[0].user_text, "Edited text");
  });

  it("POST /api/preview returns HTML string", async () => {
    const loadRes = await fetch(`${baseUrl}/api/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: FIXTURE_PATH }),
    });
    const loadData = await loadRes.json();
    const sid = loadData.sessionId;

    const res = await fetch(`${baseUrl}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, options: {} }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.html === "string");
    assert.match(data.html, /<!DOCTYPE html>/);
  });

  it("POST /api/export returns HTML with Content-Disposition header", async () => {
    const loadRes = await fetch(`${baseUrl}/api/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: FIXTURE_PATH }),
    });
    const loadData = await loadRes.json();
    const sid = loadData.sessionId;

    const res = await fetch(`${baseUrl}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid, options: { title: "test-export" } }),
    });
    assert.equal(res.status, 200);
    const disposition = res.headers.get("content-disposition");
    assert.ok(disposition);
    assert.match(disposition, /attachment/);
    assert.match(disposition, /test-export\.html/);
    const html = await res.text();
    assert.match(html, /<!DOCTYPE html>/);
  });

  it("POST /api/export-data returns JSON with turns and bookmarks", async () => {
    const loadRes = await fetch(`${baseUrl}/api/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: FIXTURE_PATH }),
    });
    const loadData = await loadRes.json();
    const sid = loadData.sessionId;

    const res = await fetch(`${baseUrl}/api/export-data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sid,
        options: { title: "test-data", bookmarks: [{ turn: 1, label: "Ch1" }] },
      }),
    });
    assert.equal(res.status, 200);
    const disposition = res.headers.get("content-disposition");
    assert.match(disposition, /test-data\.json/);
    const data = JSON.parse(await res.text());
    assert.ok(Array.isArray(data.turns));
    assert.ok(data.turns.length > 0);
    assert.equal(data.turns[0].user_text, loadData.turns[0].user_text);
    assert.ok(Array.isArray(data.bookmarks));
    assert.equal(data.bookmarks[0].label, "Ch1");
  });

  it("POST /api/browse with valid directory returns dirs and files", async () => {
    const res = await fetch(`${baseUrl}/api/browse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: resolve(__dirname, "e2e") }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data.path === "string");
    assert.ok(Array.isArray(data.dirs));
    assert.ok(Array.isArray(data.files));
    const fileNames = data.files.map((f) => f.name);
    assert.ok(fileNames.includes("fixture.jsonl"));
  });

  it("POST /api/browse with non-existent path returns error", async () => {
    const res = await fetch(`${baseUrl}/api/browse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: join(homedir(), "nonexistent-dir-xyz789") }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  });

  it("POST /api/browse rejects paths outside home directory", async () => {
    const res = await fetch(`${baseUrl}/api/browse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/etc" }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /Permission denied/);
  });

  it("POST /api/load rejects paths outside home directory", async () => {
    const res = await fetch(`${baseUrl}/api/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/etc/passwd" }),
    });
    assert.equal(res.status, 500);
    const data = await res.json();
    assert.match(data.error, /home directory/);
  });

  it("POST /api/preview remaps bookmark indices after excluding turns", async () => {
    const loadRes = await fetch(`${baseUrl}/api/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: FIXTURE_PATH }),
    });
    const loadData = await loadRes.json();
    const sid = loadData.sessionId;
    assert.ok(loadData.turns.length >= 4, "fixture needs at least 4 turns");

    // Exclude turn 2, bookmark turn 4 (original index)
    const originalTurn4 = loadData.turns[3];
    const res = await fetch(`${baseUrl}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sid,
        options: {
          excludeTurns: [loadData.turns[1].index],
          bookmarks: [{ turn: originalTurn4.index, label: "Important turn" }],
          compress: false,
        },
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();

    // After excluding turn 2, original turn 4 should be remapped to index 3.
    // The bookmark should reference the new sequential index, not the original.
    // In the embedded JS data, quotes are escaped as \"
    assert.ok(data.html.includes("Important turn"), "bookmark label should be in HTML");
    // The bookmark should point to turn 3 (remapped), not turn 4 (original)
    const bmMatch = data.html.match(/\\"turn\\":\d+/g) || data.html.match(/"turn":\d+/g);
    assert.ok(bmMatch, "should have bookmark turn reference in HTML");
    assert.ok(bmMatch.some((m) => m.includes("3")), `bookmark should reference turn 3, got: ${bmMatch}`);
    assert.ok(!bmMatch.some((m) => m.includes("4")), `bookmark should not reference turn 4, got: ${bmMatch}`);
  });

  // ── Session state persistence ─────────────────────────────

  it("persists excluded turns and bookmarks across session switches", async () => {
    // Load session
    const loadRes = await fetch(`${baseUrl}/api/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: FIXTURE_PATH }),
    });
    const loadData = await loadRes.json();
    const sid = loadData.sessionId;

    // Trigger preview with excludes and bookmarks to persist state
    await fetch(`${baseUrl}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sid,
        options: {
          excludeTurns: [2, 4],
          bookmarks: [{ turn: 1, label: "First" }, { turn: 3, label: "Third" }],
        },
      }),
    });

    // Re-load same session (simulates switching away and back)
    const reloadRes = await fetch(`${baseUrl}/api/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: FIXTURE_PATH }),
    });
    const reloadData = await reloadRes.json();

    // Excluded turns should be restored
    assert.deepEqual(reloadData.excludedTurns, [2, 4]);

    // Bookmarks should be restored as [turn, label] pairs
    assert.equal(reloadData.savedBookmarks.length, 2);
    assert.deepEqual(reloadData.savedBookmarks[0], [1, "First"]);
    assert.deepEqual(reloadData.savedBookmarks[1], [3, "Third"]);
  });

  it("reset clears persisted excluded turns and bookmarks", async () => {
    // Load and set state via preview
    const loadRes = await fetch(`${baseUrl}/api/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: FIXTURE_PATH }),
    });
    const sid = (await loadRes.json()).sessionId;

    await fetch(`${baseUrl}/api/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sid,
        options: {
          excludeTurns: [1],
          bookmarks: [{ turn: 2, label: "BM" }],
        },
      }),
    });

    // Reset
    await fetch(`${baseUrl}/api/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sid }),
    });

    // Re-load — state should be cleared
    const reloadRes = await fetch(`${baseUrl}/api/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: FIXTURE_PATH }),
    });
    const reloadData = await reloadRes.json();
    assert.deepEqual(reloadData.excludedTurns, []);
    assert.deepEqual(reloadData.savedBookmarks, []);
  });

  it("rejects cross-origin API requests", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      headers: { "Origin": "https://evil.example.com" },
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.match(data.error, /Cross-origin/);
  });

  it("allows same-origin API requests", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      headers: { "Origin": baseUrl },
    });
    assert.equal(res.status, 200);
  });

  // ── Import HTML ──────────────────────────────────────────

  it("POST /api/import extracts turns from valid HTML replay", async () => {
    const sampleTurns = [
      { index: 1, user_text: "Hello", blocks: [{ kind: "text", text: "Hi!", tool_call: null }], timestamp: "2025-06-01T10:00:00Z" },
      { index: 2, user_text: "Bye", blocks: [{ kind: "text", text: "Goodbye!", tool_call: null }], timestamp: "2025-06-01T10:01:00Z" },
    ];
    const sampleBookmarks = [{ turn: 1, label: "Start" }];
    const html = render(sampleTurns, { minified: false, redactSecrets: false, bookmarks: sampleBookmarks });

    const res = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, filename: "test-import.html" }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.sessionId);
    assert.equal(data.format, "extracted");
    assert.equal(data.turns.length, 2);
    assert.equal(data.turns[0].user_text, "Hello");
    assert.equal(data.bookmarks.length, 1);
    assert.equal(data.bookmarks[0].label, "Start");
  });

  it("POST /api/import rejects non-replay HTML", async () => {
    const res = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: "<html><body>Not a replay</body></html>", filename: "bad.html" }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /Not a valid claude-replay/);
  });

  it("POST /api/import rejects missing html field", async () => {
    const res = await fetch(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "test.html" }),
    });
    assert.equal(res.status, 400);
  });

  it("POST /api/load supports .html replay files", async () => {
    // Generate a replay HTML file in a temp location under $HOME
    const sampleTurns = [
      { index: 1, user_text: "Test", blocks: [{ kind: "text", text: "Reply", tool_call: null }] },
    ];
    const html = render(sampleTurns, { minified: false, redactSecrets: false });
    const tmpHtml = join(homedir(), `.claude-replay-test-${process.pid}.html`);
    writeFileSync(tmpHtml, html);

    try {
      const res = await fetch(`${baseUrl}/api/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: tmpHtml }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.sessionId);
      assert.equal(data.format, "extracted");
      assert.equal(data.turns.length, 1);
      assert.equal(data.turns[0].user_text, "Test");
    } finally {
      if (existsSync(tmpHtml)) unlinkSync(tmpHtml);
    }
  });

  it("POST /api/load rejects invalid .html files", async () => {
    const tmpHtml = join(homedir(), `.claude-replay-test-bad-${process.pid}.html`);
    writeFileSync(tmpHtml, "<html><body>Not a replay</body></html>");

    try {
      const res = await fetch(`${baseUrl}/api/load`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: tmpHtml }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /Not a valid claude-replay/);
    } finally {
      if (existsSync(tmpHtml)) unlinkSync(tmpHtml);
    }
  });
});
