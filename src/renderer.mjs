/**
 * Render parsed turns into a self-contained HTML replay file.
 */

import { readFileSync } from "node:fs";
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

/** Escape a JSON string for safe embedding inside a <script> tag. */
function escapeJsonForScript(json) {
  return json.replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");
}

/**
 * Serialize turns into a JSON string for embedding in HTML.
 * @param {import('./parser.mjs').Turn[]} turns
 * @param {{ redact?: boolean }} options
 */
function turnsToJson(turns, { redact = true } = {}) {
  const data = turns.map((turn) => ({
    index: turn.index,
    user_text: redact ? redactSecrets(turn.user_text) : turn.user_text,
    blocks: turn.blocks.map((b) => {
      const block = {
        kind: b.kind,
        text: redact ? redactSecrets(b.text) : b.text,
      };
      if (b.timestamp) block.timestamp = b.timestamp;
      if (b.tool_call) {
        block.tool_call = {
          name: b.tool_call.name,
          input: redact
            ? redactObject(b.tool_call.input)
            : b.tool_call.input,
          result: redact
            ? redactSecrets(b.tool_call.result)
            : b.tool_call.result,
        };
        if (b.tool_call.resultTimestamp) {
          block.tool_call.resultTimestamp = b.tool_call.resultTimestamp;
        }
      }
      return block;
    }),
    timestamp: turn.timestamp,
    ...(turn.system_events ? { system_events: turn.system_events } : {}),
  }));
  return escapeJsonForScript(JSON.stringify(data));
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
    redactSecrets: redact = true,
    bookmarks = [],
    scrollMode: rawScrollMode = "bottom",
  } = opts;

  // Validate inputs
  const speed = Number.isFinite(rawSpeed) ? Math.max(0.1, Math.min(rawSpeed, 10)) : 1.0;
  const scrollMode = rawScrollMode === "top" ? "top" : "bottom";

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
  html = html.replace("/*INITIAL_SPEED*/1", String(speed));  // JS default
  html = html.replace(/\/\*INITIAL_SPEED\*\//g, String(speed));  // HTML attrs
  html = html.replaceAll("/*CHECKED_THINKING*/", showThinking ? "checked" : "");
  html = html.replaceAll("/*CHECKED_TOOLS*/", showToolCalls ? "checked" : "");
  html = html.replaceAll("/*PAGE_TITLE*/", escapeHtml(title));
  html = html.replace("/*USER_LABEL*/", escapeHtml(userLabel));
  html = html.replace("/*ASSISTANT_LABEL*/", escapeHtml(assistantLabel));
  html = html.replace("/*SCROLL_MODE*/", scrollMode);

  // JSON blobs last — they may contain text matching any of the above placeholders.
  // BOOKMARKS before TURNS, because TURNS data may contain the literal placeholder
  // string in user messages (e.g. from pasted plans).
  html = html.replace("/*BOOKMARKS_JSON*/[]", escapeJsonForScript(JSON.stringify(bookmarks)));
  html = html.replace("/*TURNS_JSON*/[]", turnsToJson(turns, { redact }));

  return html;
}
