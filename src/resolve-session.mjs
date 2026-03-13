/**
 * Resolve a session ID to a full file path by scanning known session directories.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Find session files matching the given ID.
 * @param {string} sessionId - Session ID (without .jsonl extension)
 * @param {{ home?: string }} [options]
 * @returns {{ path: string, project: string, group: string }[]}
 */
export function resolveSessionId(sessionId, { home } = {}) {
  const homeDir = home || homedir();
  const target = sessionId.endsWith(".jsonl") ? sessionId : sessionId + ".jsonl";
  const matches = [];

  // Claude Code: ~/.claude/projects/<project>/<id>.jsonl
  const claudeBase = join(homeDir, ".claude", "projects");
  try {
    for (const proj of readdirSync(claudeBase)) {
      const projPath = join(claudeBase, proj);
      try { if (!statSync(projPath).isDirectory()) continue; } catch { continue; }
      const filePath = join(projPath, target);
      try {
        statSync(filePath);
        const parts = proj.replace(/^-+/, "").split("-");
        const displayName = parts.length > 1 ? parts.slice(-2).join("-") : parts[0];
        matches.push({ path: filePath, project: displayName, group: "Claude Code" });
      } catch { /* not found */ }
    }
  } catch { /* directory doesn't exist */ }

  // Cursor: ~/.cursor/projects/<project>/agent-transcripts/<id>/transcript.jsonl
  // For Cursor, the session ID is the transcript folder name
  const cursorBase = join(homeDir, ".cursor", "projects");
  try {
    for (const proj of readdirSync(cursorBase)) {
      const transcriptsDir = join(cursorBase, proj, "agent-transcripts");
      const filePath = join(transcriptsDir, sessionId, "transcript.jsonl");
      try {
        statSync(filePath);
        const parts = proj.replace(/^-+/, "").split("-");
        const displayName = parts.length > 1 ? parts.slice(-2).join("-") : parts[0];
        matches.push({ path: filePath, project: displayName, group: "Cursor" });
      } catch { /* not found */ }
    }
  } catch { /* directory doesn't exist */ }

  return matches;
}
