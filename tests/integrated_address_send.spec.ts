import { expect, test } from "@playwright/test";
import {
  FROM_KEYS_TEST_ADDRESS,
  INTEGRATED_RECIPIENT_ADDRESS,
  INTEGRATED_RECIPIENT_INTEGRATED_ADDRESS,
  INTEGRATED_RECIPIENT_PRIVATE_SPEND_KEY,
  INTEGRATED_RECIPIENT_PRIVATE_VIEW_KEY,
  MONERO_MINING_ADDRESS,
  MONERO_RESTORE_SEED,
} from "./constants";
import { generateBlocks } from "./helpers/moneroRpc";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";
import type { WalletMainPage } from "./pages/wallet-main.page";

const TRANSFER_AMOUNT_XMR = "2.345678901234";
const XMR_ATOMIC_UNITS_PER_XMR = 1_000_000_000_000n;
const TRANSFER_AMOUNT_ATOMIC = 2_345_678_901_234n;
const MIN_EXPECTED_UNLOCKED_BALANCE = TRANSFER_AMOUNT_ATOMIC;
const MIN_FUNDED_BALANCE = 10n * XMR_ATOMIC_UNITS_PER_XMR;
const INITIAL_MINED_BLOCKS = 140;
const POST_SEND_MINED_BLOCKS = 70;

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("send to integrated address pays integrated recipient", async ({
  page,
  context,
}) => {
  test.setTimeout(600_000);

  const wallet1Initial = new InitialWalletListPage(page);
  const wallet1Name = `wallet1-integrated-${Date.now()}`;
  let wallet1: WalletMainPage;
  await test.step("Mine initial blocks for restored wallet", async () => {
    await generateBlocks(MONERO_MINING_ADDRESS, INITIAL_MINED_BLOCKS);
  });

  await test.step("Restore funded wallet from seed", async () => {
    await wallet1Initial.goto();
    await wallet1Initial.waitUntilLoaded();
    await wallet1Initial.openRestoreWallet();
    wallet1 = await wallet1Initial.restoreWallet({
      walletName: wallet1Name,
      seed: MONERO_RESTORE_SEED,
      startingHeight: "30",
    });
    expect(await wallet1.getPrimaryAddress()).toBe(FROM_KEYS_TEST_ADDRESS);
  });

  await test.step("Verify restored wallet has mined funds", async () => {
    const wallet1MinedCount = await wallet1.waitForPaymentTypeCountAtLeast(
      "block",
      1,
    );
    expect(wallet1MinedCount).toBeGreaterThan(0);

    const fundedBalance = await wallet1.getUnlockedBalanceAtomic();
    expect(fundedBalance).not.toBeNull();
    expect(fundedBalance).toBeGreaterThanOrEqual(MIN_FUNDED_BALANCE);
  });

  let wallet2: WalletMainPage;
  await test.step("Restore recipient wallet from keys", async () => {
    const page2 = await context.newPage();
    await initializeAppTestSettings(page2);
    const wallet2Initial = new InitialWalletListPage(page2);
    const wallet2Name = `wallet2-integrated-${Date.now()}`;

    await wallet2Initial.goto();
    await wallet2Initial.waitUntilLoaded();
    await wallet2Initial.openRestoreWallet();
    wallet2 = await wallet2Initial.restoreWalletFromKeys({
      walletName: wallet2Name,
      address: INTEGRATED_RECIPIENT_ADDRESS,
      secretViewKey: INTEGRATED_RECIPIENT_PRIVATE_VIEW_KEY,
      secretSpendKey: INTEGRATED_RECIPIENT_PRIVATE_SPEND_KEY,
      startingHeight: "0",
    });
    expect(await wallet2.getPrimaryAddress()).toBe(
      INTEGRATED_RECIPIENT_ADDRESS,
    );
  });

  await test.step("Review send shows the integrated address unchanged", async () => {
    await wallet1.reviewSend(
      INTEGRATED_RECIPIENT_INTEGRATED_ADDRESS,
      TRANSFER_AMOUNT_XMR,
    );
    await wallet1.expectSendReviewOutgoing(TRANSFER_AMOUNT_XMR);
    await wallet1.expectSendReviewAddress(
      INTEGRATED_RECIPIENT_INTEGRATED_ADDRESS,
    );
  });

  await test.step("Send and verify pending destination keeps integrated address", async () => {
    await wallet1.confirmSend();
    await wallet1.expectSentScreen(TRANSFER_AMOUNT_XMR);
    await wallet1.dismissSentScreen();
    await wallet1.expectLatestTransactionDestinationAddress(
      "Pending",
      INTEGRATED_RECIPIENT_INTEGRATED_ADDRESS,
    );
    const wallet1LockedBalance = await wallet1.waitForLockedBalanceAtLeast(1n);
    expect(wallet1LockedBalance).toBeGreaterThan(0n);
  });

  await test.step("Verify payment reaches the underlying standard address", async () => {
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
    await generateBlocks(MONERO_MINING_ADDRESS, POST_SEND_MINED_BLOCKS);
    const wallet1OutgoingCount = await wallet1.waitForPaymentTypeCountAtLeast(
      "out",
      1,
    );
    expect(wallet1OutgoingCount).toBeGreaterThan(0);
    await wallet1.expectLatestTransactionAmount(
      "Outgoing",
      TRANSFER_AMOUNT_XMR,
      "-",
    );
    await wallet1.expectLatestTransactionDestinationAddress(
      "Outgoing",
      INTEGRATED_RECIPIENT_INTEGRATED_ADDRESS,
    );
    const balance = await wallet2.waitForUnlockedBalanceAtLeast(
      MIN_EXPECTED_UNLOCKED_BALANCE,
      240_000,
    );
    expect(balance).toBeGreaterThanOrEqual(MIN_EXPECTED_UNLOCKED_BALANCE);
  });
});
