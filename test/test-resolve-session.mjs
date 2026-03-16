import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  // Each entry can be a string (uses transcript.jsonl) or { id, filename } for custom naming
  if (sessions.cursor) {
    for (const [proj, ids] of Object.entries(sessions.cursor)) {
      for (const entry of ids) {
        const id = typeof entry === "string" ? entry : entry.id;
        const filename = typeof entry === "string" ? "transcript.jsonl" : entry.filename;
        const dir = join(home, ".cursor", "projects", proj, "agent-transcripts", id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, filename), "{}");
      }
    }
  }

  // Create VS GitHub Chat sessions
  if (sessions.githubChat) {
    for (const relativePath of sessions.githubChat) {
      const filePath = join(home, ".vs-github-chat", "sessions", relativePath);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, "{}");
    }
  }

  // Create VS Code Copilot chat sessions in workspaceStorage
  if (sessions.vscodeChat) {
    for (const relativePath of sessions.vscodeChat) {
      const filePath = join(home, "AppData", "Roaming", "Code", "User", "workspaceStorage", relativePath);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, "{}");
    }
  }

  // Create Codex CLI sessions: ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<timestamp>-<uuid>.jsonl
  if (sessions.codex) {
    for (const { date, filename } of sessions.codex) {
      const [yyyy, mm, dd] = date.split("-");
      const dayDir = join(home, ".codex", "sessions", yyyy, mm, dd);
      mkdirSync(dayDir, { recursive: true });
      writeFileSync(join(dayDir, filename), "{}");
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

  it("finds a VS GitHub Chat session recursively by filename", () => {
    const home = createFakeHome({
      githubChat: ["2026/03/13/copilot-session-1.jsonl"],
    });
    const matches = resolveSessionId("copilot-session-1", { home });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].group, "VS GitHub Chat");
    assert.equal(matches[0].project, "local-sessions");
    assert.ok(matches[0].path.endsWith("copilot-session-1.jsonl"));
  });

  it("finds a VS Code Copilot workspaceStorage session by filename", () => {
    const home = createFakeHome({
      vscodeChat: ["bucket-1/chatSessions/copilot-session-2.jsonl"],
    });
    const matches = resolveSessionId("copilot-session-2", { home });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].group, "VS GitHub Copilot Chat (VS Code)");
    assert.equal(matches[0].project, "workspaceStorage");
    assert.ok(matches[0].path.endsWith("copilot-session-2.jsonl"));
  });

  // --- Codex CLI tests ---

  it("finds a Codex CLI session by full UUID", () => {
    const home = createFakeHome({
      codex: [
        {
          date: "2026-03-12",
          filename: "rollout-2026-03-12T23-00-40-019ce523-9654-7023-8409-23aaaddef5d9.jsonl",
        },
      ],
    });
    const matches = resolveSessionId("019ce523-9654-7023-8409-23aaaddef5d9", { home });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].group, "Codex CLI");
    assert.equal(matches[0].project, "2026-03-12");
    assert.ok(matches[0].path.endsWith(".jsonl"));
  });

  it("finds a Codex CLI session by partial UUID prefix", () => {
    const home = createFakeHome({
      codex: [
        {
          date: "2026-03-12",
          filename: "rollout-2026-03-12T23-00-40-019ce523-9654-7023-8409-23aaaddef5d9.jsonl",
        },
      ],
    });
    const matches = resolveSessionId("019ce523", { home });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].group, "Codex CLI");
  });

  it("date fragments do NOT match Codex sessions", () => {
    const home = createFakeHome({
      codex: [
        {
          date: "2026-03-12",
          filename: "rollout-2026-03-12T23-00-40-019ce523-9654-7023-8409-23aaaddef5d9.jsonl",
        },
      ],
    });
    // "2026" and "03" appear in the date/timestamp portion, not in the UUID
    assert.equal(resolveSessionId("2026", { home }).length, 0);
    assert.equal(resolveSessionId("03", { home }).length, 0);
  });

  it("Codex and Claude Code don't collide on different UUIDs", () => {
    const home = createFakeHome({
      claude: { "-Users-me-proj": ["claude-uuid-111.jsonl"] },
      codex: [
        {
          date: "2026-03-12",
          filename: "rollout-2026-03-12T10-00-00-codex-uuid-222.jsonl",
        },
      ],
    });
    const claudeMatches = resolveSessionId("claude-uuid-111", { home });
    assert.equal(claudeMatches.length, 1);
    assert.equal(claudeMatches[0].group, "Claude Code");

    const codexMatches = resolveSessionId("codex-uuid-222", { home });
    assert.equal(codexMatches.length, 1);
    assert.equal(codexMatches[0].group, "Codex CLI");
  });

  it("handles missing .codex directory gracefully", () => {
    const home = createFakeHome({
      claude: { "-Users-me-proj": ["abc.jsonl"] },
    });
    // No .codex dir exists; should not throw
    const matches = resolveSessionId("abc", { home });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].group, "Claude Code");
  });

  // --- Cursor <uuid>.jsonl naming tests ---

  it("finds a Cursor session with <uuid>.jsonl naming", () => {
    const home = createFakeHome({
      cursor: {
        "-Users-me-cursorproj": [
          { id: "cur-uuid-789", filename: "cur-uuid-789.jsonl" },
        ],
      },
    });
    const matches = resolveSessionId("cur-uuid-789", { home });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].group, "Cursor");
    assert.ok(matches[0].path.endsWith("cur-uuid-789.jsonl"));
  });

  it("finds Cursor sessions with both naming conventions", () => {
    const home = createFakeHome({
      cursor: {
        "-Users-me-proj1": ["session-aaa"],
        "-Users-me-proj2": [
          { id: "session-bbb", filename: "session-bbb.jsonl" },
        ],
      },
    });
    const matchA = resolveSessionId("session-aaa", { home });
    assert.equal(matchA.length, 1);
    assert.ok(matchA[0].path.endsWith("transcript.jsonl"));

    const matchB = resolveSessionId("session-bbb", { home });
    assert.equal(matchB.length, 1);
    assert.ok(matchB[0].path.endsWith("session-bbb.jsonl"));
  });
});
