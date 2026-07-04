import { expect, test } from "@playwright/test";
import {
  FROM_KEYS_TEST_ADDRESS,
  MONERO_MINING_ADDRESS,
  MONERO_RESTORE_SEED,
} from "./constants";
import { callMoneroJsonRpc, generateBlocks } from "./helpers/moneroRpc";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";

const INITIAL_MINED_BLOCKS = 80;
const XMR_ATOMIC_UNITS_PER_XMR = 1_000_000_000_000n;
const MIN_FUNDED_BALANCE = 10n * XMR_ATOMIC_UNITS_PER_XMR;

function getExpectedVariant(projectName: string): "asyncify" | "threads" {
  if (projectName.includes("threads")) {
    return "threads";
  }
  if (projectName.includes("asyncify")) {
    return "asyncify";
  }
  throw new Error(`Unexpected WASM variant matrix project: ${projectName}`);
}

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("loads expected WASM variant and restores funded wallet", async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(600_000);

  const expectedVariant = getExpectedVariant(testInfo.project.name);
  const expectedSharedArrayBuffer =
    expectedVariant === "threads" ? "function" : "undefined";
  const initial = new InitialWalletListPage(page);
  const walletName = `variant-${expectedVariant}-${Date.now()}`;
  let restoreStartingHeight = "0";

  if (expectedVariant === "asyncify") {
    await context.addInitScript(() => {
      Reflect.deleteProperty(globalThis, "SharedArrayBuffer");
    });
  }

  await test.step("Mine initial blocks for restored wallet", async () => {
    const info = await callMoneroJsonRpc<{ height: number }>("get_info", {});
    restoreStartingHeight = Math.max(0, info.height - 1).toString();
    await generateBlocks(MONERO_MINING_ADDRESS, INITIAL_MINED_BLOCKS);
  });

  await test.step("Restore funded wallet", async () => {
    await initial.goto();
    await initial.waitUntilLoaded();
    await expect(page.evaluate(() => typeof SharedArrayBuffer)).resolves.toBe(
      expectedSharedArrayBuffer,
    );
    await initial.openRestoreWallet();
    const wallet = await initial.restoreWallet({
      walletName,
      seed: MONERO_RESTORE_SEED,
      startingHeight: restoreStartingHeight,
    });
    expect(await wallet.getPrimaryAddress()).toBe(FROM_KEYS_TEST_ADDRESS);

    await wallet.waitForUnlockedBalanceAtLeast(MIN_FUNDED_BALANCE);

    await wallet.exitFromWallet();
  });

  await test.step("Options view shows expected WASM variant", async () => {
    await initial.expectLoaded();
    await page.getByRole("button", { name: /options/i }).click();
    const desktopBuildInfo = page.locator(".hidden.sm\\:block");
    await expect(desktopBuildInfo).toBeVisible();
    await expect(desktopBuildInfo).toContainText(expectedVariant);
  });
});
