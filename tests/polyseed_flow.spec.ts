import { expect, test } from "@playwright/test";
import { MONERO_MINING_ADDRESS } from "./constants";
import { generateBlocks } from "./helpers/moneroRpc";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";

// Source: https://github.com/MrCyjaneK/polyseed/blob/bd79f5014c331273357277ed8a3d756fb61b9fa1/tests/tests.c#L42-L44
// Normalized: raven tail swear infant grief assist regular lamp duck valid someone little harsh puppy airport language
const POLYSEED_RESTORE_SEED_DISTURBED = `
  raven  tail swear
  infant grief assist   regular lamp duck valid
someone little harsh puppy airport language   
`;
const POLYSEED_RESTORE_ADDRESS =
  "47AjPj7DVPQVGGXJXbbTMZWcKQDejGHYZChVkeujy8qPLjKkgdsxge4DzvkRMgU4sDUigGLuBN9stKBMowhuXH2HJHWAuRf";

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("restore wallet from Cake 16-word polyseed", async ({ page }) => {
  test.setTimeout(300_000);

  await generateBlocks(MONERO_MINING_ADDRESS, 1);

  const initial = new InitialWalletListPage(page);
  await initial.goto();
  await initial.waitUntilLoaded();
  await initial.openRestoreWallet();

  const wallet = await initial.restoreWallet({
    walletName: `polyseed-restore-${Date.now()}`,
    seed: POLYSEED_RESTORE_SEED_DISTURBED,
    seedType: "cake-16",
  });

  const address = await wallet.getPrimaryAddress();
  expect(address).toBe(POLYSEED_RESTORE_ADDRESS);
});
