import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";

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
      body: JSON.stringify({ path: "/tmp/nonexistent-file-abc123.jsonl" }),
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
      body: JSON.stringify({ path: "/tmp/nonexistent-dir-xyz789" }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  });
});
