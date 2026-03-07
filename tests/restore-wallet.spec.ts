import { test, expect } from "@playwright/test";
import {
  MONERO_MINING_ADDRESS,
  MONERO_RESTORE_SEED,
} from "./constants";
import { generateBlocks } from "./helpers/moneroRpc";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";

const MIN_EXPECTED_UNLOCKED_BALANCE = 1_000_000_000n; // 0.001 XMR
const INITIAL_MINED_BLOCKS = 140;

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("restore wallet", async ({ page }) => {
  const initialWalletListPage = new InitialWalletListPage(page);
  const walletName = `restore-wallet-e2e-${Date.now()}`;

  await generateBlocks(MONERO_MINING_ADDRESS, INITIAL_MINED_BLOCKS);

  await initialWalletListPage.goto();
  await initialWalletListPage.waitUntilLoaded();
  await initialWalletListPage.openRestoreWallet();
  const walletMainPage = await initialWalletListPage.restoreWallet({
    walletName,
    seed: MONERO_RESTORE_SEED,
    startingHeight: "30",
  });

  const balance = await walletMainPage.waitForUnlockedBalanceAtLeast(
    MIN_EXPECTED_UNLOCKED_BALANCE,
    120_000,
  );

  expect(balance).toBeGreaterThan(MIN_EXPECTED_UNLOCKED_BALANCE);
});
