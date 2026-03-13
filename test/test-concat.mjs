import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../bin/claude-replay.mjs", import.meta.url));

/** Write a minimal Claude Code session JSONL with the given turns. */
function writeSession(turns) {
  const dir = mkdtempSync(join(tmpdir(), "concat-test-"));
  const path = join(dir, "session.jsonl");
  const lines = [];
  for (const t of turns) {
    lines.push(JSON.stringify({ type: "user", message: { role: "user", content: t.user }, timestamp: t.ts }));
    lines.push(JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: t.reply }] },
      timestamp: t.ts,
    }));
  }
  writeFileSync(path, lines.join("\n"));
  return path;
}

describe("session concatenation", () => {
  it("merges two sessions into one replay", () => {
    const s1 = writeSession([
      { user: "Hello from session 1", reply: "Hi there", ts: "2026-01-01T10:00:00Z" },
    ]);
    const s2 = writeSession([
      { user: "Hello from session 2", reply: "Hi again", ts: "2026-01-01T11:00:00Z" },
    ]);
    const outDir = mkdtempSync(join(tmpdir(), "concat-out-"));
    const outPath = join(outDir, "merged.html");
    // Use --no-compress so we can inspect content in the HTML
    execFileSync("node", [CLI, s1, s2, "-o", outPath, "--no-compress"], { encoding: "utf-8" });
    const html = readFileSync(outPath, "utf-8");
    assert.ok(html.includes("session 1"), "Should contain session 1 content");
    assert.ok(html.includes("session 2"), "Should contain session 2 content");
  });

  it("sorts turns chronologically when all have timestamps", () => {
    const s1 = writeSession([
      { user: "Later session", reply: "Reply later", ts: "2026-01-02T10:00:00Z" },
    ]);
    const s2 = writeSession([
      { user: "Earlier session", reply: "Reply earlier", ts: "2026-01-01T10:00:00Z" },
    ]);
    const outDir = mkdtempSync(join(tmpdir(), "concat-out-"));
    const outPath = join(outDir, "sorted.html");
    execFileSync("node", [CLI, s1, s2, "-o", outPath, "--no-compress"], { encoding: "utf-8" });
    const html = readFileSync(outPath, "utf-8");
    const pos1 = html.indexOf("Earlier session");
    const pos2 = html.indexOf("Later session");
    assert.ok(pos1 > -1, "Should contain Earlier session");
    assert.ok(pos2 > -1, "Should contain Later session");
    assert.ok(pos1 < pos2, "Earlier session should come before later session");
  });

  it("preserves command-line order when timestamps are missing", () => {
    const dir1 = mkdtempSync(join(tmpdir(), "concat-test-"));
    const dir2 = mkdtempSync(join(tmpdir(), "concat-test-"));
    const s1 = join(dir1, "s1.jsonl");
    const s2 = join(dir2, "s2.jsonl");
    writeFileSync(s1, [
      JSON.stringify({ type: "user", message: { role: "user", content: "First file" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Reply 1" }] } }),
    ].join("\n"));
    writeFileSync(s2, [
      JSON.stringify({ type: "user", message: { role: "user", content: "Second file" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Reply 2" }] } }),
    ].join("\n"));
    const outDir = mkdtempSync(join(tmpdir(), "concat-out-"));
    const outPath = join(outDir, "ordered.html");
    execFileSync("node", [CLI, s1, s2, "-o", outPath, "--no-compress"], { encoding: "utf-8" });
    const html = readFileSync(outPath, "utf-8");
    const pos1 = html.indexOf("First file");
    const pos2 = html.indexOf("Second file");
    assert.ok(pos1 > -1, "Should contain First file");
    assert.ok(pos2 > -1, "Should contain Second file");
    assert.ok(pos1 < pos2, "First file should come before second file");
  });

  it("re-indexes turns sequentially across sessions", () => {
    const s1 = writeSession([
      { user: "Turn A", reply: "Reply A", ts: "2026-01-01T10:00:00Z" },
      { user: "Turn B", reply: "Reply B", ts: "2026-01-01T10:01:00Z" },
    ]);
    const s2 = writeSession([
      { user: "Turn C", reply: "Reply C", ts: "2026-01-01T11:00:00Z" },
    ]);
    const outDir = mkdtempSync(join(tmpdir(), "concat-out-"));
    const outPath = join(outDir, "reindexed.html");
    execFileSync("node", [CLI, s1, s2, "-o", outPath, "--no-compress"], { encoding: "utf-8" });
    const html = readFileSync(outPath, "utf-8");
    // Turns should be indexed 1, 2, 3 — not 1, 2, 1
    // In uncompressed mode, JSON is escaped for JS string embedding
    assert.ok(html.includes('\\\"index\\\":1'), "Should have turn index 1");
    assert.ok(html.includes('\\\"index\\\":2'), "Should have turn index 2");
    assert.ok(html.includes('\\\"index\\\":3'), "Should have turn index 3");
  });

  it("single file works without re-indexing", () => {
    const s1 = writeSession([
      { user: "Solo session", reply: "Reply", ts: "2026-01-01T10:00:00Z" },
    ]);
    const outDir = mkdtempSync(join(tmpdir(), "concat-out-"));
    const outPath = join(outDir, "single.html");
    execFileSync("node", [CLI, s1, "-o", outPath], { encoding: "utf-8" });
    assert.ok(readFileSync(outPath, "utf-8").length > 0);
  });

  it("rejects more than 20 inputs", () => {
    const args = Array.from({ length: 21 }, (_, i) => `fake${i}`);
    assert.throws(
      () => execFileSync("node", [CLI, ...args], { encoding: "utf-8" }),
      /too many input files/,
    );
  });
});
