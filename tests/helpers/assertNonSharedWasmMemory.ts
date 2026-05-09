import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Guard that the Playwright Chromium context matches how we link the wallet wasm:
 * no pthread shared heap (`SHARED_MEMORY`). RPC uses synchronous XHR in the
 * dedicated wallet worker (`http.hpp`), not Asyncify — and that worker does not
 * require cross-origin isolation or `SharedArrayBuffer` for Wasm linear memory.
 *
 * Uses a standalone `WebAssembly.Memory` probe in the **page** realm (same WASM
 * engine as workers). If browsers ever defaulted non-shared Memories to shared
 * buffers when COI is on, this would fail visibly.
 */
export async function assertNonSharedWasmBaseline(page: Page): Promise<void> {
  await page.goto("about:blank");
  const memoryBackedBySab = await page.evaluate(() => {
    try {
      const m = new WebAssembly.Memory({ initial: 16 });
      return (
        typeof SharedArrayBuffer !== "undefined" &&
        m.buffer instanceof SharedArrayBuffer
      );
    } catch {
      return false;
    }
  });
  expect(
    memoryBackedBySab,
    "expected default WebAssembly.Memory not to use SharedArrayBuffer-backed heap (wallet build has no SHARED_MEMORY pthreads link)",
  ).toBe(false);
}
