import { expect, test } from "@playwright/test";
import {
  FROM_KEYS_TEST_ADDRESS,
  MONERO_MINING_ADDRESS,
  MONERO_RESTORE_SEED,
} from "./constants";
import { callMoneroJsonRpc, generateBlocks } from "./helpers/moneroRpc";
import { initializeAppTestSettings } from "./helpers/testSettings";
import {
  expectMatrixRuntimeIsolation,
  expectMatrixRuntimeVariant,
  expectMatrixServerCoiHeaders,
  expectMatrixServiceWorkers,
  expectPlaywrightProjectMatchesMatrix,
  getVariantMatrixExpectations,
} from "./helpers/variantMatrixExpectations";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";
import { WalletMainPage } from "./pages/wallet-main.page";

const INITIAL_MINED_BLOCKS = 80;
const XMR_ATOMIC_UNITS_PER_XMR = 1_000_000_000_000n;
const MIN_FUNDED_BALANCE = 10n * XMR_ATOMIC_UNITS_PER_XMR;

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("loads expected WASM variant and restores funded wallet", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(600_000);

  const expectations = getVariantMatrixExpectations(testInfo.project.name);
  const initial = new InitialWalletListPage(page);
  const walletName = `variant-${expectations.expectedVariant}-${Date.now()}`;
  let restoreStartingHeight = "0";

  await test.step("Mine initial blocks for restored wallet", async () => {
    const info = await callMoneroJsonRpc<{ height: number }>("get_info", {});
    restoreStartingHeight = Math.max(0, info.height - 1).toString();
    await generateBlocks(MONERO_MINING_ADDRESS, INITIAL_MINED_BLOCKS);
  });

  await test.step("Playwright project matches matrix configuration", async () => {
    expectPlaywrightProjectMatchesMatrix(
      testInfo.project.use.serviceWorkers,
      expectations,
    );
  });

  await test.step("Preview server COI headers match matrix configuration", async () => {
    await expectMatrixServerCoiHeaders(request, expectations);
  });

  await test.step("Load expected runtime variant", async () => {
    await initial.goto();
    await initial.waitUntilLoaded();

    if (
      expectations.allowsServiceWorkers &&
      !expectations.hasServerCoiHeaders
    ) {
      await expectMatrixRuntimeVariant(page, "asyncify");
      await expectMatrixServiceWorkers(page, expectations);
      await page.reload();
      await initial.waitUntilLoaded();
    }

    await expectMatrixRuntimeIsolation(page, expectations);
    await expectMatrixServiceWorkers(page, expectations);
  });

  await test.step("Restore funded wallet", async () => {
    await initial.openRestoreWallet();
    const wallet = await initial.restoreWallet({
      walletName,
      seed: MONERO_RESTORE_SEED,
      startingHeight: restoreStartingHeight,
    });
    expect(await wallet.getPrimaryAddress()).toBe(FROM_KEYS_TEST_ADDRESS);

    await wallet.waitForUnlockedBalanceAtLeast(MIN_FUNDED_BALANCE);
  });

  await test.step("Reload and reopen restored wallet", async () => {
    await page.reload();
    const wallet = new WalletMainPage(page);
    await wallet.waitUntilLoaded();
    expect(await wallet.getPrimaryAddress()).toBe(FROM_KEYS_TEST_ADDRESS);
    await expectMatrixRuntimeIsolation(page, expectations);
    await expectMatrixServiceWorkers(page, expectations);
    await wallet.exitFromWallet();
  });

  await test.step("Options view shows expected WASM variant", async () => {
    await initial.expectLoaded();
    await page.getByRole("button", { name: /options/i }).click();
    const desktopBuildInfo = page.locator(".hidden.sm\\:block");
    await expect(desktopBuildInfo).toBeVisible();
    await expect(desktopBuildInfo).toContainText(expectations.expectedVariant);
  });
});
