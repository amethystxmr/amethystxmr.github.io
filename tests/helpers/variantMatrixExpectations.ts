import { expect, type APIRequestContext, type Page } from "@playwright/test";

export type VariantMatrixProjectName =
  | "variant-no-headers-no-sw"
  | "variant-headers-no-sw"
  | "variant-no-headers-sw"
  | "variant-headers-sw";

export type VariantMatrixExpectations = {
  hasServerCoiHeaders: boolean;
  allowsServiceWorkers: boolean;
  expectedVariant: "asyncify" | "threads";
};

function buildVariantMatrixExpectations(
  hasServerCoiHeaders: boolean,
  allowsServiceWorkers: boolean,
): VariantMatrixExpectations {
  return {
    hasServerCoiHeaders,
    allowsServiceWorkers,
    expectedVariant:
      !hasServerCoiHeaders && !allowsServiceWorkers ? "asyncify" : "threads",
  };
}

const VARIANT_MATRIX_EXPECTATIONS: Record<
  VariantMatrixProjectName,
  VariantMatrixExpectations
> = {
  "variant-no-headers-no-sw": buildVariantMatrixExpectations(false, false),
  "variant-headers-no-sw": buildVariantMatrixExpectations(true, false),
  "variant-no-headers-sw": buildVariantMatrixExpectations(false, true),
  "variant-headers-sw": buildVariantMatrixExpectations(true, true),
};

export function getVariantMatrixExpectations(
  projectName: string,
): VariantMatrixExpectations {
  const expectations =
    VARIANT_MATRIX_EXPECTATIONS[projectName as VariantMatrixProjectName];
  if (!expectations) {
    throw new Error(`Unexpected WASM variant matrix project: ${projectName}`);
  }
  return expectations;
}

export function expectPlaywrightProjectMatchesMatrix(
  projectServiceWorkers: "allow" | "block" | undefined,
  expectations: VariantMatrixExpectations,
): void {
  const allowsServiceWorkers = projectServiceWorkers !== "block";
  expect(allowsServiceWorkers).toBe(expectations.allowsServiceWorkers);
}

export async function expectMatrixServerCoiHeaders(
  request: APIRequestContext,
  expectations: VariantMatrixExpectations,
): Promise<void> {
  const response = await request.get("/");
  expect(response.ok()).toBeTruthy();
  const coep = response.headers()["cross-origin-embedder-policy"];
  const coop = response.headers()["cross-origin-opener-policy"];
  if (expectations.hasServerCoiHeaders) {
    expect(coep).toBe("require-corp");
    expect(coop).toBe("same-origin");
  } else {
    expect(coep).toBeUndefined();
    expect(coop).toBeUndefined();
  }
}

export async function expectMatrixServiceWorkers(
  page: Page,
  expectations: VariantMatrixExpectations,
): Promise<void> {
  if (!expectations.allowsServiceWorkers) {
    await expect
      .poll(async () =>
        page.evaluate(
          () => navigator.serviceWorker.controller?.scriptURL ?? null,
        ),
      )
      .toBeNull();
    return;
  }

  if (expectations.hasServerCoiHeaders) {
    // Server COI already enables Threads; production bootstrap skips SW registration.
    await expect
      .poll(async () =>
        page.evaluate(
          () => navigator.serviceWorker.controller?.scriptURL ?? null,
        ),
      )
      .toBeNull();
    return;
  }

  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration?.active?.scriptURL ?? null;
      }),
    )
    .toMatch(/service-worker\.js$/);
}

export async function expectMatrixRuntimeIsolation(
  page: Page,
  expectations: VariantMatrixExpectations,
): Promise<void> {
  await expectMatrixRuntimeVariant(page, expectations.expectedVariant);
}

export async function expectMatrixRuntimeVariant(
  page: Page,
  expectedVariant: "asyncify" | "threads",
): Promise<void> {
  const expectedCrossOriginIsolated = expectedVariant === "threads";
  await expect(page.evaluate(() => window.crossOriginIsolated)).resolves.toBe(
    expectedCrossOriginIsolated,
  );
  if (expectedCrossOriginIsolated) {
    await expect(page.evaluate(() => typeof SharedArrayBuffer)).resolves.toBe(
      "function",
    );
  } else {
    await expect(page.evaluate(() => typeof SharedArrayBuffer)).resolves.toBe(
      "undefined",
    );
  }
}
