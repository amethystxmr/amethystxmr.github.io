import { test as base, expect } from "@playwright/test";
import { verifyMainE2eWasmVariant } from "../helpers/mainE2eWasmVariant";

const VARIANT_MATRIX_SPEC = /wasm_variant_matrix\.spec\.ts$/;

export const test = base.extend({
  _verifyMainE2eWasmVariant: [
    async ({ page }, use, testInfo) => {
      await use();
      if (VARIANT_MATRIX_SPEC.test(testInfo.file)) {
        return;
      }
      if (
        testInfo.project.name !== "chromium-asyncify" &&
        testInfo.project.name !== "chromium-threads"
      ) {
        return;
      }
      await verifyMainE2eWasmVariant(page, testInfo.project.name);
    },
    { auto: true },
  ],
});

export { expect };
export type { BrowserContext, Page } from "@playwright/test";
