import { test, expect } from "@playwright/test";
import { getFileUrl, getChapterFileUrl, waitForReady } from "./setup.mjs";

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
  // All blocks in turn 1 should be revealed (deep link)
  const total = await blockCount(page, 1);
  expect(await visibleBlockCount(page, 1)).toBe(total);

  // Step forward should advance to turn 2
  await pressKey(page, "ArrowRight");
  await expect(page.locator('.turn[data-index="2"]')).toBeVisible();
  // Turn 2 blocks should all be hidden (thinking + tool-group + text = 3 wrappers)
  expect(await blockCount(page, 2, true)).toBe(3);
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
  // Turn 1: 0%, Turn 2: 50%, Turn 3: 100%
  await goto(page, "turn=1");
  expect(await getFillWidth()).toBe(0);

  await page.goto("about:blank");
  await goto(page, "turn=2");
  expect(await getFillWidth()).toBe(50);

  await page.goto("about:blank");
  await goto(page, "turn=3");
  expect(await getFillWidth()).toBe(100);
});

test("clicking progress bar seeks to position", async ({ page }) => {
  await goto(page, "turn=1");

  // Click near the end of the progress bar (should seek to turn 3)
  const bar = page.locator("#progress-bar");
  const box = await bar.boundingBox();
  await bar.click({ position: { x: box.width - 5, y: box.height / 2 } });

  // Should be at or near the last turn
  await expect(page.locator('.turn[data-index="3"]')).toBeVisible();
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

  // Should be at turn 3 and paused (play button shows ▶ not ❚❚)
  await expect(page.locator('.turn[data-index="3"]')).toBeVisible();
  const btnText = await page.locator("#btn-play").textContent();
  expect(btnText).toBe("▶");
});
