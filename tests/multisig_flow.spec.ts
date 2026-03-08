import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { MONERO_MINING_ADDRESS } from "./constants";
import { generateBlocks } from "./helpers/moneroRpc";
import { startMonerod, stopMonerod } from "./helpers/monerod";
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
    await stopMonerod();
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

      // Continue exchanging KEX messages until all wallets are ready.
      const maxRounds = members - threshold + 2;
      for (let round = 0; round < maxRounds; round++) {
        const readyStates = await readUniformReadyStates(multisigWallets, members);
        const readyCount = readyStates.filter(Boolean).length;
        if (readyStates.every(Boolean)) {
          break;
        }

        const currentMessages: string[] = [];
        let transitionedToReady = false;
        for (const wallet of multisigWallets) {
          const message = await wallet.getCurrentMultisigRoundMessage();
          if (!message || message.length === 0) {
            const transitionStates = await readUniformReadyStates(multisigWallets, members);
            if (transitionStates.every(Boolean)) {
              transitionedToReady = true;
              break;
            }
            throw new Error(`Missing current multisig message in round ${round + 1}`);
          }
          currentMessages.push(message);
        }
        if (transitionedToReady) {
          break;
        }
        const joinedMessages = currentMessages.join("\n");
        if (joinedMessages.length === 0) {
          throw new Error(`Joined multisig messages are unexpectedly empty in round ${round + 1}`);
        }
        if (currentMessages.length !== members) {
          throw new Error(
            `Expected ${members} multisig messages in round ${round + 1}, got ${currentMessages.length}`,
          );
        }
        for (const wallet of multisigWallets) {
          await wallet.exchangeMultisigRoundMessages(joinedMessages);
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
      await synchronizeMultisigParticipantData(multisigWallets, threshold);
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

async function synchronizeMultisigParticipantData(
  wallets: WalletMainPage[],
  threshold: number,
): Promise<void> {
  const exportedData = await Promise.all(wallets.map((wallet) => wallet.exportLatestMultisigData()));
  for (let i = 0; i < wallets.length; i++) {
    const dataFromOthers = exportedData
      .filter((_, dataIndex) => dataIndex !== i)
      .slice(0, threshold - 1);
    await wallets[i].importParticipantMultisigData(dataFromOthers);
  }

  const warnings = await Promise.all(
    wallets.map((wallet) => wallet.hasPartialKeyImagesWarning()),
  );
  if (warnings.some(Boolean)) {
    throw new Error("Multisig wallets still report partial key images after one synchronization pass");
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

async function readUniformReadyStates(
  wallets: WalletMainPage[],
  members: number,
  timeoutMs = 15_000,
): Promise<boolean[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const readyStates = await Promise.all(wallets.map((wallet) => wallet.isMultisigReady()));
    const readyCount = readyStates.filter(Boolean).length;
    if (readyCount === 0 || readyCount === members) {
      return readyStates;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const lastStates = await Promise.all(wallets.map((wallet) => wallet.isMultisigReady()));
  throw new Error(`Unexpected mixed multisig readiness state: ${lastStates.join(", ")}`);
}
