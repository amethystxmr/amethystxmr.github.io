import type { WasmBuildVariant } from "../../monero-wasm-module/walletApi";
import {
  isWasmThreadingAvailableForCurrentPage,
  isWasmThreadingDisabledByUser,
} from "./wasmConcurrency";

/**
 * Picks the WASM build variant for this session: the Threads build needs a
 * cross-origin isolated context (SharedArrayBuffer), otherwise fall back to
 * Asyncify. The user's "No threading" setting always pins Asyncify.
 */
export function selectWasmBuildVariant(): WasmBuildVariant {
  if (isWasmThreadingDisabledByUser()) {
    return "asyncify";
  }
  return isWasmThreadingAvailableForCurrentPage() ? "threads" : "asyncify";
}
