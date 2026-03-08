import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { MONERO_MINING_ADDRESS } from "./constants";
import { generateBlocks } from "./helpers/moneroRpc";
import { startMonerod } from "./helpers/monerod";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";
import { type MultisigSignResult, WalletMainPage } from "./pages/wallet-main.page";

const TRANSFER_AMOUNT_XMR = "3";
const XMR_ATOMIC_UNITS_PER_XMR = 1_000_000_000_000n;
const MIN_EXPECTED_UNLOCKED_BALANCE =
  BigInt(TRANSFER_AMOUNT_XMR) * XMR_ATOMIC_UNITS_PER_XMR;
const INITIAL_MINED_BLOCKS = 140;
const POST_SEND_MINED_BLOCKS = 70;

const CASES = [
  { threshold: 2, members: 3 },
  { threshold: 3, members: 4 },
] as const;

test.describe("multisig flow", () => {
  test.beforeEach(async ({ page }) => {
    await startMonerod();
    await initializeAppTestSettings(page);
  });

  for (const { threshold, members } of CASES) {
    test(`${threshold}-of-${members} full kex and send`, async ({ page, context }) => {
      test.setTimeout(300_000);

      const multisigWallets = await createParticipantWallets({
        page,
        context,
        members,
        walletNamePrefix: `msig-${threshold}-of-${members}`,
      });

      const round1Messages: string[] = [];
      for (const wallet of multisigWallets) {
        const message = await wallet.prepareMultisigAndGetRound1Message();
        round1Messages.push(message);
      }

      const allRound1Messages = round1Messages.join("\n");
      for (const wallet of multisigWallets) {
        await wallet.makeMultisig(threshold, members, allRound1Messages);
      }

      for (const wallet of multisigWallets) {
        await wallet.waitForMultisigInProgress(threshold, members);
      }

      const exchangeRounds = members - threshold + 1;
      for (let round = 0; round < exchangeRounds; round++) {
        const expectedRound = round + 2;
        for (const wallet of multisigWallets) {
          await wallet.waitForMultisigRound(expectedRound);
        }

        const currentMessages: string[] = [];
        for (const wallet of multisigWallets) {
          const message = await wallet.getCurrentMultisigRoundMessage();
          currentMessages.push(message);
        }
        for (let i = 0; i < multisigWallets.length; i++) {
          const messagesFromOthers = currentMessages
            .filter((_, messageIndex) => messageIndex !== i)
            .join("\n");
          await multisigWallets[i].exchangeMultisigRoundMessages(messagesFromOthers);
        }

        if (round < exchangeRounds - 1) {
          for (const wallet of multisigWallets) {
            await wallet.waitForMultisigRound(expectedRound + 1);
          }
        }
      }

      for (const wallet of multisigWallets) {
        await wallet.waitForMultisigReady(threshold, members);
      }

      const multisigAddress = await multisigWallets[0].getPrimaryAddress();
      expect(multisigAddress.length).toBeGreaterThan(20);
      await generateBlocks(multisigAddress, INITIAL_MINED_BLOCKS);
      await waitForWalletsAtExactSyncedHeight(
        multisigWallets,
        INITIAL_MINED_BLOCKS + 1,
      );
      await assertAllWalletsHavePartialKeyImages(multisigWallets);
      await synchronizeMultisigParticipantData(multisigWallets.slice(0, threshold));
      const multisigUnlocked = await multisigWallets[0].waitForUnlockedBalanceAtLeast(
        MIN_EXPECTED_UNLOCKED_BALANCE,
      );
      expect(multisigUnlocked).toBeGreaterThanOrEqual(MIN_EXPECTED_UNLOCKED_BALANCE);

      const recipientPage = await context.newPage();
      await initializeAppTestSettings(recipientPage);
      const recipientWallet = await createWalletOnPage(
        recipientPage,
        `recipient-${threshold}-of-${members}-${Date.now()}`,
      );
      const recipientAddress = await recipientWallet.getPrimaryAddress();
      expect(recipientAddress.length).toBeGreaterThan(20);

      let partialData = await multisigWallets[0].createMultisigTransactionAndExport(
        recipientAddress,
        TRANSFER_AMOUNT_XMR,
      );
      for (let signer = 1; signer < threshold; signer++) {
        const result: MultisigSignResult = await multisigWallets[signer].signMultisigTransactionAndContinue(partialData);
        if (signer < threshold - 1) {
          if (result.sent) {
            throw new Error(`Signer ${signer + 1} unexpectedly finalized transaction early`);
          }
          partialData = result.exportedData;
        } else {
          if (!result.sent) {
            throw new Error(`Final signer ${signer + 1} did not finalize multisig transaction`);
          }
        }
      }

      const pendingCount = await multisigWallets[0].waitForPaymentTypeCountAtLeast(
        "pending",
        1,
      );
      expect(pendingCount).toBeGreaterThan(0);
      const mempoolCount = await recipientWallet.waitForPaymentTypeCountAtLeast(
        "mempool",
        1,
      );
      expect(mempoolCount).toBeGreaterThan(0);

      await generateBlocks(MONERO_MINING_ADDRESS, POST_SEND_MINED_BLOCKS);
      const recipientUnlocked = await recipientWallet.waitForUnlockedBalanceAtLeast(
        MIN_EXPECTED_UNLOCKED_BALANCE,
      );
      expect(recipientUnlocked).toBeGreaterThanOrEqual(MIN_EXPECTED_UNLOCKED_BALANCE);
    });
  }
});

async function createParticipantWallets(params: {
  page: Page;
  context: BrowserContext;
  members: number;
  walletNamePrefix: string;
}): Promise<WalletMainPage[]> {
  const wallets: WalletMainPage[] = [];
  for (let i = 0; i < params.members; i++) {
    const walletPage = i === 0 ? params.page : await params.context.newPage();
    await initializeAppTestSettings(walletPage);
    const wallet = await createWalletOnPage(
      walletPage,
      `${params.walletNamePrefix}-member-${i + 1}-${Date.now()}`,
    );
    wallets.push(wallet);
  }
  return wallets;
}

async function createWalletOnPage(page: Page, walletName: string): Promise<WalletMainPage> {
  const initial = new InitialWalletListPage(page);
  await initial.goto();
  await initial.waitUntilLoaded();
  await initial.openCreateWallet();
  return initial.createNewWallet({ walletName });
}

async function synchronizeMultisigParticipantData(wallets: WalletMainPage[]): Promise<void> {
  const exportedData = await Promise.all(wallets.map((wallet) => wallet.exportLatestMultisigData()));
  for (let i = 0; i < wallets.length; i++) {
    const dataFromOthers = exportedData
      .filter((_, dataIndex) => dataIndex !== i);
    await wallets[i].importParticipantMultisigData(dataFromOthers);
  }

  const warnings = await Promise.all(
    wallets.map((wallet) => wallet.hasPartialKeyImagesWarning()),
  );
  if (warnings.some(Boolean)) {
    throw new Error("Multisig wallets still report partial key images after one synchronization pass");
  }
}

async function assertAllWalletsHavePartialKeyImages(wallets: WalletMainPage[]): Promise<void> {
  const warnings = await Promise.all(wallets.map((wallet) => wallet.hasPartialKeyImagesWarning()));
  if (!warnings.every(Boolean)) {
    throw new Error(
      `Expected all wallets to require multisig key image sync, got: ${warnings.join(", ")}`,
    );
  }
}

async function waitForWalletsAtExactSyncedHeight(
  wallets: WalletMainPage[],
  expectedHeight: number,
): Promise<void> {
  for (const wallet of wallets) {
    await wallet.waitForExactSyncedHeight(expectedHeight);
  }
}
