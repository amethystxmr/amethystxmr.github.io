import { expect, test } from "./fixtures/e2eTest";
import {
  FROM_KEYS_TEST_ADDRESS,
  FROM_KEYS_TEST_PRIVATE_SPEND_KEY,
  FROM_KEYS_TEST_PRIVATE_VIEW_KEY,
  MONERO_MINING_ADDRESS,
} from "./constants";
import { generateBlocks } from "./helpers/moneroRpc";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";

const MINED_BLOCKS = 30;

function todayUtcIsoDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("restore wallet using date-based starting height picker", async ({
  page,
}) => {
  test.setTimeout(300_000);

  await generateBlocks(MONERO_MINING_ADDRESS, MINED_BLOCKS);
  const restoreDate = todayUtcIsoDate();

  const initial = new InitialWalletListPage(page);
  await initial.goto();
  await initial.waitUntilLoaded();
  await initial.openRestoreWallet();

  const wallet = await initial.restoreWalletFromKeys({
    walletName: `restore-date-height-${Date.now()}`,
    address: FROM_KEYS_TEST_ADDRESS,
    secretViewKey: FROM_KEYS_TEST_PRIVATE_VIEW_KEY,
    secretSpendKey: FROM_KEYS_TEST_PRIVATE_SPEND_KEY,
    startingHeightDate: restoreDate,
  });

  expect(initial.lastResolvedStartingHeight).not.toBeNull();
  const resolvedHeight = Number(initial.lastResolvedStartingHeight);
  expect(resolvedHeight).toBeGreaterThanOrEqual(0);

  await wallet.expectSpendableWallet();
  expect(await wallet.getPrimaryAddress()).toBe(FROM_KEYS_TEST_ADDRESS);
});
