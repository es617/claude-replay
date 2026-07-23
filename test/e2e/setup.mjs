/**
 * Generate HTML replays from the e2e fixture for Playwright tests.
 */

import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseTranscript, applyPacedTiming } from "../../src/parser.mjs";
import { render } from "../../src/renderer.mjs";
import { DEFAULT_READING_WPM } from "../../src/reading-rate.mjs";

const FIXTURE = new URL("./fixture.jsonl", import.meta.url).pathname;
const PACED_WORDING_FIXTURE = new URL("./fixture-paced-wording.jsonl", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "claude-replay-e2e-"));
const cache = {};

function buildHtml(key, renderOpts) {
  if (!cache[key]) {
    const turns = parseTranscript(FIXTURE);
    const hasRealTimestamps = turns.some((t) => t.timestamp);
    const html = render(turns, {
      title: "E2E Test",
      minified: false,
      redactSecrets: false,
      hasRealTimestamps,
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

export function getUncompressedFileUrl(hash = "") {
  return "file://" + buildHtml("uncompressed", { compress: false }) + (hash ? "#" + hash : "");
}

export function getPacedFileUrl(hash = "") {
  if (!cache["paced"]) {
    const turns = parseTranscript(FIXTURE);
    applyPacedTiming(turns);
    const html = render(turns, {
      title: "E2E Paced Test",
      minified: false,
      redactSecrets: false,
      hasRealTimestamps: false,
    });
    const path = join(dir, "paced.html");
    writeFileSync(path, html);
    cache["paced"] = path;
  }
  return "file://" + cache["paced"] + (hash ? "#" + hash : "");
}

export function getPacedWordingFileUrl(hash = "", readingWpm = DEFAULT_READING_WPM) {
  const key = `paced-wording-${readingWpm}`;
  if (!cache[key]) {
    const turns = parseTranscript(PACED_WORDING_FIXTURE);
    applyPacedTiming(turns);
    const html = render(turns, {
      title: "E2E Paced Wording Test",
      minified: false,
      redactSecrets: false,
      hasRealTimestamps: false,
      pacedWording: true,
      readingWpm,
    });
    const path = join(dir, key + ".html");
    writeFileSync(path, html);
    cache[key] = path;
  }
  return "file://" + cache[key] + (hash ? "#" + hash : "");
}

export function getPacedWordingFinalTurnFileUrl(hash = "") {
  if (!cache["paced-wording-final"]) {
    const turns = parseTranscript(PACED_WORDING_FIXTURE);
    const finalTurn = turns[turns.length - 1];
    finalTurn.index = 1;
    applyPacedTiming([finalTurn]);
    const html = render([finalTurn], {
      title: "E2E Paced Wording Final Turn Test",
      minified: false,
      redactSecrets: false,
      hasRealTimestamps: false,
      pacedWording: true,
      readingWpm: 600,
    });
    const path = join(dir, "paced-wording-final.html");
    writeFileSync(path, html);
    cache["paced-wording-final"] = path;
  }
  return "file://" + cache["paced-wording-final"] + (hash ? "#" + hash : "");
}

export function getChapterFileUrl(hash = "") {
  return "file://" + buildHtml("chapters", {
    bookmarks: [
      { turn: 1, label: "Scan devices" },
      { turn: 2, label: "Connect" },
      { turn: 5, label: "Wrap up" },
    ],
  }) + (hash ? "#" + hash : "");
}

/** Wait for the player to finish initialization. */
export async function waitForReady(page) {
  await page.waitForSelector('body[data-ready="1"]', { timeout: 5000 });
}
