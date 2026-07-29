import { test, expect } from "@playwright/test";
import { MONERO_MINING_ADDRESS } from "./constants";
import { generateBlocks } from "./helpers/moneroRpc";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";
import type { WalletMainPage } from "./pages/wallet-main.page";

const XMR_ATOMIC_UNITS_PER_XMR = 1_000_000_000_000n;
const INITIAL_MINED_BLOCKS = 140;
const POST_SEND_MINED_BLOCKS = 70;
const SUBADDRESS_SWEEP_COUNT = 3;
const WALLET_ADDRESS_TRANSFER_AMOUNT_XMR = "1";
const WALLET_ADDRESS_TRANSFER_AMOUNT_ATOMIC =
  BigInt(WALLET_ADDRESS_TRANSFER_AMOUNT_XMR) * XMR_ATOMIC_UNITS_PER_XMR;

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

test("sweep all spends unlocked outputs from every wallet address", async ({
  page,
  context,
}) => {
  test.setTimeout(600_000);

  const minerInitial = new InitialWalletListPage(page);
  let minerWallet: WalletMainPage;
  let minerAddress = "";
  let senderWallet: WalletMainPage;
  const fundedAddresses: {
    title: string;
    address: string;
    indexMinor: number;
  }[] = [];

  await test.step("Create miner wallet", async () => {
    await minerInitial.goto();
    await minerInitial.waitUntilLoaded();
    await minerInitial.openCreateWallet();
    minerWallet = await minerInitial.createNewWallet({
      walletName: `sweep-subaddresses-miner-${Date.now()}`,
    });
    minerAddress = await minerWallet.getPrimaryAddress();
  });

  await test.step("Mine spendable miner funds", async () => {
    await generateBlocks(minerAddress, INITIAL_MINED_BLOCKS);
    await minerWallet.waitForUnlockedBalanceAtLeast(
      WALLET_ADDRESS_TRANSFER_AMOUNT_ATOMIC *
        BigInt(SUBADDRESS_SWEEP_COUNT + 1),
    );
  });

  await test.step("Create sender wallet and subaddresses", async () => {
    const senderPage = await context.newPage();
    await initializeAppTestSettings(senderPage);
    const senderInitial = new InitialWalletListPage(senderPage);

    await senderInitial.goto();
    await senderInitial.waitUntilLoaded();
    await senderInitial.openCreateWallet();
    senderWallet = await senderInitial.createNewWallet({
      walletName: `sweep-subaddresses-sender-${Date.now()}`,
    });
    const senderPrimaryAddress = await senderWallet.getPrimaryAddress();
    fundedAddresses.push({
      title: "Primary address",
      address: senderPrimaryAddress,
      indexMinor: 0,
    });

    for (let i = 0; i < SUBADDRESS_SWEEP_COUNT; i++) {
      const label = `Sweep sender ${i + 1}`;
      const title = await senderWallet.addSubaddress(label);
      const address = await senderWallet.getAddressFromReceiveRow(title);
      fundedAddresses.push({ title, address, indexMinor: i + 1 });
    }
  });

  await test.step("Send funds to each sender wallet address", async () => {
    await minerWallet.reviewSendMany(
      fundedAddresses.map((fundedAddress) => ({
        address: fundedAddress.address,
        amountXmr: WALLET_ADDRESS_TRANSFER_AMOUNT_XMR,
      })),
    );
    await minerWallet.confirmSend();
    await minerWallet.dismissSentScreen();
    await minerWallet.waitForPaymentTypeCountAtLeast("pending", 1);
    await generateBlocks(MONERO_MINING_ADDRESS, POST_SEND_MINED_BLOCKS);
  });

  let senderBalanceBeforeSweep = 0n;
  await test.step("Verify each sender wallet address received funds", async () => {
    let receivedByAddresses = 0n;
    for (const fundedAddress of fundedAddresses) {
      const received = await senderWallet.waitForUnspentCoinAtSubaddress(
        fundedAddress.indexMinor,
        WALLET_ADDRESS_TRANSFER_AMOUNT_ATOMIC,
      );
      receivedByAddresses += received;
    }

    senderBalanceBeforeSweep =
      await senderWallet.waitForUnlockedBalanceAtLeast(receivedByAddresses);
    expect(senderBalanceBeforeSweep).toBeGreaterThan(0n);
  });

  let recipientWallet: WalletMainPage;
  let recipientAddress = "";
  let recipientBalanceBeforeSweep = 0n;
  await test.step("Create recipient wallet", async () => {
    const recipientPage = await context.newPage();
    await initializeAppTestSettings(recipientPage);
    const recipientInitial = new InitialWalletListPage(recipientPage);
    await recipientInitial.goto();
    await recipientInitial.waitUntilLoaded();
    await recipientInitial.openCreateWallet();
    recipientWallet = await recipientInitial.createNewWallet({
      walletName: `sweep-subaddresses-recipient-${Date.now()}`,
    });
    recipientAddress = await recipientWallet.getPrimaryAddress();
    recipientBalanceBeforeSweep =
      (await recipientWallet.getUnlockedBalanceAtomic()) ?? 0n;
  });

  let sweepOutgoing = 0n;
  await test.step("Review sweep all transaction", async () => {
    await senderWallet.reviewSweepAllXmr(recipientAddress);
    await senderWallet.expectSendReviewAddress(recipientAddress);
    await senderWallet.expectSendReviewBalanceAfterSendingAtomic(0n);
    sweepOutgoing = await senderWallet.getSendReviewTotalOutgoingAtomic();
    expect(sweepOutgoing).toBeGreaterThan(0n);
    expect(sweepOutgoing).toBeLessThan(senderBalanceBeforeSweep);
  });

  await test.step("Send sweep all transaction", async () => {
    await senderWallet.confirmSend();
    await senderWallet.dismissSentScreen();
    await senderWallet.waitForPaymentTypeCountAtLeast("pending", 1);
    await recipientWallet.waitForPaymentTypeCountAtLeast("mempool", 1);
  });

  await test.step("Mine sweep transaction and verify final balances", async () => {
    await generateBlocks(MONERO_MINING_ADDRESS, POST_SEND_MINED_BLOCKS);

    await senderWallet.waitForUnlockedBalanceAtMost(0n);
    await senderWallet.waitForLockedBalanceAtMost(0n);

    const recipientBalance =
      await recipientWallet.waitForUnlockedBalanceAtLeast(
        recipientBalanceBeforeSweep + sweepOutgoing,
        240_000,
      );
    expect(recipientBalance).toBeGreaterThanOrEqual(
      recipientBalanceBeforeSweep + sweepOutgoing,
    );
  });
});
