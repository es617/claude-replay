/**
 * Render parsed turns into a self-contained HTML replay file.
 */

import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { themeToCss, getTheme } from "./themes.mjs";
import { redactSecrets, redactObject } from "./secrets.mjs";

const TEMPLATE_PATH = new URL("../template/player.html", import.meta.url);
const TEMPLATE_MIN_PATH = new URL("../template/player.min.html", import.meta.url);

/** Escape text for safe embedding in HTML text nodes and attribute values. */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape a JSON string for safe embedding inside a double-quoted JS string literal in a <script> tag. */
function escapeJsonForScript(json) {
  return json
    .replace(/\\/g, "\\\\")        // backslashes first
    .replace(/"/g, '\\"')           // double quotes (JS string delimiter)
    .replace(/\n/g, "\\n")          // newlines
    .replace(/\r/g, "\\r")          // carriage returns
    .replace(/<\//g, "<\\/")        // </script> breakout
    .replace(/<!--/g, "<\\!--");    // HTML comment breakout
}

/** Compress a JSON string to base64-encoded deflate for embedding. */
function compressForEmbed(json) {
  return deflateSync(Buffer.from(json)).toString("base64");
}

/**
 * Build a text-replacement function from user-supplied --redact rules.
 * @param {Array<{search: string, replacement: string}>} rules
 * @returns {(text: string) => string}
 */
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

/**
 * Recursively apply a text transform to all string values in an object/array.
 * @param {unknown} obj
 * @param {(s: string) => string} fn
 * @returns {unknown}
 */
function transformStrings(obj, fn) {
  if (typeof obj === "string") return fn(obj);
  if (Array.isArray(obj)) return obj.map((v) => transformStrings(v, fn));
  if (obj !== null && typeof obj === "object") {
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
      out[key] = transformStrings(value, fn);
    }
    return out;
  }
  return obj;
}

/**
 * Prepare turns data for serialization.
 * @param {import('./parser.mjs').Turn[]} turns
 * @param {{ redact?: boolean, redactRules?: Array<{search: string, replacement: string}> }} options
 */
function turnsToJsonData(turns, { redact = true, redactRules } = {}) {
  const customRedact = buildRedactor(redactRules);
  const scrubText = (text) => customRedact(redact ? redactSecrets(text) : text);
  const scrubObj = (obj) => transformStrings(redact ? redactObject(obj) : obj, customRedact);

  return turns.map((turn) => ({
    index: turn.index,
    user_text: scrubText(turn.user_text),
    blocks: turn.blocks.map((b) => {
      const block = {
        kind: b.kind,
        text: scrubText(b.text),
      };
      if (b.timestamp) block.timestamp = b.timestamp;
      if (b.tool_call) {
        block.tool_call = {
          name: b.tool_call.name,
          input: scrubObj(b.tool_call.input),
          result: scrubText(b.tool_call.result),
        };
        if (b.tool_call.is_error) {
          block.tool_call.is_error = true;
        }
        if (b.tool_call.resultTimestamp) {
          block.tool_call.resultTimestamp = b.tool_call.resultTimestamp;
        }
      }
      return block;
    }),
    timestamp: turn.timestamp,
    ...(turn.system_events ? { system_events: turn.system_events } : {}),
  }));
}

/**
 * Render turns into a self-contained HTML string.
 * @param {import('./parser.mjs').Turn[]} turns
 * @param {{ speed?: number, showThinking?: boolean, showToolCalls?: boolean, theme?: Record<string,string>, userLabel?: string, assistantLabel?: string, title?: string, redactSecrets?: boolean }} opts
 * @returns {string}
 */
export function render(turns, opts = {}) {
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
    bookmarks = [],
  } = opts;

  // Validate inputs
  const speed = Number.isFinite(rawSpeed) ? Math.max(0.1, Math.min(rawSpeed, 10)) : 1.0;

  let html;
  if (opts.minified === false) {
    html = readFileSync(TEMPLATE_PATH, "utf-8");
  } else {
    try {
      html = readFileSync(TEMPLATE_MIN_PATH, "utf-8");
    } catch {
      html = readFileSync(TEMPLATE_PATH, "utf-8");
    }
  }

  // Replace all template placeholders BEFORE injecting TURNS/BOOKMARKS JSON,
  // because the JSON data can contain arbitrary text (including placeholder strings
  // from session transcripts) which would collide with .replace().
  html = html.replace("/*THEME_CSS*/", themeToCss(theme));
  html = html.replace("/*THEME_BG*/", escapeHtml(theme.bg || "#1a1b26"));
  html = html.replace("/*INITIAL_SPEED*/1", String(speed));  // JS default
  html = html.replace(/\/\*INITIAL_SPEED\*\//g, String(speed));  // HTML attrs
  html = html.replaceAll("/*CHECKED_THINKING*/", showThinking ? "checked" : "");
  html = html.replaceAll("/*CHECKED_TOOLS*/", showToolCalls ? "checked" : "");
  html = html.replaceAll("/*PAGE_TITLE*/", escapeHtml(title));
  html = html.replaceAll("/*PAGE_DESCRIPTION*/", escapeHtml(description));
  html = html.replaceAll("/*OG_IMAGE*/", escapeHtml(ogImage));
  html = html.replace("/*USER_LABEL*/", escapeHtml(userLabel));
  html = html.replace("/*ASSISTANT_LABEL*/", escapeHtml(assistantLabel));

  // Data blobs last — they may contain text matching any of the above placeholders.
  // BOOKMARKS before TURNS, because TURNS data may contain the literal placeholder
  // string in user messages (e.g. from pasted plans).
  const compress = opts.compress !== false;
  const embedData = (json) => compress
    ? compressForEmbed(json)
    : escapeJsonForScript(json);
  // Use function replacements to avoid $-pattern interpretation in replacement strings
  html = html.replace("/*BOOKMARKS_DATA*/", () => embedData(JSON.stringify(bookmarks)));
  html = html.replace("/*TURNS_DATA*/", () => embedData(JSON.stringify(turnsToJsonData(turns, { redact, redactRules: opts.redactRules }))));

  return html;
}
