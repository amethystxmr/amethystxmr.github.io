import type { Page } from "@playwright/test";
import { MONEROD_RPC_URL } from "../constants";
import { NetworkType } from "../../monero-wasm-module/walletApi";

const FAKECHAIN_NETWORK_TYPE = NetworkType.FAKECHAIN;

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
      networkType: FAKECHAIN_NETWORK_TYPE,
    },
  );
}
