import { test, expect } from "@playwright/test";
import { initializeAppTestSettings } from "./helpers/testSettings";

/**
 * Wallet WASM is single-threaded (Asyncify for HTTP); ensure the UI still boots
 * when SharedArrayBuffer is absent (no cross-origin isolation headers).
 */
test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => {
    try {
      Reflect.deleteProperty(globalThis, "SharedArrayBuffer");
    } catch {
      /* ignore */
    }
  });
  await initializeAppTestSettings(page);
});

test("boots without SharedArrayBuffer", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /^(?:↺\s*)?Restore$/i }),
  ).toBeVisible({ timeout: 180_000 });
});
