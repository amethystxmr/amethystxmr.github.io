import type { Page } from "@playwright/test";
import { MONEROD_RPC_URL } from "../constants";
import { NetworkTypes } from "../../monero-wasm-module/monero-wasm-wallet";

const MAINNET_NETWORK_TYPE = NetworkTypes.MAINNET;

export async function initializeAppTestSettings(page: Page): Promise<void> {
  await page.addInitScript(
    ({ daemonAddress, networkType }) => {
      localStorage.setItem(
        "options",
        JSON.stringify({
          loadLastWallet: false,
          daemonAddress,
          networkType,
          allowMismatchedDaemonVersion: true,
        }),
      );
    },
    {
      daemonAddress: MONEROD_RPC_URL,
      networkType: MAINNET_NETWORK_TYPE,
    },
  );
}
