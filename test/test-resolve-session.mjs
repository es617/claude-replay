import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveSessionId } from "../src/resolve-session.mjs";

/** Create a fake home directory with session files. */
function createFakeHome(sessions = {}) {
  const home = mkdtempSync(join(tmpdir(), "resolve-test-"));

  // Create Claude Code sessions
  if (sessions.claude) {
    for (const [proj, files] of Object.entries(sessions.claude)) {
      const projDir = join(home, ".claude", "projects", proj);
      mkdirSync(projDir, { recursive: true });
      for (const f of files) {
        writeFileSync(join(projDir, f), "{}");
      }
    }
  }

  // Create Cursor sessions
  if (sessions.cursor) {
    for (const [proj, ids] of Object.entries(sessions.cursor)) {
      for (const id of ids) {
        const dir = join(home, ".cursor", "projects", proj, "agent-transcripts", id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "transcript.jsonl"), "{}");
      }
    }
  }

  return home;
}

describe("resolveSessionId", () => {
  it("finds a Claude Code session by ID", () => {
    const home = createFakeHome({
      claude: { "-Users-me-myproject": ["abc123.jsonl"] },
    });
    const matches = resolveSessionId("abc123", { home });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].group, "Claude Code");
    assert.equal(matches[0].project, "me-myproject");
    assert.ok(matches[0].path.endsWith("abc123.jsonl"));
  });

  it("finds a Cursor session by ID", () => {
    const home = createFakeHome({
      cursor: { "-Users-me-cursorproj": ["def456"] },
    });
    const matches = resolveSessionId("def456", { home });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].group, "Cursor");
    assert.ok(matches[0].path.endsWith("transcript.jsonl"));
  });

  it("returns empty array when no match found", () => {
    const home = createFakeHome({
      claude: { "-Users-me-proj": ["other.jsonl"] },
    });
    const matches = resolveSessionId("nonexistent", { home });
    assert.equal(matches.length, 0);
  });

  it("returns multiple matches across projects", () => {
    const home = createFakeHome({
      claude: {
        "-Users-me-project-a": ["shared-id.jsonl"],
        "-Users-me-project-b": ["shared-id.jsonl"],
      },
    });
    const matches = resolveSessionId("shared-id", { home });
    assert.equal(matches.length, 2);
  });

  it("returns multiple matches across Claude and Cursor", () => {
    const home = createFakeHome({
      claude: { "-Users-me-proj": ["same-id.jsonl"] },
      cursor: { "-Users-me-proj": ["same-id"] },
    });
    const matches = resolveSessionId("same-id", { home });
    assert.equal(matches.length, 2);
    const groups = matches.map((m) => m.group).sort();
    assert.deepEqual(groups, ["Claude Code", "Cursor"]);
  });

  it("handles missing .claude and .cursor directories", () => {
    const home = mkdtempSync(join(tmpdir(), "resolve-empty-"));
    const matches = resolveSessionId("anything", { home });
    assert.equal(matches.length, 0);
  });

  it("handles input with .jsonl suffix", () => {
    const home = createFakeHome({
      claude: { "-Users-me-proj": ["abc123.jsonl"] },
    });
    const matches = resolveSessionId("abc123.jsonl", { home });
    assert.equal(matches.length, 1);
  });
});
