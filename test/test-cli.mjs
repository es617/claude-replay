import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, unlinkSync, copyFileSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "..", "bin", "claude-replay.mjs");
const FIXTURE = resolve(__dirname, "e2e", "fixture.jsonl");

function run(args, timeout = 5000) {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error("CLI timed out — may have launched server")), timeout);
    execFile(process.execPath, [CLI, ...args], (err, stdout, stderr) => {
      clearTimeout(timer);
      res({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

describe("CLI flags", () => {
  it("--version prints version and exits", async () => {
    const { code, stdout } = await run(["--version"]);
    assert.equal(code, 0);
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it("-v prints version and exits", async () => {
    const { code, stdout } = await run(["-v"]);
    assert.equal(code, 0);
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it("--list-themes prints themes and exits", async () => {
    const { code, stdout } = await run(["--list-themes"]);
    assert.equal(code, 0);
    const lines = stdout.trim().split("\n");
    assert.ok(lines.length >= 3);
    assert.ok(lines.includes("tokyo-night"));
    assert.ok(lines.includes("dracula"));
  });

  it("--help prints usage and exits", async () => {
    const { code, stdout } = await run(["--help"]);
    assert.equal(code, 0);
    assert.match(stdout, /Usage:/);
    assert.match(stdout, /--list-themes/);
  });

  it("-h prints usage and exits", async () => {
    const { code, stdout } = await run(["-h"]);
    assert.equal(code, 0);
    assert.match(stdout, /Usage:/);
  });

  it("extract without file shows error", async () => {
    const { code, stderr } = await run(["extract"]);
    assert.notEqual(code, 0);
    assert.match(stderr, /input file is required/);
  });

  it("nonexistent file shows error", async () => {
    const { code, stderr } = await run(["nonexistent-file.jsonl"]);
    assert.notEqual(code, 0);
    assert.match(stderr, /file not found/);
  });

  it("generates HTML to stdout with fixture input", async () => {
    const { code, stdout } = await run([FIXTURE]);
    assert.equal(code, 0);
    assert.match(stdout, /<!DOCTYPE html>/);
  });

  it("editor with nonexistent .jsonl file shows error", async () => {
    const { code, stderr } = await run(["editor", "nonexistent-file.jsonl"]);
    assert.notEqual(code, 0);
    assert.match(stderr, /file not found/);
  });

  it("extract outputs JSONL by default", async () => {
    const { code: genCode } = await run([FIXTURE, "--mark", "1:BM", "-o", "/tmp/cli-extract-test.html", "--no-minify"]);
    assert.equal(genCode, 0);
    const { code, stdout } = await run(["extract", "/tmp/cli-extract-test.html"]);
    assert.equal(code, 0);
    const lines = stdout.trim().split("\n");
    assert.ok(lines.length >= 3, "should have at least 3 turn lines");
    const first = JSON.parse(lines[0]);
    assert.ok(first.user_text, "first turn should have user_text");
    // Bookmark should be embedded
    const withBm = lines.map((l) => JSON.parse(l)).find((t) => t.bookmark);
    assert.ok(withBm, "one turn should have a bookmark field");
    assert.equal(withBm.bookmark, "BM");
  });

  it("extract --format json outputs legacy JSON", async () => {
    const { code: genCode } = await run([FIXTURE, "-o", "/tmp/cli-extract-json.html", "--no-minify"]);
    assert.equal(genCode, 0);
    const { code, stdout } = await run(["extract", "/tmp/cli-extract-json.html", "--format", "json"]);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data.turns));
    assert.ok(Array.isArray(data.bookmarks));
  });

  it("round-trip: extract JSONL then render preserves turns and bookmarks", async () => {
    // Generate with bookmarks
    const { code: c1 } = await run([FIXTURE, "--mark", "1:Start", "--mark", "3:End", "-o", "/tmp/cli-rt-source.html", "--no-minify"]);
    assert.equal(c1, 0);
    // Extract
    const { code: c2 } = await run(["extract", "/tmp/cli-rt-source.html", "-o", "/tmp/cli-rt.jsonl"]);
    assert.equal(c2, 0);
    // Re-render
    const { code: c3, stdout } = await run(["/tmp/cli-rt.jsonl", "--no-compress"]);
    assert.equal(c3, 0);
    assert.match(stdout, /<!DOCTYPE html>/);
    assert.ok(stdout.includes('\\"label\\":\\"Start\\"'), "Start bookmark preserved");
    assert.ok(stdout.includes('\\"label\\":\\"End\\"'), "End bookmark preserved");
  });

  it("remaps bookmark indices when excluding turns", async () => {
    // Exclude turn 2, bookmark on original turn 3 → should become turn 2
    const { code, stdout } = await run([
      FIXTURE, "--exclude-turns", "2", "--mark", "3:TestBookmark", "--no-compress",
    ]);
    assert.equal(code, 0);
    assert.ok(stdout.includes("TestBookmark"), "bookmark label in output");
    // Extract the bookmarks blob — it appears between BOOKMARKS decode and FILES decode
    const bmMatch = stdout.match(/\\"label\\":\\"TestBookmark\\"/);
    assert.ok(bmMatch, "bookmark label should be in bookmarks data");
    // Check the bookmark's turn index is 2 (remapped), not 3 (original)
    const bmSection = stdout.match(/\\"turn\\":\d+,\\"label\\":\\"TestBookmark\\"/);
    assert.ok(bmSection, "bookmark should have turn and label");
    assert.ok(bmSection[0].includes('\\"turn\\":2'), "bookmark should reference remapped turn 2");
  });

  it("--watch without --serve requires -o", async () => {
    const { code, stderr } = await run([FIXTURE, "--watch"]);
    assert.notEqual(code, 0);
    assert.match(stderr, /--watch without --serve requires -o/);
  });

  it("--serve starts server and serves replay", async () => {
    const port = 18900 + Math.floor(Math.random() * 100);
    const child = spawn(process.execPath, [CLI, FIXTURE, "--serve", "--port", String(port)], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      // Wait for server to start
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Server did not start")), 5000);
        child.stderr.on("data", (data) => {
          if (data.toString().includes("Serving replay")) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      // Fetch the replay
      const res = await fetch(`http://127.0.0.1:${port}`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /<!DOCTYPE html>/);
      // Check reload endpoint
      const reload = await fetch(`http://127.0.0.1:${port}/__reload`);
      const data = await reload.json();
      assert.ok(typeof data.version === "number");
    } finally {
      child.kill();
    }
  });

  it("--serve --watch rebuilds on file change", async () => {
    const tmpFile = resolve(__dirname, `watch-test-${process.pid}.jsonl`);
    copyFileSync(FIXTURE, tmpFile);
    const port = 19000 + Math.floor(Math.random() * 100);
    const child = spawn(process.execPath, [CLI, tmpFile, "--serve", "--watch", "--port", String(port)], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      // Wait for server to start
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Server did not start")), 5000);
        child.stderr.on("data", (data) => {
          if (data.toString().includes("Serving replay")) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      // Get initial version
      const r1 = await fetch(`http://127.0.0.1:${port}/__reload`);
      const d1 = await r1.json();
      const initialVersion = d1.version;

      // Touch the file to trigger rebuild
      const content = readFileSync(tmpFile, "utf-8");
      writeFileSync(tmpFile, content + "\n");

      // Wait for rebuild
      await new Promise((r) => setTimeout(r, 1000));

      // Version should have bumped
      const r2 = await fetch(`http://127.0.0.1:${port}/__reload`);
      const d2 = await r2.json();
      assert.ok(d2.version > initialVersion, `version should bump: ${d2.version} > ${initialVersion}`);
    } finally {
      child.kill();
      try { unlinkSync(tmpFile); } catch {}
    }
  });

  it("--serve reload endpoint includes turn count", async () => {
    const port = 19100 + Math.floor(Math.random() * 100);
    const child = spawn(process.execPath, [CLI, FIXTURE, "--serve", "--port", String(port)], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Server did not start")), 5000);
        child.stderr.on("data", (data) => {
          if (data.toString().includes("Serving replay")) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      const res = await fetch(`http://127.0.0.1:${port}/__reload`);
      const data = await res.json();
      assert.ok(typeof data.version === "number");
      assert.ok(typeof data.turns === "number");
      assert.ok(data.turns > 0);
    } finally {
      child.kill();
    }
  });

  it("--watch -o writes file and rewrites on change", async () => {
    const tmpInput = resolve(__dirname, `watch-input-${process.pid}.jsonl`);
    const tmpOutput = resolve(__dirname, `watch-output-${process.pid}.html`);
    copyFileSync(FIXTURE, tmpInput);
    const child = spawn(process.execPath, [CLI, tmpInput, "--watch", "-o", tmpOutput], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      // Wait for initial write
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Watch did not start")), 5000);
        child.stderr.on("data", (data) => {
          if (data.toString().includes("Watching")) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      // File should exist
      assert.ok(existsSync(tmpOutput), "output file should exist");
      const size1 = readFileSync(tmpOutput).length;

      // Append to input to trigger rebuild
      const content = readFileSync(tmpInput, "utf-8");
      writeFileSync(tmpInput, content + '{"type":"user","message":{"role":"user","content":"extra"},"timestamp":"2025-06-01T10:10:00Z"}\n');

      await new Promise((r) => setTimeout(r, 1000));

      // File should have been rewritten (different size due to extra turn)
      const size2 = readFileSync(tmpOutput).length;
      assert.ok(size2 !== size1, `file size should change: ${size2} !== ${size1}`);
    } finally {
      child.kill();
      try { unlinkSync(tmpInput); } catch {}
      try { unlinkSync(tmpOutput); } catch {}
    }
  });
});
