import type { Page } from "@playwright/test";
import { MONEROD_RPC_URL } from "../constants";
import { NetworkType } from "../../monero-wasm-module/walletApi";

const MAINNET_NETWORK_TYPE = NetworkType.MAINNET;

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
