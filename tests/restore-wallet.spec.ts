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
const POST_SEND_MINED_BLOCKS = 70;
const TRANSFER_AMOUNT_XMR = "3";

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("basic flow", async ({ page, context }) => {
  const wallet1Initial = new InitialWalletListPage(page);
  const wallet1Name = `wallet1-restore-${Date.now()}`;

  await generateBlocks(MONERO_MINING_ADDRESS, INITIAL_MINED_BLOCKS);

  await wallet1Initial.goto();
  await wallet1Initial.waitUntilLoaded();
  await wallet1Initial.openRestoreWallet();
  const wallet1 = await wallet1Initial.restoreWallet({
    walletName: wallet1Name,
    seed: MONERO_RESTORE_SEED,
    startingHeight: "30",
  });

  const wallet1MinedCount = await wallet1.waitForPaymentTypeCountAtLeast(
    "block",
    1,
  );
  expect(wallet1MinedCount).toBeGreaterThan(0);

  const page2 = await context.newPage();
  await initializeAppTestSettings(page2);
  const wallet2Initial = new InitialWalletListPage(page2);
  const wallet2Name = `wallet2-new-${Date.now()}`;

  await wallet2Initial.goto();
  await wallet2Initial.waitUntilLoaded();
  await wallet2Initial.openCreateWallet();
  const wallet2 = await wallet2Initial.createNewWallet({
    walletName: wallet2Name,
  });
  const wallet2Address = await wallet2.getPrimaryAddress();
  expect(wallet2Address.length).toBeGreaterThan(20);

  await wallet1.sendXmr(wallet2Address, TRANSFER_AMOUNT_XMR);

  const wallet1PendingCount = await wallet1.waitForPaymentTypeCountAtLeast(
    "pending",
    1,
  );
  expect(wallet1PendingCount).toBeGreaterThan(0);

  const wallet2MempoolCount = await wallet2.waitForPaymentTypeCountAtLeast(
    "mempool",
    1,
  );
  expect(wallet2MempoolCount).toBeGreaterThan(0);

  await generateBlocks(MONERO_MINING_ADDRESS, POST_SEND_MINED_BLOCKS);

  const balance = await wallet2.waitForUnlockedBalanceAtLeast(
    MIN_EXPECTED_UNLOCKED_BALANCE,
    180_000,
  );

  expect(balance).toBeGreaterThanOrEqual(MIN_EXPECTED_UNLOCKED_BALANCE);
});
