import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  timeout: 15000,
  use: {
    browserName: "chromium",
    headless: true,
  },
});
