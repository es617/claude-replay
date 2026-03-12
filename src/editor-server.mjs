/**
 * Local HTTP server for the web-based replay editor.
 */

import { createServer } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { parseTranscript, filterTurns, detectFormat, applyPacedTiming } from "./parser.mjs";
import { render } from "./renderer.mjs";
import { getTheme, listThemes } from "./themes.mjs";

const EDITOR_HTML_PATH = new URL("../template/editor.html", import.meta.url);

// ---------------------------------------------------------------------------
// In-memory session store
// Map<sessionId, { originalTurns, workingTurns, sourcePath, format }>
// ---------------------------------------------------------------------------

const sessions = new Map();
let sessionCounter = 0;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MB

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function error(res, message, status = 400) {
  json(res, { error: message }, status);
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

/** Summarize a turn's blocks into a human-readable string. */
function summarizeBlocks(blocks) {
  const counts = { text: 0, thinking: 0, tool_use: 0 };
  for (const b of blocks) {
    counts[b.kind] = (counts[b.kind] || 0) + 1;
  }
  const parts = [];
  if (counts.text) parts.push(`${counts.text} text`);
  if (counts.thinking) parts.push(`${counts.thinking} thinking`);
  if (counts.tool_use) parts.push(`${counts.tool_use} tool call${counts.tool_use > 1 ? "s" : ""}`);
  return parts.join(", ") || "empty";
}

/** Map a block to a lightweight shape for the client. */
function summarizeBlock(b) {
  if (b.kind === "tool_use" && b.tool_call) {
    return {
      kind: b.kind,
      name: b.tool_call.name,
      input: truncate(JSON.stringify(b.tool_call.input), 200),
      result: truncate(b.tool_call.result || "", 500),
    };
  }
  return { kind: b.kind, text: truncate(b.text || "", 1000) };
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Map full turns to the lightweight shape sent to the client. */
function summarizeTurns(turns) {
  return turns.map((t) => ({
    index: t.index,
    user_text: t.user_text,
    blockSummary: summarizeBlocks(t.blocks),
    blocks: t.blocks.map(summarizeBlock),
    timestamp: t.timestamp,
    system_events: t.system_events || [],
  }));
}

/** Resolve a theme name, falling back to tokyo-night. */
function getThemeSafe(name) {
  try {
    return getTheme(name);
  } catch {
    return getTheme("tokyo-night");
  }
}

/**
 * Prepare turns for rendering: clone, filter, apply timing.
 * Returns ready-to-render turns array.
 */
function prepareTurns(session, options) {
  let turns = session.workingTurns;
  if (options.excludeTurns && options.excludeTurns.length > 0) {
    turns = filterTurns(turns, { excludeTurns: options.excludeTurns });
  }
  const cloned = JSON.parse(JSON.stringify(turns));
  const timing = options.timing || "auto";
  const hasTimestamps = cloned.some((t) => t.timestamp);
  if (timing === "paced" || (timing === "auto" && !hasTimestamps)) {
    applyPacedTiming(cloned);
  }
  return cloned;
}

/** Build render options from client options + session metadata. */
function buildRenderOpts(options, session, overrides = {}) {
  return {
    speed: parseFloat(options.speed) || 1.0,
    showThinking: options.showThinking !== false,
    showToolCalls: options.showToolCalls !== false,
    theme: getThemeSafe(options.theme || "tokyo-night"),
    redactSecrets: options.redactSecrets !== false,
    redactRules: options.redactRules || [],
    userLabel: options.userLabel || "User",
    assistantLabel: options.assistantLabel || (session.format === "cursor" ? "Assistant" : "Claude"),
    title: options.title || "Replay",
    description: options.description || "",
    ogImage: options.ogImage || "",
    bookmarks: (options.bookmarks || []).sort((a, b) => a.turn - b.turn),
    minified: false,
    compress: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Filesystem browsing
// ---------------------------------------------------------------------------

/** Browse a directory — returns dirs + .jsonl files. */
function browseDirectory(dirPath) {
  const resolved = resolve(dirPath);
  const entries = readdirSync(resolved);
  const dirs = [];
  const files = [];

  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const fullPath = join(resolved, name);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        dirs.push({ name, path: fullPath });
      } else if (name.endsWith(".jsonl")) {
        files.push({ name, path: fullPath, date: stat.mtime.toISOString() });
      }
    } catch { /* skip inaccessible entries */ }
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => b.date.localeCompare(a.date));

  const parent = dirname(resolved);
  return { path: resolved, parent: parent !== resolved ? parent : null, dirs, files };
}

/** Discover session folders under Claude Code and Cursor project dirs. */
function discoverSessions() {
  const home = homedir();
  const groups = [];

  // Claude Code: ~/.claude/projects/<project>/*.jsonl
  const claudeBase = join(home, ".claude", "projects");
  try {
    const projects = readdirSync(claudeBase).filter((d) => {
      try { return statSync(join(claudeBase, d)).isDirectory(); } catch { return false; }
    });
    const claudeGroup = { name: "Claude Code", projects: [] };
    for (const proj of projects.sort()) {
      const projPath = join(claudeBase, proj);
      const files = readdirSync(projPath).filter((f) => f.endsWith(".jsonl")).sort().reverse();
      if (files.length === 0) continue;
      const parts = proj.replace(/^-+/, "").split("-");
      const displayName = parts.length > 1 ? parts.slice(-2).join("-") : parts[0];
      claudeGroup.projects.push({
        name: displayName,
        dirName: proj,
        sessions: files.map((f) => {
          const fullPath = join(projPath, f);
          let date = null;
          try { date = statSync(fullPath).mtime.toISOString(); } catch { /* ignore */ }
          return { file: f, path: fullPath, date };
        }),
      });
    }
    if (claudeGroup.projects.length > 0) groups.push(claudeGroup);
  } catch { /* directory doesn't exist */ }

  // Cursor: ~/.cursor/projects/<project>/agent-transcripts/<id>/transcript.jsonl
  const cursorBase = join(home, ".cursor", "projects");
  try {
    const projects = readdirSync(cursorBase).filter((d) => {
      try { return statSync(join(cursorBase, d)).isDirectory(); } catch { return false; }
    });
    const cursorGroup = { name: "Cursor", projects: [] };
    for (const proj of projects.sort()) {
      const transcriptsDir = join(cursorBase, proj, "agent-transcripts");
      let ids;
      try { ids = readdirSync(transcriptsDir); } catch { continue; }
      const cursorSessions = [];
      for (const id of ids.sort().reverse()) {
        const filePath = join(transcriptsDir, id, "transcript.jsonl");
        try {
          const stat = statSync(filePath);
          cursorSessions.push({ file: id, path: filePath, date: stat.mtime.toISOString() });
        } catch { continue; }
      }
      if (cursorSessions.length === 0) continue;
      const parts = proj.replace(/^-+/, "").split("-");
      const displayName = parts.length > 1 ? parts.slice(-2).join("-") : parts[0];
      cursorGroup.projects.push({ name: displayName, dirName: proj, sessions: cursorSessions });
    }
    if (cursorGroup.projects.length > 0) groups.push(cursorGroup);
  } catch { /* directory doesn't exist */ }

  return groups;
}

// ---------------------------------------------------------------------------
// API route handler
// ---------------------------------------------------------------------------

async function handleApi(req, res, pathname) {
  // GET /api/sessions — list discovered sessions + home directory
  if (pathname === "/api/sessions" && req.method === "GET") {
    return json(res, { groups: discoverSessions(), homedir: homedir() });
  }

  // GET /api/themes — list available themes
  if (pathname === "/api/themes" && req.method === "GET") {
    return json(res, listThemes());
  }

  // POST /api/browse — browse a directory for .jsonl files
  if (pathname === "/api/browse" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.path) return error(res, "Missing 'path' field");
    try {
      return json(res, browseDirectory(body.path));
    } catch (e) {
      const msg = e.code === "ENOENT" ? "Folder not found"
        : e.code === "EACCES" ? "Permission denied" : e.message;
      return error(res, msg, 400);
    }
  }

  // POST /api/load — parse a JSONL file (or return cached session)
  if (pathname === "/api/load" && req.method === "POST") {
    const body = await readBody(req);
    const filePath = body.path;
    if (!filePath) return error(res, "Missing 'path' field");
    try {
      // Reuse existing session for the same file
      for (const [existingId, s] of sessions) {
        if (s.sourcePath === filePath) {
          const hasEdits = JSON.stringify(s.workingTurns) !== JSON.stringify(s.originalTurns);
          return json(res, {
            sessionId: existingId,
            format: s.format,
            hasEdits,
            turns: summarizeTurns(s.workingTurns),
          });
        }
      }
      // New session
      const format = detectFormat(filePath);
      const turns = parseTranscript(filePath);
      const id = "s" + (++sessionCounter);
      sessions.set(id, {
        originalTurns: JSON.parse(JSON.stringify(turns)),
        workingTurns: turns,
        sourcePath: filePath,
        format,
      });
      return json(res, {
        sessionId: id,
        format,
        hasEdits: false,
        turns: summarizeTurns(turns),
      });
    } catch (e) {
      return error(res, `Failed to parse: ${e.message}`, 500);
    }
  }

  // POST /api/edit — update a turn's user text
  if (pathname === "/api/edit" && req.method === "POST") {
    const body = await readBody(req);
    const { sessionId, turnIndex, user_text } = body;
    const session = sessions.get(sessionId);
    if (!session) return error(res, "Unknown session", 404);
    const turn = session.workingTurns.find((t) => t.index === turnIndex);
    if (!turn) return error(res, `Turn ${turnIndex} not found`, 404);
    turn.user_text = user_text;
    const hasEdits = JSON.stringify(session.workingTurns) !== JSON.stringify(session.originalTurns);
    return json(res, { ok: true, hasEdits });
  }

  // POST /api/preview — render HTML for live preview
  if (pathname === "/api/preview" && req.method === "POST") {
    const body = await readBody(req);
    const { sessionId, options = {} } = body;
    const session = sessions.get(sessionId);
    if (!session) return error(res, "Unknown session", 404);
    const turns = prepareTurns(session, options);
    const html = render(turns, buildRenderOpts(options, session));
    return json(res, { html });
  }

  // POST /api/export — render HTML and serve as download
  if (pathname === "/api/export" && req.method === "POST") {
    const body = await readBody(req);
    const { sessionId, options = {} } = body;
    const session = sessions.get(sessionId);
    if (!session) return error(res, "Unknown session", 404);
    const turns = prepareTurns(session, options);
    const html = render(turns, buildRenderOpts(options, session, {
      minified: options.minified !== false,
      compress: options.compress !== false,
    }));
    const filename = (options.title || "replay").replace(/[^a-zA-Z0-9_-]/g, "_") + ".html";
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": Buffer.byteLength(html),
    });
    return res.end(html);
  }

  // POST /api/reset — restore working turns from original
  if (pathname === "/api/reset" && req.method === "POST") {
    const body = await readBody(req);
    const { sessionId } = body;
    const session = sessions.get(sessionId);
    if (!session) return error(res, "Unknown session", 404);
    session.workingTurns = JSON.parse(JSON.stringify(session.originalTurns));
    return json(res, { turns: summarizeTurns(session.workingTurns) });
  }

  return error(res, "Not found", 404);
}

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

/**
 * Start the editor HTTP server.
 * Returns a promise that never resolves (keeps the caller waiting).
 * @param {number} port
 * @returns {Promise<void>}
 */
export function startEditor(port, { open = true } = {}) {
  const editorHtml = readFileSync(EDITOR_HTML_PATH, "utf-8");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    try {
      if (pathname === "/" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": Buffer.byteLength(editorHtml),
        });
        return res.end(editorHtml);
      }

      if (pathname.startsWith("/api/")) {
        return await handleApi(req, res, pathname);
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    } catch (e) {
      console.error("Server error:", e);
      if (!res.headersSent) {
        error(res, "Internal server error", 500);
      }
    }
  });

  return new Promise((_resolve) => {
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`Error: port ${port} is already in use. Stop the other process or use --port to pick a different port.`);
      } else {
        console.error(`Error: ${err.message}`);
      }
      process.exit(1);
    });
    server.listen(port, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${port}`;
      console.log(`claude-replay editor running at ${url}`);
      console.log("Press Ctrl+C to stop.\n");
      if (open) {
        const cmd = process.platform === "darwin" ? "open"
          : process.platform === "win32" ? "start" : "xdg-open";
        execFile(cmd, [url], () => {});
      }
    });
  });
}
