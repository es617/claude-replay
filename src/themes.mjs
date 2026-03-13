/**
 * Built-in themes and custom theme loading.
 */

import { readFileSync } from "node:fs";

const THEME_VARS = [
  "bg", "bg-surface", "bg-hover",
  "text", "text-dim", "text-bright",
  "accent", "accent-dim",
  "green", "blue", "orange", "red", "cyan",
  "border", "tool-bg", "thinking-bg",
];

const BUILTIN_THEMES = {
  "tokyo-night": {
    "bg": "#1a1b26",
    "bg-surface": "#24253a",
    "bg-hover": "#2f3147",
    "text": "#c0caf5",
    "text-dim": "#565f89",
    "text-bright": "#e0e6ff",
    "accent": "#bb9af7",
    "accent-dim": "#7957a8",
    "green": "#9ece6a",
    "blue": "#7aa2f7",
    "orange": "#ff9e64",
    "red": "#f7768e",
    "cyan": "#7dcfff",
    "border": "#3b3d57",
    "tool-bg": "#1e1f33",
    "thinking-bg": "#1c1d2e",
  },
  "monokai": {
    "bg": "#272822",
    "bg-surface": "#2d2e27",
    "bg-hover": "#3e3d32",
    "text": "#f8f8f2",
    "text-dim": "#75715e",
    "text-bright": "#ffffff",
    "accent": "#ae81ff",
    "accent-dim": "#7c5cbf",
    "green": "#a6e22e",
    "blue": "#66d9ef",
    "orange": "#fd971f",
    "red": "#f92672",
    "cyan": "#66d9ef",
    "border": "#49483e",
    "tool-bg": "#1e1f1c",
    "thinking-bg": "#1c1d1a",
  },
  "solarized-dark": {
    "bg": "#002b36",
    "bg-surface": "#073642",
    "bg-hover": "#0a4050",
    "text": "#839496",
    "text-dim": "#586e75",
    "text-bright": "#fdf6e3",
    "accent": "#6c71c4",
    "accent-dim": "#4e5299",
    "green": "#859900",
    "blue": "#268bd2",
    "orange": "#cb4b16",
    "red": "#dc322f",
    "cyan": "#2aa198",
    "border": "#094959",
    "tool-bg": "#012934",
    "thinking-bg": "#012730",
  },
  "github-light": {
    "bg": "#ffffff",
    "bg-surface": "#f6f8fa",
    "bg-hover": "#eaeef2",
    "text": "#1f2328",
    "text-dim": "#656d76",
    "text-bright": "#000000",
    "accent": "#8250df",
    "accent-dim": "#6639ba",
    "green": "#1a7f37",
    "blue": "#0969da",
    "orange": "#bc4c00",
    "red": "#cf222e",
    "cyan": "#0598bc",
    "border": "#d0d7de",
    "tool-bg": "#f6f8fa",
    "thinking-bg": "#f0f3f6",
  },
  "vscode": {
    "bg": "#1e1e1e",
    "bg-surface": "#252526",
    "bg-hover": "#2a2d2e",
    "text": "#d4d4d4",
    "text-dim": "#858585",
    "text-bright": "#ffffff",
    "accent": "#007acc",
    "accent-dim": "#094771",
    "green": "#6a9955",
    "blue": "#569cd6",
    "orange": "#ce9178",
    "red": "#f44747",
    "cyan": "#4ec9b0",
    "border": "#3c3c3c",
    "tool-bg": "#252526",
    "thinking-bg": "#1f1f1f",
    "extraCss": `
      body {
        font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
        font-size: 13px;
      }
      code, pre, .diff-view {
        font-family: "Cascadia Code", "Consolas", "SF Mono", monospace;
      }
      .role-section {
        border-radius: 6px;
      }
      .role-section.role-user {
        border: 1px solid var(--border);
        border-left: 3px solid var(--accent);
      }
      .role-section.role-assistant {
        background: color-mix(in srgb, var(--bg) 85%, var(--bg-surface) 15%);
        border: 1px solid #2d2d2d;
        border-left: 3px solid var(--cyan);
      }
      .turn-header {
        background: #2d2d2d;
      }
      .assistant-text {
        line-height: 1.7;
      }
      .tool-block, .tool-group-header {
        border-radius: 4px;
      }
    `,
  },
  "copilot": {
    "bg": "#0d1117",
    "bg-surface": "#161b22",
    "bg-hover": "#1f2630",
    "text": "#d7deea",
    "text-dim": "#9aa6b8",
    "text-bright": "#f4f7ff",
    "accent": "#6cb6ff",
    "accent-dim": "#27496d",
    "green": "#6ccf8a",
    "blue": "#6cb6ff",
    "orange": "#ffc26f",
    "red": "#ff8f8f",
    "cyan": "#8ab4ff",
    "border": "#2f3947",
    "tool-bg": "#11161d",
    "thinking-bg": "#131923",
    "extraCss": `
      body {
        font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
        font-size: 13px;
      }
      code, pre, .diff-view {
        font-family: "Cascadia Code", "Consolas", "SF Mono", monospace;
      }
      .role-section {
        border-radius: 8px;
      }
      .role-section.role-user {
        background: color-mix(in srgb, #1f4f80 58%, var(--bg) 42%);
        border: 1px solid color-mix(in srgb, #6cb6ff 28%, var(--border) 72%);
        border-left: 3px solid var(--accent);
      }
      .role-section.role-assistant {
        background: color-mix(in srgb, var(--bg) 84%, var(--bg-surface) 16%);
        border: 1px solid color-mix(in srgb, #8ab4ff 18%, var(--border) 82%);
        border-left: 3px solid var(--cyan);
      }
      .turn-header {
        background: #1b2230;
      }
      .assistant-text {
        line-height: 1.72;
      }
      .assistant-text pre, .user-text pre, .thinking-body pre {
        background: #0f141b;
      }
      .tool-block, .tool-group-header {
        background: #121923;
        border-radius: 6px;
      }
    `,
  },
  "dracula": {
    "bg": "#282a36",
    "bg-surface": "#2d2f3d",
    "bg-hover": "#383a4a",
    "text": "#f8f8f2",
    "text-dim": "#6272a4",
    "text-bright": "#ffffff",
    "accent": "#bd93f9",
    "accent-dim": "#9571d1",
    "green": "#50fa7b",
    "blue": "#8be9fd",
    "orange": "#ffb86c",
    "red": "#ff5555",
    "cyan": "#8be9fd",
    "border": "#44475a",
    "tool-bg": "#21222c",
    "thinking-bg": "#1e1f29",
  },
  "bubbles": {
    "bg": "#f0f2f5",
    "bg-surface": "#ffffff",
    "bg-hover": "#e4e6eb",
    "text": "#1c1e21",
    "text-dim": "#65676b",
    "text-bright": "#000000",
    "accent": "#0084ff",
    "accent-dim": "#0066cc",
    "green": "#31a24c",
    "blue": "#0084ff",
    "orange": "#f5a623",
    "red": "#e4405f",
    "cyan": "#0097a7",
    "border": "#dddfe2",
    "tool-bg": "#e4e6eb",
    "thinking-bg": "#e8daef",
    "extraCss": `
      .turn { margin-bottom: 16px; }
      .user-msg {
        display: flex; align-items: flex-end; justify-content: flex-end; gap: 8px; margin-bottom: 12px;
      }
      .user-msg::after {
        content: "\\1F464"; font-size: 24px; flex-shrink: 0; line-height: 1;
      }
      .user-prompt { display: none; }
      .user-text {
        background: #0084ff; color: #fff; border-radius: 18px 18px 4px 18px;
        padding: 10px 16px; max-width: 75%; display: inline-block; font-weight: normal;
      }
      .turn-header-ts { color: #fff8; }
      .turn > :not(.user-msg):not(.block-wrapper) { padding-left: 40px; }
      .block-wrapper { padding-left: 40px; position: relative; }
      .block-wrapper::before {
        content: "\\1F916"; position: absolute; left: 4px; top: 4px; font-size: 20px; line-height: 1;
      }
      .block-wrapper + .block-wrapper::before { content: none; }
      .assistant-text {
        background: #fff; border-radius: 18px 18px 18px 4px;
        padding: 10px 16px; max-width: 85%; display: inline-block; color: #1c1e21;
        border: 1px solid #dddfe2;
      }
      .thinking-block {
        background: #f3ebfa; border-radius: 18px 18px 18px 4px;
        padding: 10px 16px; max-width: 85%; border: 1px solid #d6c8e4;
      }
      .thinking-header { color: #6b3fa0; }
      .thinking-body { color: #3d2066; }
      .tool-block, .tool-group {
        background: #fff; border-radius: 12px;
        padding: 8px 12px; max-width: 85%; border: 1px solid #dddfe2;
      }
      .tool-header { color: #1c1e21; }
      .tool-name { color: #0066cc; }
      .bookmark-divider { color: #1c1e21; border-color: #dddfe2; }
    `,
  },
};

/**
 * Get a built-in theme by name.
 * @param {string} name
 * @returns {Record<string, string>}
 */
export function getTheme(name) {
  if (!(name in BUILTIN_THEMES)) {
    const available = Object.keys(BUILTIN_THEMES).sort().join(", ");
    throw new Error(`Unknown theme '${name}'. Available: ${available}`);
  }
  return BUILTIN_THEMES[name];
}

/**
 * Load a custom theme from a JSON file.
 * Missing keys are filled from tokyo-night defaults.
 * @param {string} filePath
 * @returns {Record<string, string>}
 */
export function loadThemeFile(filePath) {
  const raw = readFileSync(filePath, "utf-8");
  const custom = JSON.parse(raw);
  if (typeof custom !== "object" || custom === null || Array.isArray(custom)) {
    throw new Error(`Theme file must be a JSON object`);
  }
  return { ...BUILTIN_THEMES["tokyo-night"], ...custom };
}

/**
 * Convert a theme dict to a CSS :root block.
 * @param {Record<string, string>} theme
 * @returns {string}
 */
export function themeToCss(theme) {
  const lines = [];
  for (const v of THEME_VARS) {
    if (v in theme) lines.push(`  --${v}: ${theme[v]};`);
  }
  let css = ":root {\n" + lines.join("\n") + "\n}";
  if (theme.extraCss) css += "\n" + theme.extraCss;
  return css;
}

/**
 * Return sorted list of built-in theme names.
 * @returns {string[]}
 */
export function listThemes() {
  return Object.keys(BUILTIN_THEMES).sort();
}
