/**
 * Generate HTML replays from the e2e fixture for Playwright tests.
 */

import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseTranscript } from "../../src/parser.mjs";
import { render } from "../../src/renderer.mjs";

const FIXTURE = new URL("./fixture.jsonl", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "claude-replay-e2e-"));
const cache = {};

function buildHtml(key, renderOpts) {
  if (!cache[key]) {
    const turns = parseTranscript(FIXTURE);
    const html = render(turns, {
      title: "E2E Test",
      minified: false,
      redactSecrets: false,
      ...renderOpts,
    });
    const path = join(dir, key + ".html");
    writeFileSync(path, html);
    cache[key] = path;
  }
  return cache[key];
}

export function getFileUrl(hash = "") {
  return "file://" + buildHtml("default", {}) + (hash ? "#" + hash : "");
}

export function getChapterFileUrl(hash = "") {
  return "file://" + buildHtml("chapters", {
    bookmarks: [
      { turn: 1, label: "Scan devices" },
      { turn: 2, label: "Connect" },
      { turn: 3, label: "Wrap up" },
    ],
  }) + (hash ? "#" + hash : "");
}

/** Wait for the player to finish initialization. */
export async function waitForReady(page) {
  await page.waitForSelector('body[data-ready="1"]', { timeout: 5000 });
}
