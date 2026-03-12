#!/usr/bin/env node

/**
 * Record a demo video of the editor using Playwright + the redacted demo session.
 * Usage: node scripts/record-editor-demo.mjs
 * Output: docs/editor-demo.gif
 */

import { chromium } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Extract turn data from the existing redacted demo HTML
const { extractData } = await import("../src/extract.mjs");
const DEMO_SESSION = extractData(readFileSync(resolve(__dirname, "../docs/demo-redaction.html"), "utf-8"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Convert full turns to the lightweight shape the editor expects. */
function summarizeTurns(turns) {
  return turns.map((t) => {
    const counts = { text: 0, thinking: 0, tool_use: 0 };
    for (const b of t.blocks) counts[b.kind] = (counts[b.kind] || 0) + 1;
    const parts = [];
    if (counts.text) parts.push(`${counts.text} text`);
    if (counts.thinking) parts.push(`${counts.thinking} thinking`);
    if (counts.tool_use) parts.push(`${counts.tool_use} tool call${counts.tool_use > 1 ? "s" : ""}`);
    const blockSummary = parts.join(", ") || "empty";

    return {
      index: t.index,
      user_text: t.user_text,
      blockSummary,
      blocks: t.blocks.map((b) => {
        if (b.kind === "tool_use" && b.tool_call) {
          return {
            kind: b.kind,
            name: b.tool_call.name,
            input: truncate(JSON.stringify(b.tool_call.input), 200),
            result: truncate(b.tool_call.result || "", 500),
          };
        }
        return { kind: b.kind, text: truncate(b.text || "", 1000) };
      }),
      timestamp: t.timestamp,
      system_events: t.system_events || [],
    };
  });
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max) + "\u2026" : s;
}

async function main() {
  // Start editor server
  const { startEditor } = await import("../src/editor-server.mjs");
  const port = 18999;
  startEditor(port, { open: false });

  // Wait for server
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/themes`);
      if (res.ok) break;
    } catch {}
    await sleep(100);
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const summarized = summarizeTurns(DEMO_SESSION.turns);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: resolve(__dirname, "../docs"), size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();

  try {
    // Mock /api/sessions with safe generic project names
    await page.route("**/api/sessions", (route) => {
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          homedir: "/Users/demo",
          groups: [{
            name: "Claude Code",
            projects: [
              {
                name: "my-webapp",
                dirName: "-Users-demo-Projects-my-webapp",
                sessions: [
                  { file: "a1b2c3.jsonl", path: "/fake/a1b2c3.jsonl" },
                  { file: "d4e5f6.jsonl", path: "/fake/d4e5f6.jsonl" },
                ],
              },
              {
                name: "api-server",
                dirName: "-Users-demo-Projects-api-server",
                sessions: [
                  { file: "g7h8i9.jsonl", path: "/fake/g7h8i9.jsonl" },
                ],
              },
              {
                name: "mobile-app",
                dirName: "-Users-demo-Projects-mobile-app",
                sessions: [
                  { file: "j0k1l2.jsonl", path: "/fake/j0k1l2.jsonl" },
                ],
              },
            ],
          }],
        }),
      });
    });

    // Mock /api/load to return the demo session data
    await page.route("**/api/load", (route) => {
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          sessionId: "demo",
          format: "claude",
          hasEdits: false,
          turns: summarized,
        }),
      });
    });

    // Mock /api/edit to return ok
    await page.route("**/api/edit", (route) => {
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, hasEdits: true }),
      });
    });

    // Mock /api/preview to return the existing demo HTML (shows splash screen)
    const demoHtml = readFileSync(resolve(__dirname, "../docs/demo-redaction.html"), "utf-8");
    await page.route("**/api/preview", (route) => {
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ html: demoHtml }),
      });
    });

    // 1. Open editor — shows safe session list
    await page.goto(baseUrl);
    await page.waitForSelector("#sessionsTree", { timeout: 5000 });
    await sleep(1200);

    // 2. Expand project and click a session
    await page.locator(".session-project-name", { hasText: "my-webapp" }).click();
    await sleep(500);
    await page.locator(".session-item", { hasText: "a1b2c3" }).click();
    await page.waitForSelector(".turn-card", { timeout: 5000 });
    await sleep(1200);

    // 3. Set a title
    await page.locator("#titleInput").click();
    await page.locator("#titleInput").fill("");
    await typeSlowly(page, "#titleInput", "Secret Redaction Demo");
    await sleep(600);

    // 4. Expand assistant blocks on turn 2
    await page.locator('[data-action="expand"][data-index="2"]').click();
    await sleep(1200);
    await page.locator('[data-action="expand"][data-index="2"]').click();
    await sleep(400);

    // 5. Exclude turn 3
    await page.locator('input[data-action="toggle"][data-index="3"]').uncheck();
    await sleep(800);
    await page.locator('input[data-action="toggle"][data-index="3"]').check();
    await sleep(400);

    // 6. Add a bookmark
    await page.locator('input[data-action="bookmark"][data-index="1"]').check();
    await sleep(200);
    await page.locator('input[data-action="bookmark-label"][data-index="1"]').fill("");
    await typeSlowly(page, 'input[data-action="bookmark-label"][data-index="1"]', "Implementation");
    await sleep(600);

    // 7. Change theme
    await page.locator("#optTheme").selectOption("dracula");
    await sleep(1200);

    // 8. Click turn to navigate preview
    await page.locator('.turn-card[data-index="2"] .turn-label').click();
    await sleep(1200);


  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  // Find the recorded video and convert to GIF
  const { readdirSync, unlinkSync } = await import("node:fs");
  const docsDir = resolve(__dirname, "../docs");
  const videos = readdirSync(docsDir).filter((f) => f.endsWith(".webm"));
  if (videos.length === 0) {
    console.error("No video recorded!");
    process.exit(1);
  }
  const videoPath = resolve(docsDir, videos[videos.length - 1]);
  const gifPath = resolve(docsDir, "editor-demo.gif");

  console.log(`Video: ${videoPath}`);
  console.log("Converting to GIF...");

  const { execSync } = await import("node:child_process");
  // Trim first 0.5s (white flash from page open) and last 0.5s (white flash from page close)
  const probe = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`).toString().trim();
  const duration = parseFloat(probe) - 1.0;
  execSync(
    `ffmpeg -y -ss 0.5 -i "${videoPath}" -t ${duration} -vf "fps=15,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=sierra2_4a" "${gifPath}"`,
    { stdio: "inherit" },
  );

  unlinkSync(videoPath);
  console.log(`Done: ${gifPath}`);
  process.exit(0);
}

async function typeSlowly(page, selector, text) {
  await page.locator(selector).click();
  for (const char of text) {
    await page.keyboard.type(char, { delay: 50 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
