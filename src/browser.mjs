/**
 * Browser-compatible entry point for claude-replay.
 * Re-exports parser, renderer, themes, and secrets for use in the website.
 * The player template must be injected at build time via PLAYER_TEMPLATE global.
 */

export { parseTranscriptFromText, detectFormatFromText, applyPacedTiming } from "./parser.mjs";
export { getTheme, listThemes, themeToCss } from "./themes.mjs";
export { redactSecrets, redactObject } from "./secrets.mjs";

import { themeToCss, getTheme } from "./themes.mjs";
import { redactSecrets, redactObject } from "./secrets.mjs";

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJsonForScript(json) {
  return json
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/<\//g, "<\\/")
    .replace(/<!--/g, "<\\!--");
}

function buildRedactor(rules) {
  if (!rules || rules.length === 0) return (t) => t;
  return (text) => {
    if (typeof text !== "string") return text;
    let result = text;
    for (const { search, replacement } of rules) {
      result = result.replaceAll(search, replacement);
    }
    return result;
  };
}

function transformStrings(obj, fn) {
  if (typeof obj === "string") return fn(obj);
  if (Array.isArray(obj)) return obj.map((item) => transformStrings(item, fn));
  if (obj && typeof obj === "object") {
    const result = {};
    for (const [k, v] of Object.entries(obj)) result[k] = transformStrings(v, fn);
    return result;
  }
  return obj;
}

function turnsToJsonData(turns, { redact = true, redactRules } = {}) {
  let processed = JSON.parse(JSON.stringify(turns));
  if (redact) processed = redactObject(processed);
  if (redactRules && redactRules.length > 0) {
    const redactor = buildRedactor(redactRules);
    processed = transformStrings(processed, redactor);
  }
  return processed.map((turn) => ({
    index: turn.index,
    user_text: turn.user_text,
    blocks: (turn.blocks || []).map((b) => {
      const block = { kind: b.kind, text: b.text || "", timestamp: b.timestamp || null };
      if (b.tool_call) {
        block.tool_call = {
          name: b.tool_call.name,
          input: b.tool_call.input,
          result: b.tool_call.result || null,
        };
        if (b.tool_call.is_error) block.tool_call.is_error = true;
        if (b.tool_call.resultTimestamp) block.tool_call.resultTimestamp = b.tool_call.resultTimestamp;
      }
      return block;
    }),
    timestamp: turn.timestamp,
    ...(turn.system_events ? { system_events: turn.system_events } : {}),
  }));
}

/**
 * Render turns into HTML using the player template.
 * Browser-compatible — no filesystem or zlib needed.
 * @param {string} template - The player HTML template string
 * @param {object[]} turns - Parsed turns
 * @param {object} opts - Render options
 * @returns {string} Complete HTML replay
 */
export function renderFromTemplate(template, turns, opts = {}) {
  const {
    speed: rawSpeed = 1.0,
    showThinking = true,
    showToolCalls = true,
    theme = getTheme("tokyo-night"),
    userLabel = "User",
    assistantLabel = "Claude",
    title = "Claude Code Replay",
    description = "Interactive AI session replay",
    ogImage = "https://es617.github.io/claude-replay/og.png",
    redactSecrets: redact = true,
    redactRules,
    bookmarks = [],
  } = opts;

  const speed = Number.isFinite(rawSpeed) ? Math.max(0.1, Math.min(rawSpeed, 10)) : 1.0;

  let html = template;
  html = html.replace("/*THEME_CSS*/", themeToCss(theme));
  html = html.replace("/*THEME_BG*/", escapeHtml(theme.bg || "#1a1b26"));
  html = html.replace("/*INITIAL_SPEED*/1", String(speed));
  html = html.replace(/\/\*INITIAL_SPEED\*\//g, String(speed));
  html = html.replaceAll("/*CHECKED_THINKING*/", showThinking ? "checked" : "");
  html = html.replaceAll("/*CHECKED_TOOLS*/", showToolCalls ? "checked" : "");
  html = html.replaceAll("/*PAGE_TITLE*/", escapeHtml(title));
  html = html.replaceAll("/*PAGE_DESCRIPTION*/", escapeHtml(description));
  html = html.replaceAll("/*OG_IMAGE*/", escapeHtml(ogImage));
  html = html.replace("/*USER_LABEL*/", escapeHtml(userLabel));
  html = html.replace("/*ASSISTANT_LABEL*/", escapeHtml(assistantLabel));
  html = html.replace("/*HAS_REAL_TIMESTAMPS*/false", String(opts.hasRealTimestamps || false));
  const fontSizeMap = { small: "11px", normal: "13px", large: "15px" };
  const fontSize = opts.fontSize || "normal";
  html = html.replace("/*FONT_SIZE*/13px", fontSizeMap[fontSize] || "13px");
  html = html.replace('/*FONT_SIZE_NAME*/"normal"', JSON.stringify(fontSize));

  const embedData = (json) => escapeJsonForScript(json);
  html = html.replace("/*BOOKMARKS_DATA*/", () => embedData(JSON.stringify(bookmarks)));
  html = html.replace("/*TURNS_DATA*/", () => embedData(JSON.stringify(turnsToJsonData(turns, { redact, redactRules }))));

  return html;
}
