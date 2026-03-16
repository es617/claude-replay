import { test, expect } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, "fixture.jsonl");

// Start the editor server once for all tests in this file
let baseUrl;

test.beforeAll(async () => {
  // Dynamic import to start the server
  const { startEditor } = await import("../../src/editor-server.mjs");
  // Use a random high port to avoid conflicts
  const port = 17331 + Math.floor(Math.random() * 1000);
  baseUrl = `http://127.0.0.1:${port}`;

  // startEditor never resolves (keeps server running), so we don't await
  startEditor(port, { open: false });

  // Wait for server to be ready
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/themes`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Editor server did not start");
});

/** Navigate to editor and wait for it to load */
async function gotoEditor(page) {
  await page.goto(baseUrl);
  await page.waitForSelector("#sessionsTree", { timeout: 5000 });
}

/** Load the test fixture via the browse path input */
async function loadFixture(page) {
  // Open browse section
  await page.locator("#browseToggle").click();
  await page.waitForSelector("#browseBody:not([style*='display: none'])", { timeout: 2000 });

  // Type fixture path and press Enter
  await page.locator("#browsePathInput").fill(dirname(FIXTURE_PATH));
  await page.locator("#browsePathInput").press("Enter");

  // Wait for file list and click the fixture
  await page.waitForSelector(`.browse-item[data-path="${FIXTURE_PATH}"]`, { timeout: 5000 });
  await page.locator(`.browse-item[data-path="${FIXTURE_PATH}"]`).click();

  // Wait for turns to load
  await page.waitForSelector(".turn-card", { timeout: 5000 });
}

// ─── Loading ───────────────────────────────────────────────

test("editor page loads with sessions panel", async ({ page }) => {
  await gotoEditor(page);
  await expect(page.locator("#sessionsSection")).toBeVisible();
  await expect(page.locator("#sessionsSearch")).toBeVisible();
  await expect(page.locator("#titleInput")).toBeVisible();
  await expect(page.locator("#exportBtn")).toBeVisible();
});

test("loading a session shows turns in editor", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);

  // Should have 5 turns
  const cards = page.locator(".turn-card");
  await expect(cards).toHaveCount(5);

  // Turn 1 should show user text
  const firstTextarea = page.locator('textarea[data-action="edit"][data-index="1"]');
  await expect(firstTextarea).toContainText("Scan for BLE devices");
});

test("turns toolbar appears after loading session", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);
  await expect(page.locator("#turnsToolbar")).toBeVisible();
  await expect(page.locator("#selectAllBtn")).toBeVisible();
  await expect(page.locator("#selectNoneBtn")).toBeVisible();
});

// ─── Preview ───────────────────────────────────────────────

test("preview iframe loads after session load", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);

  // Wait for iframe to have a blob URL src
  await page.waitForFunction(
    () => document.getElementById("previewIframe")?.src?.startsWith("blob:"),
    { timeout: 10000 },
  );
});

// ─── Turn editing ──────────────────────────────────────────

test("editing user text updates turn", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);

  const textarea = page.locator('textarea[data-action="edit"][data-index="1"]');
  await textarea.fill("Modified prompt text");
  await expect(textarea).toHaveValue("Modified prompt text");
});

test("excluding a turn adds excluded class", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);

  const checkbox = page.locator('input[data-action="toggle"][data-index="2"]');
  const card = page.locator('.turn-card[data-index="2"]');

  // Uncheck to exclude
  await checkbox.uncheck();
  await expect(card).toHaveClass(/excluded/);

  // Re-check to include
  await checkbox.check();
  await expect(card).not.toHaveClass(/excluded/);
});

test("exclude all / include all buttons work", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);

  // Exclude all
  await page.locator("#selectNoneBtn").click();
  const excludedCount = await page.locator(".turn-card.excluded").count();
  expect(excludedCount).toBe(5);

  // Include all
  await page.locator("#selectAllBtn").click();
  const includedCount = await page.locator(".turn-card:not(.excluded)").count();
  expect(includedCount).toBe(5);
});

// ─── Block expansion ───────────────────────────────────────

test("clicking block summary expands detail view", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);

  const summary = page.locator('[data-action="expand"][data-index="1"]');
  const detail = page.locator("#blocks-1");

  // Initially closed
  await expect(detail).not.toHaveClass(/open/);

  // Click to expand
  await summary.click();
  await expect(detail).toHaveClass(/open/);
  await expect(summary).toHaveClass(/open/);

  // Click to collapse
  await summary.click();
  await expect(detail).not.toHaveClass(/open/);
});

// ─── Bookmarks ─────────────────────────────────────────────

test("adding a bookmark enables label input", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);

  const bmCheckbox = page.locator('input[data-action="bookmark"][data-index="1"]');
  const bmLabel = page.locator('input[data-action="bookmark-label"][data-index="1"]');

  // Initially disabled
  await expect(bmLabel).toBeDisabled();

  // Check bookmark
  await bmCheckbox.check();
  await expect(bmLabel).toBeEnabled();

  // Uncheck
  await bmCheckbox.uncheck();
  await expect(bmLabel).toBeDisabled();
});

// ─── Options ───────────────────────────────────────────────

test("theme select has options", async ({ page }) => {
  await gotoEditor(page);
  const options = page.locator("#optTheme option");
  expect(await options.count()).toBeGreaterThanOrEqual(5);
});

test("speed input accepts value changes", async ({ page }) => {
  await gotoEditor(page);
  await page.locator("#optSpeed").fill("2.5");
  await expect(page.locator("#optSpeed")).toHaveValue("2.5");
});

test("thinking toggle can be unchecked", async ({ page }) => {
  await gotoEditor(page);
  const checkbox = page.locator("#optThinking");
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
});

test("tool calls toggle can be unchecked", async ({ page }) => {
  await gotoEditor(page);
  const checkbox = page.locator("#optToolCalls");
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
});

test("timing select has three options", async ({ page }) => {
  await gotoEditor(page);
  const options = page.locator("#optTiming option");
  await expect(options).toHaveCount(3);
});

// ─── Help modal ────────────────────────────────────────────

test("help button opens modal", async ({ page }) => {
  await gotoEditor(page);
  await expect(page.locator("#helpModal")).not.toHaveClass(/open/);

  await page.locator("#helpBtn").click();
  await expect(page.locator("#helpModal")).toHaveClass(/open/);
});

test("help modal closes with X button", async ({ page }) => {
  await gotoEditor(page);
  await page.locator("#helpBtn").click();
  await expect(page.locator("#helpModal")).toHaveClass(/open/);

  await page.locator("#helpModalClose").click();
  await expect(page.locator("#helpModal")).not.toHaveClass(/open/);
});

test("help modal closes with Escape", async ({ page }) => {
  await gotoEditor(page);
  await page.locator("#helpBtn").click();
  await expect(page.locator("#helpModal")).toHaveClass(/open/);

  await page.keyboard.press("Escape");
  await expect(page.locator("#helpModal")).not.toHaveClass(/open/);
});

// ─── Dark / light mode ────────────────────────────────────

test("dark/light toggle switches mode", async ({ page }) => {
  await gotoEditor(page);

  // Should start in dark mode (no .light class on html)
  const htmlEl = page.locator("html");
  await expect(htmlEl).not.toHaveClass(/light/);

  // Click toggle
  await page.locator("#themeModeBtn").click();
  await expect(htmlEl).toHaveClass(/light/);

  // Click again to go back
  await page.locator("#themeModeBtn").click();
  await expect(htmlEl).not.toHaveClass(/light/);
});

// ─── Sidebar toggle ───────────────────────────────────────

test("sidebar toggle collapses and expands sidebar", async ({ page }) => {
  await gotoEditor(page);

  // Should start expanded
  await expect(page.locator("body")).not.toHaveClass(/sidebar-collapsed/);

  // Click toggle
  await page.locator("#sidebarToggleBtn").click();
  await expect(page.locator("body")).toHaveClass(/sidebar-collapsed/);

  // Click again
  await page.locator("#sidebarToggleBtn").click();
  await expect(page.locator("body")).not.toHaveClass(/sidebar-collapsed/);
});

test("sidebar is visible after reopen when resize handle was dragged", async ({ page }) => {
  await gotoEditor(page);
  const sidebar = page.locator(".sidebar");

  // Collapse sidebar
  await page.locator("#sidebarToggleBtn").click();
  await expect(page.locator("body")).toHaveClass(/sidebar-collapsed/);

  // Drag resize handle to simulate column resize while collapsed
  const handle = page.locator("#resizeHandle");
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 2, box.y + 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 50, box.y + 2);
  await page.mouse.up();

  // Re-open sidebar
  await page.locator("#sidebarToggleBtn").click();
  await expect(page.locator("body")).not.toHaveClass(/sidebar-collapsed/);

  // Sidebar should be visible (width > 100px)
  const width = await sidebar.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(100);
});

// ─── Export ────────────────────────────────────────────────

test("export button triggers download", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);

  // Wait for preview to be ready
  await expect(page.locator("#refreshIndicator")).not.toHaveClass(/active/, { timeout: 10000 });

  // Listen for download
  const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
  await page.locator("#exportBtn").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.html$/);
});

// ─── Reset ─────────────────────────────────────────────────

test("reset button restores original turns", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);

  // Edit a turn
  const textarea = page.locator('textarea[data-action="edit"][data-index="1"]');
  const originalText = await textarea.inputValue();
  await textarea.fill("Modified text");

  // Wait for edit to register
  await page.waitForTimeout(400);

  // Reset (accept custom confirmation modal)
  await page.locator("#resetBtn").click();
  await page.locator("#confirmOk").click();

  // Text should be restored
  await expect(textarea).toHaveValue(originalText);
});

// ─── Turn click navigates preview ──────────────────────────

// ─── Expand / Collapse All ─────────────────────────────────

test("expand all opens all turn block details", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);

  // Expand all turns first
  await page.locator("#expandAllBtn").click();
  const openDetails = await page.locator(".turn-blocks-detail.open").count();
  expect(openDetails).toBe(5);

  // Collapse all
  await page.locator("#collapseAllBtn").click();
  const closedDetails = await page.locator(".turn-blocks-detail.open").count();
  expect(closedDetails).toBe(0);
});

// ─── Auto-collapse on exclude ─────────────────────────────

test("excluding a turn collapses its expanded blocks", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);

  // Expand turn 2
  await page.locator('[data-action="expand"][data-index="2"]').click();
  await expect(page.locator("#blocks-2")).toHaveClass(/open/);

  // Exclude turn 2
  await page.locator('input[data-action="toggle"][data-index="2"]').uncheck();

  // Blocks should be collapsed
  await expect(page.locator("#blocks-2")).not.toHaveClass(/open/);
});

test("exclude all collapses all expanded blocks", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);

  // Expand a couple of turns
  await page.locator('[data-action="expand"][data-index="1"]').click();
  await page.locator('[data-action="expand"][data-index="3"]').click();
  expect(await page.locator(".turn-blocks-detail.open").count()).toBe(2);

  // Exclude all
  await page.locator("#selectNoneBtn").click();

  // All blocks should be collapsed
  expect(await page.locator(".turn-blocks-detail.open").count()).toBe(0);
});

// ─── Sub-block collapse ─────────────────────────────────────

test("tool and thinking blocks are collapsed by default, text is open", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);

  // Expand turn 1 to see its blocks
  await page.locator('[data-action="expand"][data-index="1"]').click();
  await expect(page.locator("#blocks-1")).toHaveClass(/open/);

  // Text blocks should be open, tool/thinking should be collapsed
  const openTextHeaders = page.locator("#blocks-1 .block-item-header.block-text.open");
  const closedToolHeaders = page.locator("#blocks-1 .block-item-header.block-tool:not(.open)");
  const closedThinkingHeaders = page.locator("#blocks-1 .block-item-header.block-thinking:not(.open)");

  // At least text blocks should be open (if any exist in this turn)
  const textCount = await openTextHeaders.count();
  const toolCount = await closedToolHeaders.count();
  const thinkingCount = await closedThinkingHeaders.count();
  expect(textCount + toolCount + thinkingCount).toBeGreaterThan(0);
});

test("clicking a block header toggles its body", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);

  // Expand turn 2 (has tool calls)
  await page.locator('[data-action="expand"][data-index="2"]').click();

  // Find a tool header — should be collapsed
  const toolHeader = page.locator("#blocks-2 .block-item-header.block-tool").first();
  await expect(toolHeader).not.toHaveClass(/open/);

  // Click to expand
  await toolHeader.click();
  await expect(toolHeader).toHaveClass(/open/);

  // Click to collapse
  await toolHeader.click();
  await expect(toolHeader).not.toHaveClass(/open/);
});

// ─── Turn click navigates preview ──────────────────────────

test("clicking turn header updates preview hash", async ({ page }) => {
  await gotoEditor(page);
  await loadFixture(page);

  // Wait for preview to load
  await expect(page.locator("#refreshIndicator")).not.toHaveClass(/active/, { timeout: 10000 });
  // Give iframe time to initialize
  await page.waitForTimeout(500);

  // Click on turn 3 header (on the label, not the checkbox)
  await page.locator('.turn-card[data-index="3"] .turn-label').click();

  // The iframe hash should be updated
  await page.waitForTimeout(300);
  const iframe = page.frameLocator("#previewIframe");
  // Turn 3 should be visible in the preview
  await expect(iframe.locator('.turn[data-index="3"]')).toBeVisible({ timeout: 5000 });
});
