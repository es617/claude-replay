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
  //    or: ~/.cursor/projects/<project>/agent-transcripts/<id>/<id>.jsonl
  // For Cursor, the session ID is the transcript folder name
  const cursorBase = join(homeDir, ".cursor", "projects");
  try {
    for (const proj of readdirSync(cursorBase)) {
      const transcriptsDir = join(cursorBase, proj, "agent-transcripts");
      // Try transcript.jsonl first, then <id>.jsonl
      let filePath = join(transcriptsDir, sessionId, "transcript.jsonl");
      try {
        statSync(filePath);
      } catch {
        filePath = join(transcriptsDir, sessionId, sessionId + ".jsonl");
        try { statSync(filePath); } catch { continue; }
      }
      const parts = proj.replace(/^-+/, "").split("-");
      const displayName = parts.length > 1 ? parts.slice(-2).join("-") : parts[0];
      matches.push({ path: filePath, project: displayName, group: "Cursor" });
    }
  } catch { /* directory doesn't exist */ }

  // Gemini CLI: ~/.gemini/tmp/<projectHash>/chats/session-<date>-<id>.json
  const geminiBase = join(homeDir, ".gemini", "tmp");
  try {
    for (const hashDir of readdirSync(geminiBase)) {
      const chatsDir = join(geminiBase, hashDir, "chats");
      try { if (!statSync(chatsDir).isDirectory()) continue; } catch { continue; }
      for (const f of readdirSync(chatsDir)) {
        if (!f.endsWith(".json")) continue;
        const stem = f.replace(/\.json$/, "");
        if (f === sessionId || f === sessionId + ".json" || stem === sessionId || stem.endsWith("-" + sessionId)) {
          matches.push({ path: join(chatsDir, f), project: hashDir.slice(0, 12), group: "Gemini CLI" });
        }
      }
    }
  } catch { /* directory doesn't exist */ }

  // Codex CLI: ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-<timestamp>-<uuid>.jsonl
  // Filenames look like: rollout-2026-03-12T23-00-40-019ce523-9654-7023-8409-23aaaddef5d9.jsonl
  // The UUID is the session ID. Match by exact filename or UUID substring in the
  // UUID portion only (after the timestamp prefix) to avoid false positives on
  // date fragments like "2026" or "03".
  const codexBase = join(homeDir, ".codex", "sessions");
  try {
    for (const year of readdirSync(codexBase)) {
      const yearPath = join(codexBase, year);
      try { if (!statSync(yearPath).isDirectory()) continue; } catch { continue; }
      for (const month of readdirSync(yearPath)) {
        const monthPath = join(yearPath, month);
        try { if (!statSync(monthPath).isDirectory()) continue; } catch { continue; }
        for (const day of readdirSync(monthPath)) {
          const dayPath = join(monthPath, day);
          try { if (!statSync(dayPath).isDirectory()) continue; } catch { continue; }
          for (const f of readdirSync(dayPath)) {
            if (!f.endsWith(".jsonl")) continue;
            if (f === target) {
              matches.push({ path: join(dayPath, f), project: `${year}-${month}-${day}`, group: "Codex CLI" });
              continue;
            }
            // Extract UUID portion: strip "rollout-<timestamp>-" prefix and ".jsonl" suffix
            // e.g. "rollout-2026-03-12T23-00-40-019ce523-9654-7023-8409-23aaaddef5d9.jsonl"
            //   → UUID starts after the T##-##-## timestamp part
            const stem = f.replace(/\.jsonl$/, "");
            const uuidMatch = stem.match(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)$/);
            if (uuidMatch && uuidMatch[1].includes(sessionId)) {
              matches.push({ path: join(dayPath, f), project: `${year}-${month}-${day}`, group: "Codex CLI" });
            }
          }
        }
      }
    }
  } catch { /* directory doesn't exist */ }

  return matches;
}
