#!/usr/bin/env node

/**
 * CLI entry point for claude-replay.
 */

import { parseArgs } from "node:util";
import { basename, dirname } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { parseTranscript, filterTurns, detectFormat, applyPacedTiming } from "../src/parser.mjs";
import { render } from "../src/renderer.mjs";
import { getTheme, loadThemeFile, listThemes } from "../src/themes.mjs";
import { extractData } from "../src/extract.mjs";

const options = {
  port: { type: "string" },
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

// --- Editor (default when no args, or explicit "editor" subcommand) ---
if (positionals.length === 0 || positionals[0] === "editor") {
  if (positionals[0] === "editor" || !values.help) {
    const { startEditor } = await import("../src/editor-server.mjs");
    const port = values.port ? parseInt(values.port, 10) : 7331;
    await startEditor(port);
    // startEditor returns a promise that never resolves — server stays running
  }
}

if (values.help) {
  console.log(`Usage: claude-replay [--port N]         Launch the web editor (default)
       claude-replay <input> [input2...] [options]  Generate replay from CLI
       claude-replay extract <replay.html> [-o output.json]

Convert Claude Code, Cursor, Codex CLI, and VS GitHub Chat transcripts into embeddable HTML replays.

<input> can be a .jsonl file path or a session ID. If it does not end in
.jsonl and is not an existing file, it is treated as a session ID and
searched in ~/.claude/projects/, ~/.cursor/projects/, ~/.codex/sessions/, ~/.vs-github-chat/sessions/, and VS Code workspaceStorage/*/chatSessions/.

Multiple inputs are concatenated into a single replay (up to 20). Sessions
with timestamps are sorted chronologically; otherwise command-line order is
used. Turns are re-indexed sequentially.

Commands:
  (no args)             Launch web-based editor UI (default)
  extract               Extract embedded turn data from a generated replay HTML

Options:
  --port N                Port for the editor server (default: 7331)
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
  --open                  Open the generated HTML in the default browser (requires -o)
  --list-themes           List available built-in themes and exit
  -h, --help              Show this help message`);
  process.exit(0);
}

if (values["list-themes"]) {
  for (const name of listThemes()) {
    console.log(name);
  }
  process.exit(0);
}

// --- Extract subcommand ---
if (positionals[0] === "extract") {
  const htmlFile = positionals[1];
  if (!htmlFile) {
    console.error("Error: input file is required. Usage: claude-replay extract <replay.html> [-o output.json]");
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
  const json = JSON.stringify(data, null, 2);
  if (values.output) {
    writeFileSync(values.output, json);
    console.error(`Wrote ${values.output} (${data.turns.length} turns, ${data.bookmarks.length} bookmarks)`);
  } else {
    process.stdout.write(json + "\n");
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
      console.error("Searched ~/.claude/projects/, ~/.cursor/projects/, ~/.codex/sessions/, ~/.vs-github-chat/sessions/, and VS Code workspaceStorage/*/chatSessions/");
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

// Parse all input files and concatenate turns
let format = detectFormat(inputFiles[0]);
let allTurns = [];
for (const file of inputFiles) {
  const fileTurns = parseTranscript(file);
  if (inputFiles.length > 1) {
    const f = detectFormat(file);
    if (f === "cursor") format = "cursor"; // if any is cursor, use cursor label
  }
  allTurns.push(...fileTurns);
}

// Sort by timestamp if all sessions have them, then re-index sequentially
if (inputFiles.length > 1) {
  const allHaveTimestamps = allTurns.length > 0 && allTurns.every((t) => t.timestamp);
  if (allHaveTimestamps) {
    allTurns.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }
  // Re-index sequentially
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

if (turns.length === 0) {
  console.error("Warning: no turns found after filtering.");
}

// Apply timing mode: auto (default), real, paced
const timing = values.timing || "auto";
if (!["auto", "real", "paced"].includes(timing)) {
  console.error(`Error: unknown --timing mode "${timing}". Use auto, real, or paced.`);
  process.exit(1);
}
const hasTimestamps = turns.some((t) => t.timestamp);
if (timing === "paced" || (timing === "auto" && !hasTimestamps)) {
  applyPacedTiming(turns);
}

const speed = parseFloat(values.speed) || 1.0;

// Derive title: CLI override > parent folder name > filename
let title = values.title;
if (!title) {
  const dir = basename(dirname(inputFiles[0]));
  // Claude projects dirs look like "-Users-enrico-Personal-project-name"
  // Extract the last segment as the project name
  const parts = dir.replace(/^-+/, "").split("-");
  const projectName = parts.length > 1 ? parts.slice(-2).join("-") : parts[0];
  if (projectName && projectName !== "." && projectName !== "/") {
    title = "Replay — " + projectName;
  } else {
    title = "Replay — " + basename(inputFiles[0], ".jsonl");
  }
}

// Parse bookmarks from --mark and --bookmarks
let bookmarks = [];

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
    bookmarks.push({ turn, label });
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
      bookmarks.push({ turn: item.turn, label: item.label });
    }
  } catch (e) {
    if (e.message.startsWith("Error:")) throw e;
    console.error(`Error: failed to parse bookmarks file: ${e.message}`);
    process.exit(1);
  }
}

bookmarks.sort((a, b) => a.turn - b.turn);

// Parse --redact rules
let redactRules;
if (values.redact) {
  redactRules = values.redact.map((r) => {
    const eqIdx = r.indexOf("=");
    if (eqIdx === -1) return { search: r, replacement: "[REDACTED]" };
    return { search: r.slice(0, eqIdx), replacement: r.slice(eqIdx + 1) };
  });
}

const html = render(turns, {
  speed,
  showThinking: !values["no-thinking"],
  showToolCalls: !values["no-tool-calls"],
  theme,
  redactSecrets: !values["no-auto-redact"],
  redactRules,
  userLabel: values["user-label"],
  assistantLabel: values["assistant-label"] || (format === "codex" ? "Codex" : format === "cursor" ? "Assistant" : format === "github-chat" ? "Copilot" : "Claude"),
  title,
  description: values.description,
  ogImage: values["og-image"],
  bookmarks,
  minified: !values["no-minify"],
  compress: !values["no-compress"],
});

if (values.output) {
  writeFileSync(values.output, html);
  console.error(`Wrote ${values.output} (${turns.length} turns)`);
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
