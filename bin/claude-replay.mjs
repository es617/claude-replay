#!/usr/bin/env node

/**
 * CLI entry point for claude-replay.
 */

import { parseArgs } from "node:util";
import { existsSync, writeFileSync } from "node:fs";
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
  "no-tool-results": { type: "boolean", default: false },
  theme: { type: "string", default: "tokyo-night" },
  "theme-file": { type: "string" },
  "list-themes": { type: "boolean", default: false },
  "user-label": { type: "string", default: "User" },
  "assistant-label": { type: "string", default: "Claude" },
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
  --no-tool-results       Hide tool results by default
  --theme NAME            Built-in theme (default: tokyo-night)
  --theme-file FILE       Custom theme JSON file (overrides --theme)
  --user-label NAME       Label for user messages (default: User)
  --assistant-label NAME  Label for assistant messages (default: Claude)
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

const html = render(turns, {
  speed,
  showThinking: !values["no-thinking"],
  showToolCalls: !values["no-tool-calls"],
  showToolResults: !values["no-tool-results"],
  theme,
  userLabel: values["user-label"],
  assistantLabel: values["assistant-label"],
});

if (values.output) {
  writeFileSync(values.output, html);
  console.error(`Wrote ${values.output} (${turns.length} turns)`);
} else {
  process.stdout.write(html);
}
