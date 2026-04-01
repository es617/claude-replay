#!/usr/bin/env node

/**
 * Record a GIF demo of the player using Playwright.
 * Steps through turns manually for a concise, fast demo.
 */

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPLAY_PATH = resolve("docs/demo-session.jsonl");
const OUTPUT_GIF = resolve("docs/demo.gif");
const FRAMES_DIR = resolve("/tmp/demo-frames");
const WIDTH = 800;
const HEIGHT = 500;
const FPS = 8;

// Generate the replay HTML
console.log("Generating replay...");
execSync(`node bin/claude-replay.mjs ${REPLAY_PATH} --title "Express Hello World" --mark "1:Setup" --mark "3:Testing" --no-minify -o /tmp/demo-record.html`);

// Clean frames dir
if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true });
mkdirSync(FRAMES_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
await page.goto("file:///tmp/demo-record.html");
await page.waitForSelector('body[data-ready="1"]', { timeout: 5000 });

let frame = 0;
async function capture(seconds) {
  const count = Math.round(FPS * seconds);
  for (let i = 0; i < count; i++) {
    const path = `${FRAMES_DIR}/frame-${String(frame++).padStart(4, "0")}.png`;
    await page.screenshot({ path });
  }
}

async function step() {
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
}

// Splash (0.8s)
await capture(0.8);

// Press space to start — shows turn 1 header
await page.keyboard.press("Space");
await page.waitForTimeout(400);
await capture(0.8);

// Step through turn 1 blocks one by one
const turn1Blocks = await page.locator('.turn[data-index="1"] .block-wrapper').count();
for (let i = 0; i < turn1Blocks; i++) {
  await step();
  await capture(0.5);
}
// Hold on turn 1 complete
await capture(1);

// Step forward to turn 2 — this reveals next turn
await step();
await capture(0.8);

// Step through turn 2 blocks, expand Edit when it appears
const turn2Blocks = await page.locator('.turn[data-index="2"] .block-wrapper').count();
for (let i = 0; i < turn2Blocks; i++) {
  await step();
  await capture(0.5);

  // After each step, check if an Edit tool header just became visible
  const editHeader = page.locator('.turn[data-index="2"] .tool-header:has-text("Edit")').first();
  if (await editHeader.isVisible().catch(() => false)) {
    await editHeader.click();
    await page.waitForTimeout(300);
    // Scroll down to show the expanded diff content
    const diffView = page.locator('.turn[data-index="2"] .diff-view, .turn[data-index="2"] .tool-result').first();
    if (await diffView.isVisible().catch(() => false)) {
      await diffView.scrollIntoViewIfNeeded();
    } else {
      await page.evaluate(() => window.scrollBy(0, 300));
    }
    await page.waitForTimeout(300);
    await capture(2);
    // Collapse it
    await editHeader.click();
    await page.waitForTimeout(200);
    await capture(0.3);
    break; // Skip remaining blocks, move on
  }
}

// Step through any remaining turn 2 blocks
const remaining2 = await page.locator('.turn[data-index="2"] .block-wrapper.block-hidden').count();
for (let i = 0; i < remaining2; i++) {
  await step();
  await capture(0.5);
}

await capture(0.8);

// Step to turn 3 (testing)
await step();
await capture(0.5);

const turn3Blocks = await page.locator('.turn[data-index="3"] .block-wrapper').count();
for (let i = 0; i < turn3Blocks; i++) {
  await step();
  await capture(0.5);
}
// Hold on test output
await capture(1.2);

// Step to turn 4 (thanks)
await step();
await capture(0.5);
await step();
await capture(1.2);

// Final hold
await capture(0.8);

await browser.close();

console.log(`Captured ${frame} frames`);
console.log("Converting to GIF...");

execSync(
  `ffmpeg -y -framerate ${FPS} -i ${FRAMES_DIR}/frame-%04d.png -vf "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" ${OUTPUT_GIF}`,
  { stdio: "inherit" }
);

rmSync(FRAMES_DIR, { recursive: true });

const size = (execSync(`wc -c < ${OUTPUT_GIF}`).toString().trim() / 1024 / 1024).toFixed(1);
console.log(`Done: ${OUTPUT_GIF} (${size} MB)`);
