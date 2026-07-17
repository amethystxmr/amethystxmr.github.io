import type { WasmBuildVariant } from "../../monero-wasm-module/walletApi";

const FORCE_ASYNCIFY_STORAGE_KEY = "amethystxmr:force-asyncify-build";

/** User override that pins the wallet to the Asyncify build regardless of browser isolation. */
export function isAsyncifyBuildForced(): boolean {
  try {
    return localStorage.getItem(FORCE_ASYNCIFY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAsyncifyBuildForced(forced: boolean): void {
  try {
    if (forced) {
      localStorage.setItem(FORCE_ASYNCIFY_STORAGE_KEY, "1");
    } else {
      localStorage.removeItem(FORCE_ASYNCIFY_STORAGE_KEY);
    }
  } catch {
    // Best effort only; a failed write just keeps the current variant.
  }
}

/**
 * Picks the WASM build variant for this session: the Threads build needs a
 * cross-origin isolated context (SharedArrayBuffer), otherwise fall back to
 * Asyncify. The user override always pins Asyncify.
 */
export function selectWasmBuildVariant(): WasmBuildVariant {
  if (isAsyncifyBuildForced()) {
    return "asyncify";
  }
  return globalThis.crossOriginIsolated &&
    typeof SharedArrayBuffer === "function"
    ? "threads"
    : "asyncify";
}
