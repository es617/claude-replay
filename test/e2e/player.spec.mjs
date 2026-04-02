import { test, expect } from "@playwright/test";
import { getFileUrl, getUncompressedFileUrl, getChapterFileUrl, getPacedFileUrl, waitForReady } from "./setup.mjs";

// Helpers
const blockCount = (page, turn, hidden = false) =>
  page.locator(`.turn[data-index="${turn}"] .block-wrapper${hidden ? ".block-hidden" : ""}`).count();

const visibleBlockCount = (page, turn) =>
  page.locator(`.turn[data-index="${turn}"] .block-wrapper:not(.block-hidden)`).count();

const isSplashVisible = (page) =>
  page.locator("#splash").evaluate((el) => !el.classList.contains("hidden"));

const pressKey = (page, key) => page.keyboard.press(key);

async function goto(page, hash) {
  await page.goto(getFileUrl(hash));
  await waitForReady(page);
}

async function gotoChapters(page, hash) {
  await page.goto(getChapterFileUrl(hash));
  await waitForReady(page);
}

// ─── Splash screen ──────────────────────────────────────────

test("loads with splash screen visible", async ({ page }) => {
  await goto(page);
  expect(await isSplashVisible(page)).toBe(true);
  await expect(page.locator("#splash-play")).toBeVisible();
});

test("#turn=0 shows splash screen", async ({ page }) => {
  await goto(page, "turn=0");
  expect(await isSplashVisible(page)).toBe(true);
});

test("#turn=2 skips splash and shows turn 2", async ({ page }) => {
  await goto(page, "turn=2");
  expect(await isSplashVisible(page)).toBe(false);
  await expect(page.locator('.turn[data-index="2"]')).toBeVisible();
});

// ─── Play / Pause ───────────────────────────────────────────

test("clicking play hides splash and starts revealing blocks", async ({ page }) => {
  await goto(page);
  await page.locator("#splash-play").click();
  expect(await isSplashVisible(page)).toBe(false);
  // Wait for at least one block to be revealed in turn 1
  await expect(page.locator('.turn[data-index="1"] .block-wrapper:not(.block-hidden)').first()).toBeVisible({ timeout: 5000 });
});

// ─── Step forward ───────────────────────────────────────────

test("step forward reveals blocks one by one", async ({ page }) => {
  await goto(page);
  // Step from splash to turn 1 (shows turn header, all blocks hidden)
  await pressKey(page, "ArrowRight");
  expect(await isSplashVisible(page)).toBe(false);
  const total = await blockCount(page, 1);
  expect(total).toBe(6); // thinking, text, tool, text, tool, text

  // All blocks should be hidden initially
  expect(await blockCount(page, 1, true)).toBe(6);

  // Step through blocks one by one
  await pressKey(page, "ArrowRight"); // reveal block 1
  expect(await visibleBlockCount(page, 1)).toBe(1);

  await pressKey(page, "ArrowRight"); // reveal block 2
  expect(await visibleBlockCount(page, 1)).toBe(2);

  await pressKey(page, "ArrowRight"); // reveal block 3
  expect(await visibleBlockCount(page, 1)).toBe(3);
});

test("step forward advances to next turn after all blocks revealed", async ({ page }) => {
  await goto(page, "turn=1");
  // Deep link hides active turn blocks — step forward reveals first block
  expect(await visibleBlockCount(page, 1)).toBe(0);

  // Step forward should reveal first block in turn 1
  await pressKey(page, "ArrowRight");
  expect(await visibleBlockCount(page, 1)).toBe(1);
});

// ─── Step back ──────────────────────────────────────────────

test("step back hides blocks one by one", async ({ page }) => {
  await goto(page);
  // Step forward to reveal 3 blocks in turn 1
  await pressKey(page, "ArrowRight"); // splash → turn 1
  await pressKey(page, "ArrowRight"); // block 1
  await pressKey(page, "ArrowRight"); // block 2
  await pressKey(page, "ArrowRight"); // block 3
  expect(await visibleBlockCount(page, 1)).toBe(3);

  // Step back should hide block 3
  await pressKey(page, "ArrowLeft");
  expect(await visibleBlockCount(page, 1)).toBe(2);

  await pressKey(page, "ArrowLeft");
  expect(await visibleBlockCount(page, 1)).toBe(1);
});

test("step back to turn 0 shows splash", async ({ page }) => {
  await goto(page);
  await pressKey(page, "ArrowRight"); // splash → turn 1
  // No blocks revealed yet, step back → splash
  await pressKey(page, "ArrowLeft");
  expect(await isSplashVisible(page)).toBe(true);
});

// ─── Expand / collapse ─────────────────────────────────────

test("expanding a block does not reveal remaining blocks", async ({ page }) => {
  await goto(page);
  // Step to turn 1, reveal first 2 blocks (thinking + text)
  await pressKey(page, "ArrowRight"); // splash → turn 1
  await pressKey(page, "ArrowRight"); // reveal thinking
  await pressKey(page, "ArrowRight"); // reveal text
  expect(await visibleBlockCount(page, 1)).toBe(2);

  // Expand the thinking block
  await page.locator('.turn[data-index="1"] .thinking-header').click();
  await expect(page.locator('.turn[data-index="1"] .thinking-block.open')).toBeVisible();

  // Should still have only 2 revealed blocks
  expect(await visibleBlockCount(page, 1)).toBe(2);

  // Step forward should reveal block 3, not skip to next turn
  await pressKey(page, "ArrowRight");
  expect(await visibleBlockCount(page, 1)).toBe(3);
});

test("expanding tool block does not reveal remaining blocks", async ({ page }) => {
  await goto(page);
  // Step to reveal 3 blocks in turn 1 (thinking, text, tool)
  await pressKey(page, "ArrowRight"); // splash → turn 1
  await pressKey(page, "ArrowRight"); // thinking
  await pressKey(page, "ArrowRight"); // text
  await pressKey(page, "ArrowRight"); // tool (ble_scan_start)
  expect(await visibleBlockCount(page, 1)).toBe(3);

  // Expand the tool block
  await page.locator('.turn[data-index="1"] .tool-header').first().click();

  // Still only 3 blocks revealed
  expect(await visibleBlockCount(page, 1)).toBe(3);

  // Next step reveals block 4
  await pressKey(page, "ArrowRight");
  expect(await visibleBlockCount(page, 1)).toBe(4);
});

test("stepping back past expanded block collapses it", async ({ page }) => {
  await goto(page);
  // Reveal first 2 blocks
  await pressKey(page, "ArrowRight"); // splash → turn 1
  await pressKey(page, "ArrowRight"); // thinking
  await pressKey(page, "ArrowRight"); // text
  expect(await visibleBlockCount(page, 1)).toBe(2);

  // Expand thinking block
  await page.locator('.turn[data-index="1"] .thinking-header').click();
  await expect(page.locator('.turn[data-index="1"] .thinking-block.open')).toBeVisible();

  // Step back past thinking block (hide text, then hide thinking)
  await pressKey(page, "ArrowLeft"); // hide text
  await pressKey(page, "ArrowLeft"); // hide thinking
  expect(await visibleBlockCount(page, 1)).toBe(0);

  // Re-reveal thinking — it should be collapsed
  await pressKey(page, "ArrowRight");
  const isOpen = await page.locator('.turn[data-index="1"] .thinking-block').evaluate(
    (el) => el.classList.contains("open")
  );
  expect(isOpen).toBe(false);
});

// ─── Keyboard shortcuts ─────────────────────────────────────

test("Space toggles play/pause", async ({ page }) => {
  await goto(page);
  await pressKey(page, " ");
  expect(await isSplashVisible(page)).toBe(false);
  // Wait for playback to reveal something
  await page.waitForTimeout(500);
  // Pause
  await pressKey(page, " ");
  // Verify we can still step (meaning we're paused)
  const before = await visibleBlockCount(page, 1);
  await pressKey(page, "ArrowRight");
  const after = await visibleBlockCount(page, 1);
  expect(after).toBeGreaterThanOrEqual(before);
});

test("K toggles play/pause", async ({ page }) => {
  await goto(page);
  await pressKey(page, "k");
  expect(await isSplashVisible(page)).toBe(false);
});

test("H and L step back and forward", async ({ page }) => {
  await goto(page);
  await pressKey(page, "l"); // step forward (splash → turn 1)
  expect(await isSplashVisible(page)).toBe(false);
  await pressKey(page, "l"); // reveal block 1
  expect(await visibleBlockCount(page, 1)).toBe(1);
  await pressKey(page, "h"); // hide block 1
  expect(await visibleBlockCount(page, 1)).toBe(0);
});

// ─── Navbar buttons ─────────────────────────────────────────

test("play button starts and pauses playback", async ({ page }) => {
  await goto(page);
  // Dismiss splash first
  await pressKey(page, "ArrowRight");
  expect(await isSplashVisible(page)).toBe(false);

  // Click play button
  await page.locator("#btn-play").click();
  await page.waitForTimeout(500);
  const revealed = await visibleBlockCount(page, 1);
  expect(revealed).toBeGreaterThan(0);

  // Click pause
  await page.locator("#btn-play").click();
  const afterPause = await visibleBlockCount(page, 1);
  // Step to verify we're paused
  await page.waitForTimeout(300);
  expect(await visibleBlockCount(page, 1)).toBe(afterPause);
});

test("next button steps forward", async ({ page }) => {
  await goto(page);
  await pressKey(page, "ArrowRight"); // splash → turn 1
  await page.locator("#btn-next").click();
  expect(await visibleBlockCount(page, 1)).toBe(1);
  await page.locator("#btn-next").click();
  expect(await visibleBlockCount(page, 1)).toBe(2);
});

test("prev button steps back", async ({ page }) => {
  await goto(page);
  await pressKey(page, "ArrowRight"); // splash → turn 1
  await pressKey(page, "ArrowRight"); // reveal block 1
  await pressKey(page, "ArrowRight"); // reveal block 2
  expect(await visibleBlockCount(page, 1)).toBe(2);

  await page.locator("#btn-prev").click();
  expect(await visibleBlockCount(page, 1)).toBe(1);
});

// ─── Progress bar ───────────────────────────────────────────

test("progress bar fill advances with turns", async ({ page }) => {
  const getFillWidth = () => page.locator("#progress-fill").evaluate(
    (el) => parseFloat(el.style.width) || 0
  );

  // Each goto must be a full page load (not just hash change),
  // so navigate to about:blank between them.
  // Turn 1: 0%, Turn 2: 25%, Turn 5: 100%
  await goto(page, "turn=1");
  expect(await getFillWidth()).toBe(0);

  await page.goto("about:blank");
  await goto(page, "turn=2");
  expect(await getFillWidth()).toBe(25);

  await page.goto("about:blank");
  await goto(page, "turn=5");
  expect(await getFillWidth()).toBe(100);
});

test("clicking progress bar seeks to position", async ({ page }) => {
  await goto(page, "turn=1");

  // Click near the end of the progress bar (should seek to last turn)
  const bar = page.locator("#progress-bar");
  const box = await bar.boundingBox();
  await bar.click({ position: { x: box.width - 5, y: box.height / 2 } });

  // Should be at or near the last turn
  await expect(page.locator('.turn[data-index="5"]')).toBeVisible();
});

test("progress text shows timer", async ({ page }) => {
  await goto(page);
  const text = await page.locator("#progress-text").textContent();
  // Should show "0:00 / X:XX" format
  expect(text).toMatch(/\d+:\d{2}\s*\/\s*\d+:\d{2}/);
});

// ─── Speed control ──────────────────────────────────────────

test("speed popover changes speed", async ({ page }) => {
  await goto(page);
  const getSpeed = () => page.locator("#speed-btn").textContent();

  // Default speed should be 1x
  expect(await getSpeed()).toContain("1x");

  // Open speed popover and select 2x
  await page.locator("#speed-btn").click();
  await expect(page.locator("#speed-popover")).toBeVisible();
  await page.locator('#speed-popover button[data-speed="2"]').click();
  expect(await getSpeed()).toBe("2x");
});

// ─── Chapters ───────────────────────────────────────────────

test("chapter dropdown is visible when bookmarks configured", async ({ page }) => {
  await gotoChapters(page);
  await expect(page.locator("#chapter-wrap")).toBeVisible();
  await expect(page.locator("#chapter-btn")).toBeVisible();
});

test("chapter dropdown is hidden when no bookmarks", async ({ page }) => {
  await goto(page);
  await expect(page.locator("#chapter-wrap")).toBeHidden();
});

test("clicking chapter navigates to turn", async ({ page }) => {
  await gotoChapters(page, "turn=1");

  // Open chapter dropdown
  await page.locator("#chapter-btn").click();
  await expect(page.locator("#chapter-menu")).toBeVisible();

  // Click "Connect" chapter (turn 2)
  await page.locator("#chapter-menu .chapter-item", { hasText: "Connect" }).click();

  // Should navigate to turn 2
  await expect(page.locator('.turn[data-index="2"]')).toBeVisible();
});

test("chapter click stops playback", async ({ page }) => {
  await gotoChapters(page);
  // Start playback
  await pressKey(page, " ");
  await page.waitForTimeout(300);

  // Open chapters and click one
  await page.locator("#chapter-btn").click();
  await page.locator("#chapter-menu .chapter-item", { hasText: "Wrap up" }).click();

  // Should be at turn 5 and paused (play button shows ▶ not ❚❚)
  await expect(page.locator('.turn[data-index="5"]')).toBeVisible();
  const btnText = await page.locator("#btn-play").textContent();
  expect(btnText).toBe("▶");
});

// ─── Diff view for Edit/Write ──────────────────────────────

test("Edit tool renders diff view with red/green lines", async ({ page }) => {
  await goto(page, "turn=4"); // go past turn 3 so its blocks are revealed
  // Expand the Edit tool block
  const editTool = page.locator('.turn[data-index="3"] .tool-block', { hasText: "Edit" }).first();
  await editTool.locator(".tool-header").click();
  await expect(editTool.locator(".tool-body")).toBeVisible();

  // Should have diff-view with diff lines
  await expect(editTool.locator(".diff-view")).toBeVisible();
  await expect(editTool.locator(".diff-file")).toContainText("/src/app.ts");

  // Should have red (deleted) and green (added) lines
  const delLines = editTool.locator(".diff-line-del");
  const addLines = editTool.locator(".diff-line-add");
  expect(await delLines.count()).toBeGreaterThan(0);
  expect(await addLines.count()).toBeGreaterThan(0);

  // Should show result
  await expect(editTool.locator(".diff-result")).toContainText("Updated /src/app.ts");
});

test("Write tool renders code block", async ({ page }) => {
  await goto(page, "turn=4"); // go past turn 3 so its blocks are revealed
  // Expand the Write tool block
  const writeTool = page.locator('.turn[data-index="3"] .tool-block', { hasText: "Write" }).first();
  await writeTool.locator(".tool-header").click();
  await expect(writeTool.locator(".tool-body")).toBeVisible();

  // Should have diff-view with file path and code content
  await expect(writeTool.locator(".diff-view")).toBeVisible();
  await expect(writeTool.locator(".diff-file")).toContainText("/src/config.json");
  await expect(writeTool.locator("pre code")).toBeVisible();
  await expect(writeTool.locator("pre code")).toContainText("version");

  // Should show result
  await expect(writeTool.locator(".diff-result")).toContainText("Created /src/config.json");
});

test("Edit/Write tool headers show file path as preview", async ({ page }) => {
  await goto(page, "turn=4"); // go past turn 3 so its blocks are revealed
  const editPreview = page.locator('.turn[data-index="3"] .tool-block', { hasText: "Edit" }).first().locator(".tool-args-preview");
  const writePreview = page.locator('.turn[data-index="3"] .tool-block', { hasText: "Write" }).first().locator(".tool-args-preview");

  await expect(editPreview).toContainText("/src/app.ts");
  await expect(writePreview).toContainText("/src/config.json");
});

test("other tools still render generic input/result", async ({ page }) => {
  await goto(page, "turn=2"); // go past turn 1 so its blocks are revealed
  // Expand the first tool block (ble_scan_start)
  const tool = page.locator('.turn[data-index="1"] .tool-block').first();
  await tool.locator(".tool-header").click();
  await expect(tool.locator(".tool-body")).toBeVisible();

  // Should have generic input/result, NOT diff-view
  await expect(tool.locator(".tool-input")).toBeVisible();
  await expect(tool.locator(".diff-view")).toHaveCount(0);
});

// ─── Error state ───────────────────────────────────────────

test("failed tool shows red indicator dot", async ({ page }) => {
  await goto(page, "turn=5"); // go past turn 4 so its blocks are revealed
  const editTool = page.locator('.turn[data-index="4"] .tool-block', { hasText: "Edit" }).first();

  // Indicator should have error class
  await expect(editTool.locator(".tool-indicator.tool-error")).toBeVisible();
});

test("failed Edit tool strips tool_use_error tags and shows red result", async ({ page }) => {
  await goto(page, "turn=5"); // go past turn 4 so its blocks are revealed
  const editTool = page.locator('.turn[data-index="4"] .tool-block', { hasText: "Edit" }).first();
  await editTool.locator(".tool-header").click();
  await expect(editTool.locator(".tool-body")).toBeVisible();

  // Result should not contain XML tags
  const result = editTool.locator(".diff-result");
  await expect(result).toBeVisible();
  await expect(result).toContainText("File has been modified");
  const text = await result.textContent();
  expect(text).not.toContain("<tool_use_error>");

  // Result should have error class
  await expect(result).toHaveClass(/diff-result-error/);
});

test("successful tool does not show red indicator", async ({ page }) => {
  await goto(page, "turn=4"); // go past turn 3 so its blocks are revealed
  const editTool = page.locator('.turn[data-index="3"] .tool-block', { hasText: "Edit" }).first();

  // Indicator should NOT have error class
  await expect(editTool.locator(".tool-indicator")).toBeVisible();
  await expect(editTool.locator(".tool-indicator.tool-error")).toHaveCount(0);
});

// ─── Uncompressed mode (--no-compress) ──────────────────────

test("uncompressed: player loads and initializes", async ({ page }) => {
  await page.goto(getUncompressedFileUrl());
  await waitForReady(page);
  expect(await isSplashVisible(page)).toBe(true);
});

test("uncompressed: stepping reveals blocks", async ({ page }) => {
  await page.goto(getUncompressedFileUrl());
  await waitForReady(page);
  await pressKey(page, "ArrowRight"); // splash → turn 1
  expect(await isSplashVisible(page)).toBe(false);
  await pressKey(page, "ArrowRight"); // reveal block 1
  expect(await visibleBlockCount(page, 1)).toBe(1);
});

test("play from last turn does not reset to beginning", async ({ page }) => {
  await goto(page, "turn=5");
  // All blocks should be hidden (navigated with hideActiveBlocks)
  const hidden = await blockCount(page, 5, true);
  expect(hidden).toBeGreaterThan(0);

  // Press play
  await pressKey(page, " ");
  // Wait for first block to start revealing
  await page.waitForFunction(
    () => document.querySelectorAll('.turn[data-index="5"] .block-wrapper:not(.block-hidden)').length > 0,
    { timeout: 5000 },
  );

  // Should still be on turn 5, not reset to turn 1
  await expect(page.locator('.turn[data-index="5"]')).toBeVisible();
  // Turn 1 should still be visible (not reset/hidden)
  await expect(page.locator('.turn[data-index="1"]')).toBeVisible();
});

// ─── Responsive layout ────────────────────────────────────

test("desktop: title, speed, filter visible; more hidden", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await goto(page);
  await pressKey(page, " "); // start to show controls
  await expect(page.locator(".bar-title")).toBeVisible();
  await expect(page.locator("#speed-btn")).toBeVisible();
  await expect(page.locator("#filter-btn")).toBeVisible();
  // more-wrap is display:none on desktop
  await expect(page.locator(".more-wrap")).toBeHidden();
});

test("narrow: title hidden, more button visible, speed/filter hidden", async ({ page }) => {
  await page.setViewportSize({ width: 450, height: 600 });
  await goto(page);
  await pressKey(page, " ");
  await expect(page.locator(".bar-title")).toBeHidden();
  await expect(page.locator(".more-wrap")).toBeVisible();
  await expect(page.locator(".controls-secondary")).toBeHidden();
});

test("turn skip buttons visible at all sizes", async ({ page }) => {
  for (const width of [800, 450, 320]) {
    await page.setViewportSize({ width, height: 600 });
    await goto(page);
    await pressKey(page, " ");
    await expect(page.locator("#btn-prev-turn")).toBeVisible();
    await expect(page.locator("#btn-next-turn")).toBeVisible();
  }
});

test("chapter button visible with bookmarks, hidden without", async ({ page }) => {
  // With bookmarks
  await page.goto(getChapterFileUrl());
  await waitForReady(page);
  await pressKey(page, " ");
  await expect(page.locator("#chapter-btn")).toBeVisible();

  // Without bookmarks
  await goto(page);
  await pressKey(page, " ");
  await expect(page.locator("#chapter-wrap")).toBeHidden();
});

// ─── Turn skip buttons ────────────────────────────────────

test("next turn button skips to next turn", async ({ page }) => {
  await goto(page, "turn=1");
  await page.locator("#btn-next-turn").click();
  await expect(page.locator('.turn[data-index="2"]')).toBeVisible();
  await expect(page.locator('.turn[data-index="2"]')).toHaveClass(/active/);
});

test("prev turn button skips to previous turn", async ({ page }) => {
  await goto(page, "turn=3");
  await page.locator("#btn-prev-turn").click();
  await expect(page.locator('.turn[data-index="2"]')).toHaveClass(/active/);
});

// ─── File sidebar ─────────────────────────────────────────

test("file sidebar toggle visible when session has tool calls", async ({ page }) => {
  await goto(page);
  await pressKey(page, " ");
  await expect(page.locator("#fileSidebarToggle")).toBeVisible();
});

test("file sidebar opens and shows files", async ({ page }) => {
  await goto(page);
  await pressKey(page, " ");
  await page.locator("#fileSidebarToggle").click();
  await expect(page.locator("#fileSidebar")).toHaveClass(/open/);
  const files = page.locator(".file-entry");
  expect(await files.count()).toBeGreaterThan(0);
});

test("file sidebar closes with X button", async ({ page }) => {
  await goto(page);
  await pressKey(page, " ");
  await page.locator("#fileSidebarToggle").click();
  await expect(page.locator("#fileSidebar")).toHaveClass(/open/);
  await page.locator("#fileSidebarClose").click();
  await expect(page.locator("#fileSidebar")).not.toHaveClass(/open/);
});

test("clicking file entry expands to show turn references", async ({ page }) => {
  await goto(page);
  await pressKey(page, " ");
  await page.locator("#fileSidebarToggle").click();
  const firstFile = page.locator(".file-entry").first();
  await firstFile.locator(".file-entry-header").click();
  await expect(firstFile).toHaveClass(/expanded/);
  const refs = firstFile.locator(".file-entry-ref");
  expect(await refs.count()).toBeGreaterThan(0);
});

test("clicking file reference navigates to turn", async ({ page }) => {
  await goto(page, "turn=1");
  await page.locator("#fileSidebarToggle").click();
  const firstFile = page.locator(".file-entry").first();
  await firstFile.locator(".file-entry-header").click();
  const ref = firstFile.locator(".file-entry-ref").first();
  const turnIdx = await ref.getAttribute("data-turn");
  await ref.click();
  await expect(page.locator(`.turn[data-index="${turnIdx}"]`)).toHaveClass(/active/);
});

// ─── Diff rendering ───────────────────────────────────────

test("edit diff shows context, added, and removed lines", async ({ page }) => {
  await goto(page);
  // Navigate to a turn with Edit tool calls and expand it
  await pressKey(page, " "); // start
  // Step through to find an edit block
  for (let i = 0; i < 15; i++) await pressKey(page, "ArrowRight");
  // Check for diff line types
  const diffView = page.locator(".diff-view").first();
  if (await diffView.isVisible().catch(() => false)) {
    // Should have at least add or del lines
    const addLines = await page.locator(".diff-line-add").count();
    const delLines = await page.locator(".diff-line-del").count();
    expect(addLines + delLines).toBeGreaterThan(0);
  }
});

// ─── Font size ────────────────────────────────────────────

test("font size button cycles through S, M, L", async ({ page }) => {
  await goto(page);
  await pressKey(page, " ");
  await page.locator("#filter-btn").click();
  const btn = page.locator("#font-size-cycle");
  await expect(btn).toHaveText("M");
  await btn.click();
  await expect(btn).toHaveText("L");
  await btn.click();
  await expect(btn).toHaveText("S");
  await btn.click();
  await expect(btn).toHaveText("M");
});

// ─── Auto-paced toggle ────────────────────────────────────

test("auto-paced toggle visible in speed popover with real timestamps", async ({ page }) => {
  await goto(page);
  await pressKey(page, " ");
  // Open speed popover
  await page.locator("#speed-btn").click();
  await expect(page.locator("#paced-toggle-wrap")).toBeVisible();
});

test("auto-paced toggle hidden when built with paced timing", async ({ page }) => {
  await page.goto(getPacedFileUrl());
  await waitForReady(page);
  await pressKey(page, " ");
  await page.locator("#speed-btn").click();
  // The paced toggle should not exist in the speed popover
  const toggle = page.locator("#paced-toggle-wrap");
  await expect(toggle).toHaveCount(0);
});

test("toggling auto-paced changes timer display", async ({ page }) => {
  await goto(page, "turn=3");
  // Get real time display
  const realTime = await page.locator("#progress-text").textContent();
  // Open speed popover and toggle paced
  await page.locator("#speed-btn").click();
  await page.locator("#toggle-paced").check();
  // Time should change
  const pacedTime = await page.locator("#progress-text").textContent();
  expect(pacedTime).not.toBe(realTime);
});

// ─── Hash reveal mode (#turn=Nr) ──────────────────────────

test("deep link with r suffix reveals blocks", async ({ page }) => {
  await goto(page, "turn=3r");
  // Turn 3 should be visible
  await expect(page.locator('.turn[data-index="3"]')).toBeVisible();
  // Blocks should be revealed (not hidden)
  const visible = await visibleBlockCount(page, 3);
  expect(visible).toBeGreaterThan(0);
  const hidden = await blockCount(page, 3, true);
  expect(hidden).toBe(0);
});

test("deep link without r suffix hides active blocks", async ({ page }) => {
  await goto(page, "turn=3");
  await expect(page.locator('.turn[data-index="3"]')).toBeVisible();
  // Active turn blocks should be hidden
  const hidden = await blockCount(page, 3, true);
  expect(hidden).toBeGreaterThan(0);
});

test("deep link with r suffix does not trigger scroll animation", async ({ page }) => {
  await goto(page, "turn=5r");
  // Should be at the last turn with blocks visible, no splash
  await expect(page.locator("#splash")).toHaveClass(/hidden/);
  await expect(page.locator('.turn[data-index="5"]')).toBeVisible();
  const visible = await visibleBlockCount(page, 5);
  expect(visible).toBeGreaterThan(0);
});

// ─── Uncompressed ─────────────────────────────────────────

test("uncompressed: deep link to turn works", async ({ page }) => {
  await page.goto(getUncompressedFileUrl("turn=2"));
  await waitForReady(page);
  expect(await isSplashVisible(page)).toBe(false);
  await expect(page.locator('.turn[data-index="2"]')).toBeVisible();
});
