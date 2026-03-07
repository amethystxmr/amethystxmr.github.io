import type { Page } from "@playwright/test";
import { MONEROD_RPC_URL } from "../constants";

const FAKENET_NETWORK_TYPE = 3;

export async function initializeAppTestSettings(page: Page): Promise<void> {
  await page.addInitScript(
    ({ daemonAddress, networkType }) => {
      localStorage.setItem(
        "options",
        JSON.stringify({
          loadLastWallet: false,
          daemonAddress,
          networkType,
        }),
      );
    },
    {
      daemonAddress: MONEROD_RPC_URL,
      networkType: FAKENET_NETWORK_TYPE,
    },
  );
}
