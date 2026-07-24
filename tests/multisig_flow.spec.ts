import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "./fixtures/e2eTest";
import {
  INTEGRATED_RECIPIENT_ADDRESS,
  INTEGRATED_RECIPIENT_INTEGRATED_ADDRESS,
  INTEGRATED_RECIPIENT_PRIVATE_SPEND_KEY,
  INTEGRATED_RECIPIENT_PRIVATE_VIEW_KEY,
  MONERO_MINING_ADDRESS,
} from "./constants";
import { generateBlocks } from "./helpers/moneroRpc";
import { startMonerod } from "./helpers/monerod";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";
import {
  type MultisigSignResult,
  WalletMainPage,
} from "./pages/wallet-main.page";

const TRANSFER_AMOUNT_XMR = "3";
const INTEGRATED_TRANSFER_AMOUNT_XMR = "2.345678901234";
const XMR_ATOMIC_UNITS_PER_XMR = 1_000_000_000_000n;
const MIN_EXPECTED_UNLOCKED_BALANCE =
  BigInt(TRANSFER_AMOUNT_XMR) * XMR_ATOMIC_UNITS_PER_XMR;
const MIN_EXPECTED_INTEGRATED_UNLOCKED_BALANCE = 2_345_678_901_234n;
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
    test(`${threshold}-of-${members} full kex and send`, async ({
      page,
      context,
    }) => {
      test.setTimeout(900_000);

      let multisigWallets: WalletMainPage[] = [];
      await test.step("Create participant wallets", async () => {
        multisigWallets = await createParticipantWallets({
          page,
          context,
          members,
          walletNamePrefix: `msig-${threshold}-of-${members}`,
        });
      });

      await test.step("Prepare multisig round 1 messages and create multisig wallets", async () => {
        const round1Messages: string[] = [];
        for (
          let walletIndex = 0;
          walletIndex < multisigWallets.length;
          walletIndex++
        ) {
          await test.step(`Prepare round 1 message wallet [${walletIndex + 1}/${multisigWallets.length}]`, async () => {
            const message =
              await multisigWallets[
                walletIndex
              ].prepareMultisigAndGetRound1Message();
            round1Messages.push(message);
          });
        }

        const allRound1Messages = round1Messages.join("\n");
        for (
          let walletIndex = 0;
          walletIndex < multisigWallets.length;
          walletIndex++
        ) {
          await test.step(`Make multisig wallet [${walletIndex + 1}/${multisigWallets.length}]`, async () => {
            await multisigWallets[walletIndex].makeMultisig(
              threshold,
              members,
              allRound1Messages,
            );
          });
        }

        for (
          let walletIndex = 0;
          walletIndex < multisigWallets.length;
          walletIndex++
        ) {
          await test.step(`Wait multisig in-progress wallet [${walletIndex + 1}/${multisigWallets.length}]`, async () => {
            await multisigWallets[walletIndex].waitForMultisigInProgress(
              threshold,
              members,
              2,
            );
          });
        }
      });

      await test.step("Complete multisig key exchange rounds", async () => {
        const exchangeRounds = members - threshold + 1;
        for (let round = 0; round < exchangeRounds; round++) {
          await test.step(`KEX round [${round + 1}/${exchangeRounds}]`, async () => {
            const expectedRound = round + 2;
            for (
              let walletIndex = 0;
              walletIndex < multisigWallets.length;
              walletIndex++
            ) {
              await test.step(`Wait expected round ${expectedRound} wallet [${walletIndex + 1}/${multisigWallets.length}]`, async () => {
                await multisigWallets[walletIndex].waitForMultisigRound(
                  expectedRound,
                  threshold,
                  members,
                );
              });
            }

            const currentMessages: string[] = [];
            for (
              let walletIndex = 0;
              walletIndex < multisigWallets.length;
              walletIndex++
            ) {
              await test.step(`Read round message wallet [${walletIndex + 1}/${multisigWallets.length}]`, async () => {
                const message =
                  await multisigWallets[
                    walletIndex
                  ].getCurrentMultisigRoundMessage();
                currentMessages.push(message);
              });
            }
            const joinedMessages = currentMessages.join("\n");
            for (
              let walletIndex = 0;
              walletIndex < multisigWallets.length;
              walletIndex++
            ) {
              await test.step(`Exchange messages wallet [${walletIndex + 1}/${multisigWallets.length}]`, async () => {
                await multisigWallets[
                  walletIndex
                ].exchangeMultisigRoundMessages(joinedMessages);
              });
            }

            if (round < exchangeRounds - 1) {
              for (
                let walletIndex = 0;
                walletIndex < multisigWallets.length;
                walletIndex++
              ) {
                await test.step(`Wait next round ${expectedRound + 1} wallet [${walletIndex + 1}/${multisigWallets.length}]`, async () => {
                  await multisigWallets[walletIndex].waitForMultisigRound(
                    expectedRound + 1,
                    threshold,
                    members,
                  );
                });
              }
            }
          });
        }
      });

      await test.step("Wait for multisig ready state and fund it", async () => {
        for (
          let walletIndex = 0;
          walletIndex < multisigWallets.length;
          walletIndex++
        ) {
          await test.step(`Wait multisig ready wallet [${walletIndex + 1}/${multisigWallets.length}]`, async () => {
            await multisigWallets[walletIndex].waitForMultisigReady(
              threshold,
              members,
            );
          });
        }

        await test.step("Restore one participant from multisig seed", async () => {
          const originalAddress = await multisigWallets[0].getPrimaryAddress();
          const multisigSeedHex =
            await multisigWallets[0].revealMultisigSeedHex();
          const restoredPage = await context.newPage();
          await initializeAppTestSettings(restoredPage);
          const restoredWallet = await restoreMultisigWalletOnPage(
            restoredPage,
            `restored-${threshold}-of-${members}-${Date.now()}`,
            multisigSeedHex,
          );
          await restoredWallet.waitForMultisigReady(threshold, members);
          expect(await restoredWallet.getPrimaryAddress()).toBe(
            originalAddress,
          );
          await multisigWallets[0].closePage();
          multisigWallets[0] = restoredWallet;
        });

        const multisigAddress = await multisigWallets[0].getPrimaryAddress();
        expect(multisigAddress.length).toBeGreaterThan(20);
        await generateBlocks(multisigAddress, INITIAL_MINED_BLOCKS);
        await waitForWalletsAtExactSyncedHeight(
          multisigWallets,
          INITIAL_MINED_BLOCKS + 1,
        );
        await assertAllWalletsHavePartialKeyImages(multisigWallets);
        await synchronizeMultisigParticipantData(
          multisigWallets.slice(0, threshold),
        );
        const multisigUnlocked =
          await multisigWallets[0].waitForUnlockedBalanceAtLeast(
            MIN_EXPECTED_UNLOCKED_BALANCE,
            300_000,
          );
        expect(multisigUnlocked).toBeGreaterThanOrEqual(
          MIN_EXPECTED_UNLOCKED_BALANCE,
        );
      });

      let recipientWallet: WalletMainPage;
      let recipientAddress = "";
      await test.step("Create recipient wallet", async () => {
        const recipientPage = await context.newPage();
        await initializeAppTestSettings(recipientPage);
        recipientWallet = await createWalletOnPage(
          recipientPage,
          `recipient-${threshold}-of-${members}-${Date.now()}`,
        );
        recipientAddress = await recipientWallet.getPrimaryAddress();
        expect(recipientAddress.length).toBeGreaterThan(20);
      });

      let integratedRecipientWallet: WalletMainPage;
      await test.step("Restore integrated recipient wallet", async () => {
        const integratedRecipientPage = await context.newPage();
        await initializeAppTestSettings(integratedRecipientPage);
        const integratedRecipientInitial = new InitialWalletListPage(
          integratedRecipientPage,
        );
        const integratedRecipientName = `integrated-recipient-${threshold}-of-${members}-${Date.now()}`;

        await integratedRecipientInitial.goto();
        await integratedRecipientInitial.waitUntilLoaded();
        await integratedRecipientInitial.openRestoreWallet();
        integratedRecipientWallet =
          await integratedRecipientInitial.restoreWalletFromKeys({
            walletName: integratedRecipientName,
            address: INTEGRATED_RECIPIENT_ADDRESS,
            secretViewKey: INTEGRATED_RECIPIENT_PRIVATE_VIEW_KEY,
            secretSpendKey: INTEGRATED_RECIPIENT_PRIVATE_SPEND_KEY,
            startingHeight: "0",
          });
        expect(await integratedRecipientWallet.getPrimaryAddress()).toBe(
          INTEGRATED_RECIPIENT_ADDRESS,
        );
      });

      await test.step("Create, sign, and send multisig transaction", async () => {
        await createSignAndSendMultisigTransaction({
          multisigWallets,
          threshold,
          destinationAddress: recipientAddress,
          amountXmr: TRANSFER_AMOUNT_XMR,
        });
      });

      await test.step("Verify regular pending and mempool statuses", async () => {
        const pendingCount =
          await multisigWallets[0].waitForPaymentTypeCountAtLeast("pending", 1);
        expect(pendingCount).toBeGreaterThan(0);
        const mempoolCount =
          await recipientWallet.waitForPaymentTypeCountAtLeast("mempool", 1);
        expect(mempoolCount).toBeGreaterThan(0);
      });

      await test.step("Create, sign, and send integrated-address multisig transaction", async () => {
        await createSignAndSendMultisigTransaction({
          multisigWallets,
          threshold,
          destinationAddress: INTEGRATED_RECIPIENT_INTEGRATED_ADDRESS,
          amountXmr: INTEGRATED_TRANSFER_AMOUNT_XMR,
        });
      });

      await test.step("Verify integrated pending transaction amount", async () => {
        const pendingCount =
          await multisigWallets[0].waitForPaymentTypeCountAtLeast("pending", 2);
        expect(pendingCount).toBeGreaterThanOrEqual(2);
        const mempoolCount =
          await integratedRecipientWallet.waitForPaymentTypeCountAtLeast(
            "mempool",
            1,
          );
        expect(mempoolCount).toBeGreaterThan(0);
        await integratedRecipientWallet.expectLatestTransactionAmount(
          "Mempool In",
          INTEGRATED_TRANSFER_AMOUNT_XMR,
          "+",
        );
      });

      await test.step("Mine unlock blocks and verify recipient unlocked balances", async () => {
        await generateBlocks(MONERO_MINING_ADDRESS, POST_SEND_MINED_BLOCKS);
        const multisigOutgoingCount =
          await multisigWallets[0].waitForPaymentTypeCountAtLeast("out", 2);
        expect(multisigOutgoingCount).toBeGreaterThanOrEqual(2);
        const recipientUnlocked =
          await recipientWallet.waitForUnlockedBalanceAtLeast(
            MIN_EXPECTED_UNLOCKED_BALANCE,
            300_000,
          );
        expect(recipientUnlocked).toBeGreaterThanOrEqual(
          MIN_EXPECTED_UNLOCKED_BALANCE,
        );
        const integratedRecipientUnlocked =
          await integratedRecipientWallet.waitForUnlockedBalanceAtLeast(
            MIN_EXPECTED_INTEGRATED_UNLOCKED_BALANCE,
            300_000,
          );
        expect(integratedRecipientUnlocked).toBeGreaterThanOrEqual(
          MIN_EXPECTED_INTEGRATED_UNLOCKED_BALANCE,
        );
        await integratedRecipientWallet.expectLatestTransactionAmount(
          "Incoming",
          INTEGRATED_TRANSFER_AMOUNT_XMR,
          "+",
        );
      });
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
    await test.step(`Create participant wallet [${i + 1}/${params.members}]`, async () => {
      const walletPage = i === 0 ? params.page : await params.context.newPage();
      await initializeAppTestSettings(walletPage);
      const wallet = await createWalletOnPage(
        walletPage,
        `${params.walletNamePrefix}-member-${i + 1}-${Date.now()}`,
      );
      wallets.push(wallet);
    });
  }
  return wallets;
}

async function createWalletOnPage(
  page: Page,
  walletName: string,
): Promise<WalletMainPage> {
  const initial = new InitialWalletListPage(page);
  await initial.goto();
  await initial.waitUntilLoaded();
  await initial.openCreateWallet();
  return initial.createNewWallet({ walletName });
}

async function restoreMultisigWalletOnPage(
  page: Page,
  walletName: string,
  multisigSeedHex: string,
): Promise<WalletMainPage> {
  const initial = new InitialWalletListPage(page);
  await initial.goto();
  await initial.waitUntilLoaded();
  await initial.openRestoreWallet();
  return initial.restoreWallet({
    walletName,
    seed: multisigSeedHex,
    seedType: "multisig",
    startingHeight: "0",
  });
}

async function createSignAndSendMultisigTransaction(params: {
  multisigWallets: WalletMainPage[];
  threshold: number;
  destinationAddress: string;
  amountXmr: string;
}): Promise<void> {
  let partialData =
    await params.multisigWallets[0].createMultisigTransactionAndExport(
      params.destinationAddress,
      params.amountXmr,
    );
  for (let signer = 1; signer < params.threshold; signer++) {
    await test.step(`Signer [${signer + 1}/${params.threshold}] sign pass`, async () => {
      const result: MultisigSignResult =
        await params.multisigWallets[signer].signMultisigTransactionAndContinue(
          partialData,
        );
      if (signer < params.threshold - 1) {
        if (result.sent) {
          throw new Error(
            `Signer ${signer + 1} unexpectedly finalized transaction early`,
          );
        }
        partialData = result.exportedData;
      } else if (!result.sent) {
        throw new Error(
          `Final signer ${signer + 1} did not finalize multisig transaction`,
        );
      }
    });
  }
}

async function synchronizeMultisigParticipantData(
  wallets: WalletMainPage[],
): Promise<void> {
  const exportedData: Uint8Array[] = [];
  for (let i = 0; i < wallets.length; i++) {
    await test.step(`Export multisig data wallet [${i + 1}/${wallets.length}]`, async () => {
      const data = await wallets[i].exportLatestMultisigData();
      exportedData.push(data);
    });
  }

  for (let i = 0; i < wallets.length; i++) {
    await test.step(`Import participant data wallet [${i + 1}/${wallets.length}]`, async () => {
      const dataFromOthers = exportedData.filter(
        (_, dataIndex) => dataIndex !== i,
      );
      await wallets[i].importParticipantMultisigData(dataFromOthers);
    });
  }

  const warnings: boolean[] = [];
  for (let i = 0; i < wallets.length; i++) {
    await test.step(`Check partial key images warning wallet [${i + 1}/${wallets.length}]`, async () => {
      const warning = await wallets[i].hasPartialKeyImagesWarning();
      warnings.push(warning);
    });
  }
  if (warnings.some(Boolean)) {
    throw new Error(
      "Multisig wallets still report partial key images after one synchronization pass",
    );
  }
}

async function assertAllWalletsHavePartialKeyImages(
  wallets: WalletMainPage[],
): Promise<void> {
  const warnings: boolean[] = [];
  for (let i = 0; i < wallets.length; i++) {
    await test.step(`Assert partial key images present wallet [${i + 1}/${wallets.length}]`, async () => {
      const warning = await wallets[i].hasPartialKeyImagesWarning();
      warnings.push(warning);
    });
  }
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
  for (let i = 0; i < wallets.length; i++) {
    await test.step(`Wait exact synced height ${expectedHeight} wallet [${i + 1}/${wallets.length}]`, async () => {
      await wallets[i].waitForExactSyncedHeight(expectedHeight);
    });
  }
}
