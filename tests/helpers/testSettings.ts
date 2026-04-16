import type { Page } from "@playwright/test";
import { MONEROD_RPC_URL } from "../constants";
import { NetworkTypes } from "../../monero-wasm-module/monero-wasm-wallet";

// monerod in tests is started with `--regtest`, which runs a FAKECHAIN core
// (see cryptonote_core.cpp: regtest forces m_nettype = FAKECHAIN). The wallet
// must use the same network type or daemon RPC / sync can fail or stall.
const REGTEST_NETWORK_TYPE = NetworkTypes.FAKECHAIN;

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
      networkType: REGTEST_NETWORK_TYPE,
    },
  );
}
