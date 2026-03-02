/**
 * Render parsed turns into a self-contained HTML replay file.
 */

import { readFileSync } from "node:fs";
import { themeToCss, getTheme } from "./themes.mjs";

const TEMPLATE_PATH = new URL("../template/player.html", import.meta.url);

/**
 * Serialize turns into a JSON string for embedding in HTML.
 */
function turnsToJson(turns) {
  const data = turns.map((turn) => ({
    index: turn.index,
    user_text: turn.user_text,
    blocks: turn.blocks.map((b) => {
      const block = { kind: b.kind, text: b.text };
      if (b.tool_call) {
        block.tool_call = {
          name: b.tool_call.name,
          input: b.tool_call.input,
          result: b.tool_call.result,
        };
      }
      return block;
    }),
    timestamp: turn.timestamp,
  }));
  return JSON.stringify(data);
}

/**
 * Render turns into a self-contained HTML string.
 * @param {import('./parser.mjs').Turn[]} turns
 * @param {{ speed?: number, showThinking?: boolean, showToolCalls?: boolean, showToolResults?: boolean, theme?: Record<string,string>, userLabel?: string, assistantLabel?: string }} opts
 * @returns {string}
 */
export function render(turns, opts = {}) {
  const {
    speed = 1.0,
    showThinking = true,
    showToolCalls = true,
    showToolResults = true,
    theme = getTheme("tokyo-night"),
    userLabel = "User",
    assistantLabel = "Claude",
  } = opts;

  let html = readFileSync(TEMPLATE_PATH, "utf-8");

  html = html.replace("/*THEME_CSS*/", themeToCss(theme));
  html = html.replace("/*TURNS_JSON*/[]", turnsToJson(turns));
  html = html.replace("/*INITIAL_SPEED*/1", String(speed));  // JS default
  html = html.replace(/\/\*INITIAL_SPEED\*\//g, String(speed));  // HTML attrs
  html = html.replace("/*CHECKED_THINKING*/", showThinking ? "checked" : "");
  html = html.replace("/*CHECKED_TOOLS*/", showToolCalls ? "checked" : "");
  html = html.replace("/*CHECKED_RESULTS*/", showToolResults ? "checked" : "");
  html = html.replace("/*USER_LABEL*/", userLabel);
  html = html.replace("/*ASSISTANT_LABEL*/", assistantLabel);

  return html;
}
