#!/usr/bin/env node

/**
 * CLI entry point for claude-replay.
 */

import { parseArgs } from "node:util";
import { basename, dirname } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseTranscript, filterTurns } from "../src/parser.mjs";
import { render } from "../src/renderer.mjs";
import { getTheme, loadThemeFile, listThemes } from "../src/themes.mjs";

const options = {
  output: { type: "string", short: "o" },
  turns: { type: "string" },
  from: { type: "string" },
  to: { type: "string" },
  speed: { type: "string", default: "1" },
  "no-thinking": { type: "boolean", default: false },
  "no-tool-calls": { type: "boolean", default: false },
  theme: { type: "string", default: "tokyo-night" },
  "theme-file": { type: "string" },
  "list-themes": { type: "boolean", default: false },
  "no-redact": { type: "boolean", default: false },
  title: { type: "string" },
  "user-label": { type: "string", default: "User" },
  "assistant-label": { type: "string", default: "Claude" },
  mark: { type: "string", multiple: true },
  bookmarks: { type: "string" },
  "scroll-top": { type: "boolean", default: false },
  "no-minify": { type: "boolean", default: false },
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

if (values.help) {
  console.log(`Usage: claude-replay <input.jsonl> [options]

Convert Claude Code session transcripts into embeddable HTML replays.

Options:
  -o, --output FILE       Output HTML file (default: stdout)
  --turns N-M             Only include turns N through M
  --from TIMESTAMP        Start time filter (ISO 8601)
  --to TIMESTAMP          End time filter (ISO 8601)
  --speed N               Initial playback speed (default: 1.0)
  --no-thinking           Hide thinking blocks by default
  --no-tool-calls         Hide tool call blocks by default
  --title TEXT             Page title (default: derived from input path)
  --no-redact             Disable secret redaction in output
  --theme NAME            Built-in theme (default: tokyo-night)
  --theme-file FILE       Custom theme JSON file (overrides --theme)
  --user-label NAME       Label for user messages (default: User)
  --assistant-label NAME  Label for assistant messages (default: Claude)
  --mark "N:Label"        Add a bookmark at turn N (repeatable)
  --bookmarks FILE        JSON file with bookmarks [{turn, label}]
  --scroll-top            Scroll top-to-bottom (default: bottom-to-top terminal style)
  --no-minify             Use unminified template (default: minified if available)
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

const inputFile = positionals[0];
if (!inputFile) {
  console.error("Error: input file is required. Usage: claude-replay <input.jsonl> [options]");
  process.exit(1);
}

if (!existsSync(inputFile)) {
  console.error(`Error: file not found: ${inputFile}`);
  process.exit(1);
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

// Parse and filter
let turns = parseTranscript(inputFile);
turns = filterTurns(turns, {
  turnRange,
  timeFrom: values.from,
  timeTo: values.to,
});

if (turns.length === 0) {
  console.error("Warning: no turns found after filtering.");
}

const speed = parseFloat(values.speed) || 1.0;

// Derive title: CLI override > parent folder name > filename
let title = values.title;
if (!title) {
  const dir = basename(dirname(inputFile));
  // Claude projects dirs look like "-Users-enrico-Personal-project-name"
  // Extract the last segment as the project name
  const parts = dir.replace(/^-+/, "").split("-");
  const projectName = parts.length > 1 ? parts.slice(-2).join("-") : parts[0];
  if (projectName && projectName !== "." && projectName !== "/") {
    title = "Replay — " + projectName;
  } else {
    title = "Replay — " + basename(inputFile, ".jsonl");
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

const html = render(turns, {
  speed,
  showThinking: !values["no-thinking"],
  showToolCalls: !values["no-tool-calls"],
  theme,
  redactSecrets: !values["no-redact"],
  userLabel: values["user-label"],
  assistantLabel: values["assistant-label"],
  title,
  bookmarks,
  scrollMode: values["scroll-top"] ? "top" : "bottom",
  minified: !values["no-minify"],
});

if (values.output) {
  writeFileSync(values.output, html);
  console.error(`Wrote ${values.output} (${turns.length} turns)`);
} else {
  process.stdout.write(html);
}
