import { expect, test, type Page } from "@playwright/test";
import { InitialWalletListPage } from "../pages/initial-wallet-list.page";
import { expectPageIsolationForWasmVariant } from "./variantMatrixExpectations";

export type MainE2eWasmVariant = "asyncify" | "threads";

const MAIN_E2E_PROJECTS: Record<string, MainE2eWasmVariant> = {
  "chromium-asyncify": "asyncify",
  "chromium-threads": "threads",
};

export function getMainE2eExpectedWasmVariant(
  projectName: string,
): MainE2eWasmVariant {
  const expected = MAIN_E2E_PROJECTS[projectName];
  if (!expected) {
    throw new Error(
      `Unexpected Playwright project for main e2e WASM checks: ${projectName}`,
    );
  }
  return expected;
}

async function ensureWalletListForOptions(page: Page): Promise<void> {
  const restoreButton = page.getByRole("button", {
    name: /^(?:↺\s*)?Restore$/i,
  });
  if (await restoreButton.isVisible().catch(() => false)) {
    return;
  }

  const exitButton = page.getByRole("button", { name: /exit/i });
  if (await exitButton.isVisible().catch(() => false)) {
    await exitButton.click();
    await expect(restoreButton).toBeVisible();
    return;
  }

  await page.goto("/");
  await expect(restoreButton).toBeVisible();
}

export async function verifyMainE2eWasmVariant(
  page: Page,
  projectName: string,
): Promise<void> {
  const expected = getMainE2eExpectedWasmVariant(projectName);

  await test.step(`Verify ${expected} WASM variant was running`, async () => {
    if (page.isClosed()) {
      return;
    }

    await expectPageIsolationForWasmVariant(page, expected);
    await ensureWalletListForOptions(page);

    const initial = new InitialWalletListPage(page);
    await initial.expectLoaded();
    await page.getByRole("button", { name: /options/i }).click();

    const buildInfo = page.locator('[aria-label="Build information"]');
    await expect(buildInfo).toBeVisible();
    await expect(buildInfo).toContainText(expected);
  });
}
