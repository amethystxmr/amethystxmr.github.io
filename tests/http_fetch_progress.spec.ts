import { test, expect, type Page } from "@playwright/test";
import {
  FROM_KEYS_TEST_ADDRESS,
  MONERO_MINING_ADDRESS,
  MONERO_RESTORE_SEED,
} from "./constants";
import { generateBlocks } from "./helpers/moneroRpc";
import { initializeAppTestSettings } from "./helpers/testSettings";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";

/**
 * Large enough that /getblocks.bin responses (~180KB batches) produce intermediate
 * XHR `progress` events (0 < loaded < total), so the download ProgressBar can move.
 * ~400 empty-ish regtest blocks only yielded final 100% progress ticks.
 */
const INITIAL_MINED_BLOCKS = 1500;

type HttpFetchEvent = {
  text: string;
  state: string;
  loaded: number;
  total: number;
};

function parseHttpConsoleText(text: string): HttpFetchEvent | null {
  // Example: [HTTP] /getblocks.bin: progress (3768/180156), id=…
  // Logged from main.tsx setHttpFetchCallback (used by this e2e assertion).
  const match = text.match(
    /^\[HTTP\]\s+.+:\s+(\w+)\s+\((\d+)\/(\d+)\),\s+id=\S+/,
  );
  if (!match) {
    return null;
  }
  return {
    text,
    state: match[1],
    loaded: Number(match[2]),
    total: Number(match[3]),
  };
}

function collectHttpFetchEvents(page: Page): HttpFetchEvent[] {
  const events: HttpFetchEvent[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "info") {
      return;
    }
    const text = msg.text();
    if (!text.includes("[HTTP]")) {
      return;
    }
    const parsed = parseHttpConsoleText(text);
    if (parsed) {
      events.push(parsed);
    }
  });
  return events;
}

function isIntermediateProgress(event: HttpFetchEvent): boolean {
  return (
    event.state === "progress" &&
    event.total > 0 &&
    event.loaded > 0 &&
    event.loaded < event.total
  );
}

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("http fetch progress reports intermediate download progress", async ({
  page,
}) => {
  test.setTimeout(600_000);

  const events = collectHttpFetchEvents(page);

  await test.step(`Mine ${INITIAL_MINED_BLOCKS} blocks`, async () => {
    await generateBlocks(MONERO_MINING_ADDRESS, INITIAL_MINED_BLOCKS);
  });

  await test.step("Restore wallet and wait until fully synced", async () => {
    const initial = new InitialWalletListPage(page);
    await initial.goto();
    await initial.waitUntilLoaded();
    await initial.openRestoreWallet();
    const wallet = await initial.restoreWallet({
      walletName: `http-progress-${Date.now()}`,
      seed: MONERO_RESTORE_SEED,
      startingHeight: "0",
    });
    expect(await wallet.getPrimaryAddress()).toBe(FROM_KEYS_TEST_ADDRESS);
    await wallet.waitForPaymentTypeCountAtLeast("block", 1);
    // Fresh regtest: genesis + mined blocks (same as multisig_flow).
    await wallet.waitForExactSyncedHeight(INITIAL_MINED_BLOCKS + 1, 300_000);
  });

  await test.step("Assert intermediate HTTP progress events were received", async () => {
    console.log(`[http-fetch-progress] ${events.length} HTTP events:`);
    for (const event of events) {
      console.log(`[http-fetch-progress] ${event.text}`);
    }

    const intermediate = events.filter(isIntermediateProgress);
    expect(
      intermediate.length,
      [
        "Expected at least one intermediate [HTTP] progress event (0 < loaded < total)",
        `so the download ProgressBar can move. Saw ${events.length} HTTP events:`,
        ...events.map((event) => `  ${event.text}`),
      ].join("\n"),
    ).toBeGreaterThan(0);
  });
});
