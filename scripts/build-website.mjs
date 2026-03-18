#!/usr/bin/env node

/**
 * Build the static website (docs/index.html) for GitHub Pages.
 * Uses esbuild to bundle src/browser.mjs for the browser,
 * then generates a self-contained HTML page.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { listThemes } from "../src/themes.mjs";

// Bundle browser.mjs for the browser
const result = await build({
  entryPoints: ["src/browser.mjs"],
  bundle: true,
  format: "iife",
  globalName: "ClaudeReplay",
  platform: "browser",
  target: "es2020",
  write: false,
  alias: {
    "node:fs": "./scripts/shims/empty.mjs",
    "node:zlib": "./scripts/shims/empty.mjs",
    "node:url": "./scripts/shims/empty.mjs",
  },
});
const bundleJs = result.outputFiles[0].text;

// Read the player template
let playerTemplate;
try {
  playerTemplate = readFileSync(new URL("../template/player.min.html", import.meta.url), "utf-8");
} catch {
  playerTemplate = readFileSync(new URL("../template/player.html", import.meta.url), "utf-8");
}

// Read the demo fixture
const demoFixture = readFileSync(new URL("../docs/demo-session.jsonl", import.meta.url), "utf-8");

// Escape for safe embedding in <script>
function safeStringify(str) {
  return JSON.stringify(str)
    .replace(/<\//g, "<\\/")
    .replace(/<!--/g, "<\\!--")
    .replace(/<script/gi, "\\x3cscript");
}

// Build theme options
const themeNames = listThemes();
const themeOptions = themeNames
  .map((name) => `<option value="${name}"${name === "tokyo-night" ? " selected" : ""}>${name}</option>`)
  .join("");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>claude-replay — Turn AI coding sessions into shareable HTML replays</title>
<meta name="description" content="Convert Claude Code, Cursor, and Codex session logs into interactive, self-contained HTML replays.">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='14' fill='none' stroke='%23bb9af7' stroke-width='2'/><polygon points='12,8 12,24 24,16' fill='%23bb9af7'/></svg>">
<style>
:root {
  --bg: #1a1b26;
  --bg-surface: #1f2335;
  --bg-hover: #292e42;
  --text: #c0caf5;
  --text-dim: #565f89;
  --text-bright: #c0caf5;
  --accent: #bb9af7;
  --accent-dim: #3d3261;
  --border: #292e42;
  --green: #9ece6a;
  --red: #f7768e;
  --blue: #7aa2f7;
  --orange: #ff9e64;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code { background: var(--bg-surface); padding: 2px 6px; border-radius: 4px; font-size: 13px; }
.container { max-width: 900px; margin: 0 auto; padding: 0 24px; }

/* Hero */
.hero { text-align: center; padding: 60px 0 40px; }
.hero h1 { font-size: 36px; color: var(--text-bright); margin-bottom: 12px; }
.hero h1 .accent { color: var(--accent); }
.hero p { font-size: 18px; color: var(--text); max-width: 600px; margin: 0 auto 10px; }
.hero .sub { font-size: 14px; color: var(--text-dim); margin-bottom: 24px; }
.hero-actions { display: flex; gap: 12px; justify-content: center; align-items: center; flex-wrap: wrap; }
.install-box {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 6px 16px; border-radius: 8px;
  background: var(--bg-surface); border: 1px solid var(--border);
  cursor: pointer; transition: all 0.15s;
  font-size: 13px;
}
.install-box:hover { border-color: var(--accent-dim); background: var(--bg-hover); }
.install-box code { background: none; padding: 0; font-size: 13px; color: var(--text-bright); }
.install-box .copy-feedback { font-size: 11px; color: var(--green); opacity: 0; transition: opacity 0.2s; }
.install-box.copied .copy-feedback::after { content: "copied!"; }
.install-box.copied .copy-feedback { opacity: 1; }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; border: 1px solid var(--border); background: var(--bg-surface); color: var(--text); cursor: pointer; transition: all 0.15s; }
.btn:hover { background: var(--bg-hover); border-color: var(--accent-dim); color: var(--text-bright); text-decoration: none; }
.btn-primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
.btn-primary:hover { background: #a78bfa; color: var(--bg); }

/* Try it */
.try-section { padding: 20px 0; }
.try-section h2 { font-size: 24px; color: var(--text-bright); margin-bottom: 16px; text-align: center; }
.drop-zone { border: 2px dashed var(--border); border-radius: 12px; padding: 48px; text-align: center; cursor: pointer; transition: all 0.2s; margin-bottom: 16px; }
.drop-zone:hover, .drop-zone.drag-over { border-color: var(--accent); background: var(--accent-dim); }
.drop-zone p { color: var(--text-dim); font-size: 15px; }
.drop-zone .drop-icon { font-size: 36px; margin-bottom: 8px; }
.drop-zone input[type="file"] { display: none; }
.try-section.loaded .drop-zone { display: none; }
.try-section.loaded .preview-frame { display: block; }
.try-section.loaded .export-section { display: block; }
.loaded-bar { display: none; font-size: 13px; color: var(--text-dim); padding: 8px 0; text-align: center; }
.try-section.loaded .loaded-bar { display: block; }
.loaded-bar a { margin-left: 8px; }

.editor-hint { display: none; font-size: 12px; color: var(--text-dim); text-align: center; margin-top: 12px; }
.try-section.loaded .editor-hint { display: block; }

/* Export section */
.export-section { display: none; }
.export-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.export-header h3 { font-size: 16px; color: var(--text-bright); }

/* Options */
.options-bar { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; padding: 12px 16px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; font-size: 12px; }
.options-bar label { color: var(--text-dim); display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.options-bar .tip { cursor: help; color: var(--text-dim); font-size: 10px; border: 1px solid var(--border); border-radius: 50%; width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; }
.options-bar select, .options-bar input[type="number"], .options-bar input[type="text"] { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; padding: 3px 6px; font-size: 12px; }
.options-bar select { min-width: 120px; }
.options-bar input[type="number"] { width: 55px; }
.options-bar input[type="text"] { width: 140px; }
.options-bar .spacer { flex: 1; }
.opt-group { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }

/* Preview */
.preview-frame { width: 100%; height: 600px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--bg-surface); display: none; margin-bottom: 24px; }
.preview-frame iframe { width: 100%; height: 100%; border: none; }
.status { text-align: center; padding: 8px; color: var(--text-dim); font-size: 13px; }

/* Features */
.features { padding: 48px 0; border-top: 1px solid var(--border); }
.features h2 { font-size: 24px; color: var(--text-bright); margin-bottom: 20px; text-align: center; }
.feature-grid { display: flex; flex-wrap: wrap; gap: 16px; justify-content: center; }
.feature-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; width: 200px; }
.feature-card h3 { font-size: 14px; color: var(--text-bright); margin-bottom: 6px; }
.feature-card p { font-size: 12px; color: var(--text-dim); }
.footer { padding: 24px 0; border-top: 1px solid var(--border); text-align: center; font-size: 12px; color: var(--text-dim); }
</style>
</head>
<body>
<div class="container">
  <div class="hero">
    <h1><span class="accent">claude-replay</span></h1>
    <p>Turn AI coding sessions into interactive, shareable HTML replays.</p>
    <p class="sub">Supports Claude Code, Cursor, and Codex transcripts. Single self-contained HTML file, zero dependencies.</p>
    <div class="hero-actions">
      <div class="install-box" id="installNpm" title="Click to copy">
        <code>npm install -g claude-replay</code>
        <span class="copy-feedback"></span>
      </div>
      <a class="btn" href="https://github.com/es617/claude-replay" target="_blank" rel="noopener">GitHub</a>
    </div>
  </div>

  <div class="try-section" id="try">
    <h2 style="font-size:20px">Try it online</h2>
    <div class="loaded-bar" id="loadedBar"></div>
    <div class="drop-zone" id="dropZone">
      <div class="drop-icon">&#128196;</div>
      <p>Drop a .jsonl session file here or <strong>click to browse</strong></p>
      <p style="margin-top:8px;font-size:12px">or <a href="#" id="tryDemo">load a demo session</a></p>
      <input type="file" id="fileInput" accept=".jsonl">
    </div>

    <div class="status" id="status"></div>
    <div class="preview-frame" id="previewFrame">
      <iframe id="previewIframe" sandbox="allow-scripts"></iframe>
    </div>

    <div class="export-section">
      <div class="export-header">
        <h3>Export</h3>
        <button class="btn btn-primary" id="downloadBtn">Download HTML</button>
      </div>
      <div class="options-bar">
        <label>Theme <span class="tip" title="Color scheme for the replay">?</span> <select id="optTheme">${themeOptions}</select></label>
        <label>Timing <span class="tip" title="Auto: use real timestamps if available, otherwise paced. Real: original timestamps. Paced: synthetic even spacing based on content length.">?</span>
          <select id="optTiming">
            <option value="auto" selected>Auto</option>
            <option value="real">Real</option>
            <option value="paced">Paced</option>
          </select>
        </label>
        <label>Title <span class="tip" title="Custom title shown in the replay header and browser tab">?</span> <input type="text" id="optTitle" placeholder="auto"></label>
        <label>Redact <span class="tip" title="Comma-separated text to replace with [REDACTED] in the output">?</span> <input type="text" id="optRedact" placeholder="text1, text2..."></label>
      </div>
      <p class="editor-hint">For full editing — exclude turns, add bookmarks, edit prompts — <a href="https://www.npmjs.com/package/claude-replay" target="_blank" rel="noopener">install the CLI</a> and run <code>claude-replay</code> to launch the desktop editor.</p>
    </div>
  </div>

  <div class="features">
    <h2>Features</h2>
    <div class="feature-grid">
      <div class="feature-card"><h3>Multi-format</h3><p>Supports Claude Code, Cursor, and Codex CLI transcripts. Auto-detected.</p></div>
      <div class="feature-card"><h3>Self-contained</h3><p>Single HTML file with no external dependencies. Email it, host it, embed it.</p></div>
      <div class="feature-card"><h3>Web Editor</h3><p>Built-in editor to browse sessions, edit prompts, exclude turns, and add bookmarks.</p></div>
      <div class="feature-card"><h3>Interactive Player</h3><p>Playback with speed control, keyboard shortcuts, diff views, and chapter navigation.</p></div>
      <div class="feature-card"><h3>Themes</h3><p>6 built-in themes plus custom theme support with full CSS override.</p></div>
      <div class="feature-card"><h3>Docker</h3><p>Run in a container with read-only session mounts for sandboxed usage.</p></div>
      <div class="feature-card"><h3>Privacy</h3><p>Everything runs locally. Automatic secret redaction for API keys, tokens, and secrets.</p></div>
    </div>
  </div>

  <div class="footer">
    <a href="https://github.com/es617/claude-replay" target="_blank" rel="noopener">GitHub</a> &middot;
    <a href="https://www.npmjs.com/package/claude-replay" target="_blank" rel="noopener">npm</a> &middot;
    Community tool — not affiliated with Anthropic
  </div>
</div>

<script data-goatcounter="https://es617.goatcounter.com/count" async src="//gc.zgo.at/count.js"><` + `/script>

<script>
${bundleJs}
const { parseTranscriptFromText, detectFormatFromText, applyPacedTiming, getTheme, renderFromTemplate } = ClaudeReplay;

const PLAYER_TEMPLATE = ${safeStringify(playerTemplate)};
const DEMO_FIXTURE = ${safeStringify(demoFixture)};

const $ = (id) => document.getElementById(id);
const dropZone = $("dropZone");
const fileInput = $("fileInput");
const status = $("status");
const previewFrame = $("previewFrame");
const previewIframe = $("previewIframe");
const downloadBtn = $("downloadBtn");

let currentTurns = null;
let currentFormat = null;
let currentFileName = "";

function processFile(text, filename) {
  try {
    const turns = parseTranscriptFromText(text);
    const format = detectFormatFromText(text);
    if (turns.length === 0) {
      status.textContent = "No turns found. Is this a supported transcript format?";
      return;
    }
    const timing = $("optTiming").value;
    const hasTimestamps = turns.some((t) => t.timestamp);
    if (timing === "paced" || (timing === "auto" && !hasTimestamps)) {
      applyPacedTiming(turns);
    }
    currentTurns = turns;
    currentFormat = format;
    currentFileName = filename;
    status.textContent = "";
    const trySection = dropZone.closest(".try-section");
    trySection.classList.add("loaded");
    $("loadedBar").innerHTML = "<strong>" + filename + "</strong> &mdash; " + turns.length + " turns (" + format + ")<a href='#' id='tryAnother'>Load another file</a>";
    $("tryAnother").addEventListener("click", (e) => {
      e.preventDefault();
      trySection.classList.remove("loaded");
      currentTurns = null;
      previewFrame.classList.remove("visible");
    });
    renderPreview();
  } catch (e) {
    status.textContent = "Error: " + e.message;
    console.error(e);
  }
}

function gatherOptions() {
  const theme = getTheme($("optTheme").value);
  const redactText = $("optRedact").value.trim();
  const redactRules = redactText
    ? redactText.split(",").map((s) => ({ search: s.trim(), replacement: "[REDACTED]" })).filter((r) => r.search)
    : [];
  return {
    theme,
    title: $("optTitle").value || "Replay — " + currentFileName.replace(".jsonl", ""),
    assistantLabel: currentFormat === "codex" ? "Codex" : currentFormat === "cursor" ? "Assistant" : "Claude",
    redactSecrets: true,
    redactRules,
  };
}

function renderPreview() {
  if (!currentTurns) return;
  const html = renderFromTemplate(PLAYER_TEMPLATE, currentTurns, gatherOptions());
  const blob = new Blob([html], { type: "text/html" });
  if (previewIframe.src.startsWith("blob:")) URL.revokeObjectURL(previewIframe.src);
  previewIframe.src = URL.createObjectURL(blob);
}

let renderTimeout;
function scheduleRender() {
  clearTimeout(renderTimeout);
  renderTimeout = setTimeout(renderPreview, 300);
}

// Install copy
$("installNpm").addEventListener("click", () => {
  navigator.clipboard.writeText("npm install -g claude-replay").then(() => {
    $("installNpm").classList.add("copied");
    setTimeout(() => $("installNpm").classList.remove("copied"), 2000);
  });
});

// Drop zone
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) file.text().then((text) => processFile(text, file.name));
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file) file.text().then((text) => processFile(text, file.name));
});

// Demo
$("tryDemo").addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  processFile(DEMO_FIXTURE, "demo-session.jsonl");
});

// Options
for (const id of ["optTheme", "optTiming"]) {
  $(id).addEventListener("change", scheduleRender);
}
$("optTitle").addEventListener("input", scheduleRender);
$("optRedact").addEventListener("input", scheduleRender);

// Download
downloadBtn.addEventListener("click", () => {
  if (!currentTurns) return;
  const html = renderFromTemplate(PLAYER_TEMPLATE, currentTurns, gatherOptions());
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = ($("optTitle").value || "replay").replace(/[^a-zA-Z0-9_-]/g, "_") + ".html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
<` + `/script>
</body>
</html>`;

writeFileSync(new URL("../docs/index.html", import.meta.url), html);
console.log(`Built docs/index.html (${html.length} bytes)`);
