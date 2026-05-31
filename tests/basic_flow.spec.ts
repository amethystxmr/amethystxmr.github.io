import { test, expect } from "@playwright/test";
import { MONERO_MINING_ADDRESS, MONERO_RESTORE_SEED } from "./constants";
import { generateBlocks } from "./helpers/moneroRpc";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";
import type { WalletMainPage } from "./pages/wallet-main.page";

const TRANSFER_AMOUNT_XMR = "3";
const XMR_ATOMIC_UNITS_PER_XMR = 1_000_000_000_000n;
const MIN_EXPECTED_UNLOCKED_BALANCE =
  BigInt(TRANSFER_AMOUNT_XMR) * XMR_ATOMIC_UNITS_PER_XMR;
const MIN_FUNDED_BALANCE = 10n * XMR_ATOMIC_UNITS_PER_XMR;
const INITIAL_MINED_BLOCKS = 140;
const POST_SEND_MINED_BLOCKS = 70;

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
  if (process.env.PW_BROWSER_CONSOLE) {
    page.on("console", (msg) => {
      console.log(`[browser ${msg.type()}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => {
      console.error("[browser pageerror]", err);
    });
  }
});

test("basic flow", async ({ page, context }) => {
  test.setTimeout(600_000);

  const wallet1Initial = new InitialWalletListPage(page);
  const wallet1Name = `wallet1-restore-${Date.now()}`;
  let wallet1: WalletMainPage;
  await test.step("Mine initial blocks for restored wallet", async () => {
    await generateBlocks(MONERO_MINING_ADDRESS, INITIAL_MINED_BLOCKS);
  });

  await test.step("Restore wallet from seed", async () => {
    await wallet1Initial.goto();
    await wallet1Initial.waitUntilLoaded();
    await wallet1Initial.openRestoreWallet();
    wallet1 = await wallet1Initial.restoreWallet({
      walletName: wallet1Name,
      seed: MONERO_RESTORE_SEED,
      startingHeight: "30",
    });
  });

  await test.step("Dev server has no COOP/COEP; SharedArrayBuffer unavailable", async () => {
    await expect(page.evaluate(() => typeof SharedArrayBuffer)).resolves.toBe(
      "undefined",
    );
  });

  await test.step("Verify restored wallet has mined transactions", async () => {
    const wallet1MinedCount = await wallet1.waitForPaymentTypeCountAtLeast(
      "block",
      1,
    );
    expect(wallet1MinedCount).toBeGreaterThan(0);

    const fundedBalance = await wallet1.getUnlockedBalanceAtomic();
    expect(fundedBalance).not.toBeNull();
    expect(fundedBalance).toBeGreaterThanOrEqual(MIN_FUNDED_BALANCE);
  });

  await test.step("Coins overlay lists unspent outputs", async () => {
    await wallet1.openCoinsOverlay();
    await wallet1.expectUnspentCoinCountAtLeast(1);
    await wallet1.closeCoinsOverlay();
  });

  let wallet2: WalletMainPage;
  let wallet2Address = "";
  await test.step("Create recipient wallet in second page", async () => {
    const page2 = await context.newPage();
    await initializeAppTestSettings(page2);
    const wallet2Initial = new InitialWalletListPage(page2);
    const wallet2Name = `wallet2-new-${Date.now()}`;

    await wallet2Initial.goto();
    await wallet2Initial.waitUntilLoaded();
    await wallet2Initial.openCreateWallet();
    wallet2 = await wallet2Initial.createNewWallet({
      walletName: wallet2Name,
    });
    wallet2Address = await wallet2.getPrimaryAddress();
    expect(wallet2Address.length).toBeGreaterThan(20);
  });

  await test.step("Send XMR from restored wallet to recipient", async () => {
    await wallet1.reviewSend(wallet2Address, TRANSFER_AMOUNT_XMR);
    await wallet1.expectSendReviewOutgoing(TRANSFER_AMOUNT_XMR);
    await wallet1.confirmSend();
    await wallet1.expectSentScreen(TRANSFER_AMOUNT_XMR);
    await wallet1.dismissSentScreen();
  });

  await test.step("Verify pending and mempool transaction states", async () => {
    const wallet1PendingCount = await wallet1.waitForPaymentTypeCountAtLeast(
      "pending",
      1,
    );
    expect(wallet1PendingCount).toBeGreaterThan(0);
    await wallet1.expectLatestTransactionAmount(
      "Pending",
      TRANSFER_AMOUNT_XMR,
      "-",
    );

    const wallet2MempoolCount = await wallet2.waitForPaymentTypeCountAtLeast(
      "mempool",
      1,
    );
    expect(wallet2MempoolCount).toBeGreaterThan(0);
    await wallet2.expectLatestTransactionAmount(
      "Mempool In",
      TRANSFER_AMOUNT_XMR,
      "+",
    );
  });

  await test.step("Mine unlock blocks and verify recipient unlocked balance", async () => {
    await generateBlocks(MONERO_MINING_ADDRESS, POST_SEND_MINED_BLOCKS);
    const balance = await wallet2.waitForUnlockedBalanceAtLeast(
      MIN_EXPECTED_UNLOCKED_BALANCE,
      240_000,
    );
    expect(balance).toBeGreaterThanOrEqual(MIN_EXPECTED_UNLOCKED_BALANCE);
  });

  let wallet2BalanceBeforeSweep: bigint | null = null;
  await test.step("Capture recipient balance before sweep all", async () => {
    wallet2BalanceBeforeSweep = await wallet2.getUnlockedBalanceAtomic();
    expect(wallet2BalanceBeforeSweep).not.toBeNull();
  });

  await test.step("Sweep all remaining funds from restored wallet to recipient", async () => {
    await wallet1.sweepAllXmr(wallet2Address);
  });

  await test.step("Verify sweep all reaches recipient wallet", async () => {
    const wallet1PendingCountAfterSweep =
      await wallet1.waitForPaymentTypeCountAtLeast("pending", 1);
    expect(wallet1PendingCountAfterSweep).toBeGreaterThanOrEqual(1);

    const wallet2MempoolCountAfterSweep =
      await wallet2.waitForPaymentTypeCountAtLeast("mempool", 1);
    expect(wallet2MempoolCountAfterSweep).toBeGreaterThanOrEqual(1);

    await generateBlocks(MONERO_MINING_ADDRESS, POST_SEND_MINED_BLOCKS);

    const sweptBalance = await wallet2.waitForUnlockedBalanceAtLeast(
      (wallet2BalanceBeforeSweep ?? 0n) + 1n,
      240_000,
    );
    expect(sweptBalance).toBeGreaterThan(wallet2BalanceBeforeSweep ?? 0n);
  });
});
