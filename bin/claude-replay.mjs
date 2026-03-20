#!/usr/bin/env node

/**
 * CLI entry point for claude-replay.
 */

import { parseArgs } from "node:util";
import { basename, dirname, resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, watch as fsWatch } from "node:fs";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { parseTranscript, filterTurns, detectFormat, applyPacedTiming } from "../src/parser.mjs";
import { render } from "../src/renderer.mjs";
import { getTheme, loadThemeFile, listThemes } from "../src/themes.mjs";
import { extractData } from "../src/extract.mjs";

const options = {
  port: { type: "string" },
  host: { type: "string" },
  "no-origin-check": { type: "boolean", default: false },
  output: { type: "string", short: "o" },
  turns: { type: "string" },
  "exclude-turns": { type: "string" },
  from: { type: "string" },
  to: { type: "string" },
  speed: { type: "string", default: "1" },
  "no-thinking": { type: "boolean", default: false },
  "no-tool-calls": { type: "boolean", default: false },
  theme: { type: "string", default: "tokyo-night" },
  "theme-file": { type: "string" },
  "list-themes": { type: "boolean", default: false },
  "no-auto-redact": { type: "boolean", default: false },
  redact: { type: "string", multiple: true },
  title: { type: "string" },
  description: { type: "string" },
  "og-image": { type: "string" },
  "user-label": { type: "string", default: "User" },
  "assistant-label": { type: "string" },
  timing: { type: "string" },
  mark: { type: "string", multiple: true },
  bookmarks: { type: "string" },
  "no-minify": { type: "boolean", default: false },
  "no-compress": { type: "boolean", default: false },
  format: { type: "string" },
  serve: { type: "boolean", default: false },
  watch: { type: "boolean", default: false },
  open: { type: "boolean", default: false },
  version: { type: "boolean", short: "v", default: false },
  help: { type: "boolean", short: "h", default: false },
};

let parsed;
try {
  parsed = parseArgs({ options, allowPositionals: true });
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}

const { values, positionals } = parsed;

if (values.version) {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  console.log(pkg.version);
  process.exit(0);
}

if (values["list-themes"]) {
  for (const name of listThemes()) {
    console.log(name);
  }
  process.exit(0);
}

// --- Editor (default when no args, or explicit "editor" subcommand) ---
if (positionals.length === 0 || positionals[0] === "editor") {
  if (positionals[0] === "editor" || !values.help) {
    const { startEditor } = await import("../src/editor-server.mjs");
    const port = values.port ? parseInt(values.port, 10) : 7331;
    const host = values.host || "127.0.0.1";
    // Optional: auto-load a file or session ID
    let initialFile;
    const editorArg = positionals[0] === "editor" ? positionals[1] : undefined;
    if (editorArg) {
      if (existsSync(editorArg)) {
        initialFile = resolve(editorArg);
      } else if (!editorArg.endsWith(".jsonl")) {
        const { resolveSessionId } = await import("../src/resolve-session.mjs");
        const matches = resolveSessionId(editorArg);
        if (matches.length === 1) {
          initialFile = matches[0].path;
          console.error(`Found: ${matches[0].group} / ${matches[0].project} → ${matches[0].path}`);
        } else if (matches.length > 1) {
          console.error(`Multiple sessions match "${editorArg}":`);
          for (let i = 0; i < matches.length; i++) {
            console.error(`  ${i + 1}) ${matches[i].group} / ${matches[i].project} — ${matches[i].path}`);
          }
          process.exit(1);
        } else {
          console.error(`Warning: no session found matching "${editorArg}", opening editor without auto-load`);
        }
      } else {
        console.error(`Error: file not found: ${editorArg}`);
        process.exit(1);
      }
    }
    await startEditor(port, { host, initialFile, noOriginCheck: values["no-origin-check"] });
    // startEditor returns a promise that never resolves — server stays running
  }
}

if (values.help) {
  console.log(`Usage: claude-replay [--port N]         Launch the web editor (default)
       claude-replay editor [file|id]               Launch editor with a session auto-loaded
       claude-replay <input> [input2...] [options]  Generate replay from CLI
       claude-replay extract <replay.html> [-o output.jsonl]

Convert Claude Code session transcripts into embeddable HTML replays.

<input> can be a .jsonl file path or a session ID. If it does not end in
.jsonl and is not an existing file, it is treated as a session ID and
searched in ~/.claude/projects/ and ~/.cursor/projects/.

Multiple inputs are concatenated into a single replay (up to 20). Sessions
with timestamps are sorted chronologically; otherwise command-line order is
used. Turns are re-indexed sequentially.

Commands:
  (no args)             Launch web-based editor UI (default)
  editor [file|id]      Launch editor with a file or session ID auto-loaded
  extract               Extract embedded turn data from a generated replay HTML

Options:
  --port N                Port for the editor server (default: 7331)
  --host ADDR             Bind address for the editor server (default: 127.0.0.1)
  --no-origin-check       Disable CSRF origin check (use with caution)
  -o, --output FILE       Output HTML file (default: stdout)
  --turns N-M             Only include turns N through M
  --exclude-turns N,N,... Exclude specific turns by index
  --from TIMESTAMP        Start time filter (ISO 8601)
  --to TIMESTAMP          End time filter (ISO 8601)
  --speed N               Initial playback speed (default: 1.0)
  --no-thinking           Hide thinking blocks by default
  --no-tool-calls         Hide tool call blocks by default
  --title TEXT             Page title (default: derived from input path)
  --description TEXT       Meta description for link previews (default: "Interactive AI session replay")
  --og-image URL          OG image URL for link previews (default: hosted default)
  --no-auto-redact        Disable automatic secret redaction
  --redact "text"         Replace text with [REDACTED] (repeatable)
  --redact "text=repl"    Replace text with custom replacement (repeatable)
  --theme NAME            Built-in theme (default: tokyo-night)
  --theme-file FILE       Custom theme JSON file (overrides --theme)
  --user-label NAME       Label for user messages (default: User)
  --assistant-label NAME  Label for assistant messages (default: auto-detected)
  --timing MODE           Timestamp mode: auto, real, paced (default: auto)
  --mark "N:Label"        Add a bookmark at turn N (repeatable)
  --bookmarks FILE        JSON file with bookmarks [{turn, label}]
  --no-minify             Use unminified template (default: minified if available)
  --no-compress           Embed raw JSON instead of compressed (for older browsers)
  --serve                 Serve the replay on a local HTTP server instead of writing to file
  --watch                 Watch input files for changes and auto-regenerate
  --open                  Open the generated HTML in the default browser
  --list-themes           List available built-in themes and exit
  -h, --help              Show this help message`);
  process.exit(0);
}

// --- Extract subcommand ---
if (positionals[0] === "extract") {
  const htmlFile = positionals[1];
  if (!htmlFile) {
    console.error("Error: input file is required. Usage: claude-replay extract <replay.html> [-o output.jsonl] [--format jsonl|json]");
    process.exit(1);
  }
  if (!existsSync(htmlFile)) {
    console.error(`Error: file not found: ${htmlFile}`);
    process.exit(1);
  }
  const html = readFileSync(htmlFile, "utf-8");
  let data;
  try {
    data = extractData(html);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  const fmt = values.format || "jsonl";
  if (fmt !== "json" && fmt !== "jsonl") {
    console.error(`Error: unknown --format "${fmt}". Use jsonl (default) or json.`);
    process.exit(1);
  }
  let output;
  if (fmt === "json") {
    output = JSON.stringify(data, null, 2);
  } else {
    // Embed bookmarks into turns
    const bmMap = new Map(data.bookmarks.map((bm) => [bm.turn, bm.label]));
    const lines = data.turns.map((t) => {
      const label = bmMap.get(t.index);
      return JSON.stringify(label ? { ...t, bookmark: label } : t);
    });
    output = lines.join("\n");
  }
  if (values.output) {
    writeFileSync(values.output, output);
    console.error(`Wrote ${values.output} (${data.turns.length} turns, ${data.bookmarks.length} bookmarks)`);
  } else {
    process.stdout.write(output + "\n");
  }
  process.exit(0);
}

// Resolve all input files (paths or session IDs)
const MAX_INPUTS = 20;
if (positionals.length > MAX_INPUTS) {
  console.error(`Error: too many input files (max ${MAX_INPUTS})`);
  process.exit(1);
}

const inputFiles = [];
for (const arg of positionals) {
  if (existsSync(arg)) {
    inputFiles.push(arg);
  } else if (!arg.endsWith(".jsonl")) {
    // Treat as session ID
    const { resolveSessionId } = await import("../src/resolve-session.mjs");
    const matches = resolveSessionId(arg);
    if (matches.length === 0) {
      console.error(`Error: no session found matching "${arg}"`);
      console.error("Searched ~/.claude/projects/, ~/.cursor/projects/, and ~/.codex/sessions/");
      process.exit(1);
    } else if (matches.length === 1) {
      inputFiles.push(matches[0].path);
      console.error(`Found: ${matches[0].group} / ${matches[0].project} → ${matches[0].path}`);
    } else {
      console.error(`Multiple sessions match "${arg}":`);
      for (let i = 0; i < matches.length; i++) {
        console.error(`  ${i + 1}) ${matches[i].group} / ${matches[i].project} — ${matches[i].path}`);
      }
      process.exit(1);
    }
  } else {
    console.error(`Error: file not found: ${arg}`);
    process.exit(1);
  }
}

// Resolve theme
let theme;
if (values["theme-file"]) {
  if (!existsSync(values["theme-file"])) {
    console.error(`Error: theme file not found: ${values["theme-file"]}`);
    process.exit(1);
  }
  try {
    theme = loadThemeFile(values["theme-file"]);
  } catch (e) {
    console.error(`Error loading theme file: ${e.message}`);
    process.exit(1);
  }
} else {
  try {
    theme = getTheme(values.theme);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

// Parse turn range
let turnRange;
if (values.turns) {
  const parts = values.turns.split("-");
  if (parts.length !== 2) {
    console.error(`Error: invalid turn range '${values.turns}' (expected N-M)`);
    process.exit(1);
  }
  const start = parseInt(parts[0], 10);
  const end = parseInt(parts[1], 10);
  if (isNaN(start) || isNaN(end)) {
    console.error(`Error: invalid turn range '${values.turns}' (expected integers)`);
    process.exit(1);
  }
  turnRange = [start, end];
}

// Parse excluded turns
let excludeTurns;
if (values["exclude-turns"]) {
  excludeTurns = values["exclude-turns"].split(",").map((s) => {
    const n = parseInt(s.trim(), 10);
    if (isNaN(n)) {
      console.error(`Error: invalid turn number '${s.trim()}' in --exclude-turns`);
      process.exit(1);
    }
    return n;
  });
}

// Validate timing mode early
const timing = values.timing || "auto";
if (!["auto", "real", "paced"].includes(timing)) {
  console.error(`Error: unknown --timing mode "${timing}". Use auto, real, or paced.`);
  process.exit(1);
}

const speed = parseFloat(values.speed) || 1.0;

// Derive title: CLI override > parent folder name > filename
let title = values.title;
if (!title) {
  const dir = basename(dirname(inputFiles[0]));
  const parts = dir.replace(/^-+/, "").split("-");
  const projectName = parts.length > 1 ? parts.slice(-2).join("-") : parts[0];
  if (projectName && projectName !== "." && projectName !== "/") {
    title = "Replay — " + projectName;
  } else {
    title = "Replay — " + basename(inputFiles[0], ".jsonl");
  }
}

// Parse bookmarks from --mark and --bookmarks (static, parsed once)
let cliBookmarks = [];

if (values.mark) {
  for (const m of values.mark) {
    const sep = m.indexOf(":");
    if (sep === -1) {
      console.error(`Error: invalid --mark format '${m}' (expected N:Label)`);
      process.exit(1);
    }
    const turn = parseInt(m.slice(0, sep), 10);
    const label = m.slice(sep + 1);
    if (isNaN(turn)) {
      console.error(`Error: invalid turn number in --mark '${m}'`);
      process.exit(1);
    }
    cliBookmarks.push({ turn, label });
  }
}

if (values.bookmarks) {
  if (!existsSync(values.bookmarks)) {
    console.error(`Error: bookmarks file not found: ${values.bookmarks}`);
    process.exit(1);
  }
  try {
    const data = JSON.parse(readFileSync(values.bookmarks, "utf-8"));
    if (!Array.isArray(data)) {
      console.error("Error: bookmarks file must contain a JSON array");
      process.exit(1);
    }
    for (const item of data) {
      if (typeof item.turn !== "number" || typeof item.label !== "string") {
        console.error(`Error: each bookmark must have numeric 'turn' and string 'label'`);
        process.exit(1);
      }
      cliBookmarks.push({ turn: item.turn, label: item.label });
    }
  } catch (e) {
    if (e.message.startsWith("Error:")) throw e;
    console.error(`Error: failed to parse bookmarks file: ${e.message}`);
    process.exit(1);
  }
}

// Parse --redact rules (static, parsed once)
let redactRules;
if (values.redact) {
  redactRules = values.redact.map((r) => {
    const eqIdx = r.indexOf("=");
    if (eqIdx === -1) return { search: r, replacement: "[REDACTED]" };
    return { search: r.slice(0, eqIdx), replacement: r.slice(eqIdx + 1) };
  });
}

/** Parse input files and render to HTML. Can be called repeatedly for --watch. */
function buildReplay() {
  let format = detectFormat(inputFiles[0]);
  let allTurns = [];
  for (const file of inputFiles) {
    const fileTurns = parseTranscript(file);
    if (inputFiles.length > 1) {
      const f = detectFormat(file);
      if (f === "cursor") format = "cursor";
    }
    allTurns.push(...fileTurns);
  }

  if (inputFiles.length > 1) {
    const allHaveTimestamps = allTurns.length > 0 && allTurns.every((t) => t.timestamp);
    if (allHaveTimestamps) {
      allTurns.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }
    for (let i = 0; i < allTurns.length; i++) {
      allTurns[i].index = i + 1;
    }
    console.error(`Merged ${inputFiles.length} sessions (${allTurns.length} turns total)`);
  }

  let turns = filterTurns(allTurns, {
    turnRange,
    excludeTurns,
    timeFrom: values.from,
    timeTo: values.to,
  });

  const indexMap = new Map();
  for (let i = 0; i < turns.length; i++) {
    indexMap.set(turns[i].index, i + 1);
    turns[i].index = i + 1;
  }

  if (turns.length === 0) {
    console.error("Warning: no turns found after filtering.");
  }

  const hasTimestamps = turns.some((t) => t.timestamp);
  if (timing === "paced" || (timing === "auto" && !hasTimestamps)) {
    applyPacedTiming(turns);
  }

  let bookmarks = cliBookmarks
    .map((bm) => ({ turn: indexMap.get(bm.turn), label: bm.label }))
    .filter((bm) => bm.turn != null);

  for (const t of turns) {
    if (t.bookmark) {
      bookmarks.push({ turn: t.index, label: t.bookmark });
      delete t.bookmark;
    }
  }
  bookmarks.sort((a, b) => a.turn - b.turn);

  const html = render(turns, {
    speed,
    showThinking: !values["no-thinking"],
    showToolCalls: !values["no-tool-calls"],
    theme,
    redactSecrets: !values["no-auto-redact"],
    redactRules,
    userLabel: values["user-label"],
    assistantLabel: values["assistant-label"] || (format === "codex" ? "Codex" : format === "cursor" ? "Assistant" : "Claude"),
    title,
    description: values.description,
    ogImage: values["og-image"],
    bookmarks,
    minified: !values["no-minify"],
    compress: !values["no-compress"],
  });

  return { html, turnCount: turns.length };
}

// ---------------------------------------------------------------------------
// --serve and --watch mode
// ---------------------------------------------------------------------------

if (values.serve) {
  const servePort = values.port ? parseInt(values.port, 10) : 7332;
  let currentHtml = "";
  let currentTurnCount = 0;
  let buildVersion = 0;

  function rebuild() {
    try {
      const { html, turnCount } = buildReplay();
      currentHtml = html;
      currentTurnCount = turnCount;
      buildVersion++;
      console.error(`[${new Date().toLocaleTimeString()}] Built replay (${turnCount} turns, v${buildVersion})`);
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Build error: ${e.message}`);
    }
  }

  const reloadScript = `<script>
(function() {
  var v = /*BUILD_VERSION*/;
  setInterval(function() {
    fetch("/__reload").then(function(r) { return r.json(); }).then(function(d) {
      if (d.version > v) {
        v = d.version;
        var turns = document.querySelectorAll(".turn");
        var totalOld = turns.length;
        var pos = 0;
        for (var i = turns.length - 1; i >= 0; i--) {
          if (turns[i].classList.contains("visible")) { pos = i + 1; break; }
        }
        var atEnd = pos >= totalOld && totalOld > 0;
        var target = atEnd ? d.turns : pos;
        location.hash = "turn=" + target + (atEnd ? "r" : "");
        location.reload();
      }
    }).catch(function() {});
  }, 1000);
})();
</script>`;

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/__reload") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ version: buildVersion, turns: currentTurnCount }));
    }
    const antiFlash = '<script>if(location.hash)document.write("<style>#splash{display:none!important}</style>")<' + '/script>';
    const html = currentHtml
      .replace("</head>", antiFlash + "</head>")
      .replace("</body>", reloadScript.replace("/*BUILD_VERSION*/", String(buildVersion)) + "</body>");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  rebuild();

  if (values.watch) {
    let debounce;
    for (const file of inputFiles) {
      fsWatch(file, () => {
        clearTimeout(debounce);
        debounce = setTimeout(rebuild, 300);
      });
    }
    console.error(`Watching ${inputFiles.length} file(s) for changes...`);
  }

  server.listen(servePort, () => {
    const url = `http://127.0.0.1:${servePort}`;
    console.error(`Serving replay at ${url}`);
    if (values.open) {
      const cmd = process.platform === "darwin" ? "open"
        : process.platform === "win32" ? "start" : "xdg-open";
      execFile(cmd, [url], () => {});
    }
  });
} else if (values.watch) {
  // --watch without --serve: write to file on each change
  if (!values.output) {
    console.error("Error: --watch without --serve requires -o/--output");
    process.exit(1);
  }

  function rebuild() {
    try {
      const { html, turnCount } = buildReplay();
      writeFileSync(values.output, html);
      console.error(`[${new Date().toLocaleTimeString()}] Wrote ${values.output} (${turnCount} turns)`);
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Build error: ${e.message}`);
    }
  }

  rebuild();
  let debounce;
  for (const file of inputFiles) {
    fsWatch(file, () => {
      clearTimeout(debounce);
      debounce = setTimeout(rebuild, 300);
    });
  }
  console.error(`Watching ${inputFiles.length} file(s) for changes...`);
} else {
  // Normal mode: build once and output
  const { html, turnCount } = buildReplay();

  if (values.output) {
    writeFileSync(values.output, html);
    console.error(`Wrote ${values.output} (${turnCount} turns)`);
    if (values.open) {
      const cmd = process.platform === "darwin" ? "open"
        : process.platform === "win32" ? "start" : "xdg-open";
      execFile(cmd, [values.output], () => {});
    }
  } else {
    if (values.open) {
      console.error("Warning: --open requires -o/--output (cannot open stdout output)");
    }
    process.stdout.write(html);
  }
}
