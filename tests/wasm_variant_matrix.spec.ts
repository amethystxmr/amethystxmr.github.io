import { expect, test, type Page } from "@playwright/test";
import {
  FROM_KEYS_TEST_ADDRESS,
  MONERO_MINING_ADDRESS,
  MONERO_RESTORE_SEED,
} from "./constants";
import { callMoneroJsonRpc, generateBlocks } from "./helpers/moneroRpc";
import { initializeAppTestSettings } from "./helpers/testSettings";
import {
  expectPageIsolationMatchesMatrixExpectedVariant,
  expectPageIsolationForWasmVariant,
  expectPageServiceWorkerStateMatchesMatrix,
  expectPlaywrightServiceWorkerPolicyMatchesMatrix,
  expectPreviewServerCoiHeadersMatchMatrix,
  getVariantMatrixExpectations,
} from "./helpers/variantMatrixExpectations";
import { InitialWalletListPage } from "./pages/initial-wallet-list.page";
import { WalletMainPage } from "./pages/wallet-main.page";

const INITIAL_MINED_BLOCKS = 80;
const XMR_ATOMIC_UNITS_PER_XMR = 1_000_000_000_000n;
const MIN_FUNDED_BALANCE = 10n * XMR_ATOMIC_UNITS_PER_XMR;
const SERVICE_WORKER_BOOTSTRAP_PROJECT = "variant-no-headers-sw";

async function openOptionsAndExpectWasmVariant(
  page: Page,
  initial: InitialWalletListPage,
  expectedWasmVariant: "asyncify" | "threads",
) {
  await initial.expectLoaded();
  await page.getByRole("button", { name: /options/i }).click();
  const buildInfo = page.locator('[aria-label="Build information"]');
  await expect(buildInfo).toBeVisible();
  await expect(buildInfo).toContainText(expectedWasmVariant);
}

async function mockServiceWorkerRegistrationFailure(page: {
  addInitScript: Page["addInitScript"];
}) {
  await page.addInitScript(() => {
    const fakeServiceWorkerContainer = {
      controller: null,
      ready: new Promise<ServiceWorkerRegistration>(() => {}),
      addEventListener() {},
      removeEventListener() {},
      getRegistration: async () => null,
      getRegistrations: async () => [],
      register: async () => {
        sessionStorage.setItem("mock-sw-register-count", "1");
        throw new Error("mock service worker registration failure");
      },
    };

    Object.defineProperty(Navigator.prototype, "serviceWorker", {
      configurable: true,
      get() {
        return fakeServiceWorkerContainer;
      },
    });
  });
}

async function expectNoRegisteredServiceWorker(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration?.active?.scriptURL ?? null;
      }),
    )
    .toBeNull();
}

async function mockServiceWorkerRegistrationTimeout(page: {
  addInitScript: Page["addInitScript"];
}) {
  await page.addInitScript(() => {
    const registration = {
      active: null,
      waiting: null,
      installing: null,
      addEventListener() {},
      removeEventListener() {},
    };
    const fakeServiceWorkerContainer = {
      controller: null,
      ready: new Promise<ServiceWorkerRegistration>(() => {}),
      addEventListener() {},
      removeEventListener() {},
      getRegistration: async () => null,
      getRegistrations: async () => [],
      register: async () => {
        const current = Number(
          sessionStorage.getItem("mock-sw-register-count") ?? "0",
        );
        sessionStorage.setItem("mock-sw-register-count", String(current + 1));
        return registration;
      },
    };

    Object.defineProperty(Navigator.prototype, "serviceWorker", {
      configurable: true,
      get() {
        return fakeServiceWorkerContainer;
      },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await initializeAppTestSettings(page);
});

test("loads expected WASM variant and restores funded wallet", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(600_000);

  const expectations = getVariantMatrixExpectations(testInfo.project.name);
  const initial = new InitialWalletListPage(page);
  const walletName = `variant-${expectations.expectedWasmVariant}-${Date.now()}`;
  let restoreStartingHeight = "0";

  await test.step("Mine initial blocks for restored wallet", async () => {
    const info = await callMoneroJsonRpc<{ height: number }>("get_info", {});
    restoreStartingHeight = Math.max(0, info.height - 1).toString();
    await generateBlocks(MONERO_MINING_ADDRESS, INITIAL_MINED_BLOCKS);
  });

  await test.step("Playwright project matches matrix configuration", async () => {
    expectPlaywrightServiceWorkerPolicyMatchesMatrix(
      testInfo.project.use.serviceWorkers,
      expectations,
    );
  });

  await test.step("Preview server COI headers match matrix configuration", async () => {
    await expectPreviewServerCoiHeadersMatchMatrix(request, expectations);
  });

  await test.step("Load page with expected isolation state", async () => {
    await initial.goto();
    await initial.waitUntilLoaded();

    await expectPageIsolationMatchesMatrixExpectedVariant(page, expectations);
    await expectPageServiceWorkerStateMatchesMatrix(page, expectations);
  });

  await test.step("Restore funded wallet", async () => {
    await initial.openRestoreWallet();
    const wallet = await initial.restoreWallet({
      walletName,
      seed: MONERO_RESTORE_SEED,
      startingHeight: restoreStartingHeight,
    });
    expect(await wallet.getPrimaryAddress()).toBe(FROM_KEYS_TEST_ADDRESS);

    await wallet.waitForUnlockedBalanceAtLeast(MIN_FUNDED_BALANCE);
  });

  await test.step("Reload and reopen restored wallet", async () => {
    await page.reload();
    const wallet = new WalletMainPage(page);
    await wallet.waitUntilLoaded();
    expect(await wallet.getPrimaryAddress()).toBe(FROM_KEYS_TEST_ADDRESS);
    await expectPageIsolationMatchesMatrixExpectedVariant(page, expectations);
    await expectPageServiceWorkerStateMatchesMatrix(page, expectations);
    await wallet.exitFromWallet();
  });

  await test.step("Options view shows expected WASM variant", async () => {
    await openOptionsAndExpectWasmVariant(
      page,
      initial,
      expectations.expectedWasmVariant,
    );
  });
});

test("service worker registration success loads threads without server COI headers", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== SERVICE_WORKER_BOOTSTRAP_PROJECT,
    "Covers the no-server-COI service-worker bootstrap project only.",
  );

  const expectations = getVariantMatrixExpectations(testInfo.project.name);
  const initial = new InitialWalletListPage(page);

  expectPlaywrightServiceWorkerPolicyMatchesMatrix(
    testInfo.project.use.serviceWorkers,
    expectations,
  );
  await expectPreviewServerCoiHeadersMatchMatrix(request, expectations);

  await initial.goto();
  await initial.waitUntilLoaded();

  await expectPageIsolationForWasmVariant(page, "threads");
  await expectPageServiceWorkerStateMatchesMatrix(page, expectations);
  await openOptionsAndExpectWasmVariant(page, initial, "threads");
});

test("service worker registration failure falls back to asyncify", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== SERVICE_WORKER_BOOTSTRAP_PROJECT,
    "Covers the no-server-COI service-worker bootstrap project only.",
  );

  const expectations = getVariantMatrixExpectations(testInfo.project.name);
  const initial = new InitialWalletListPage(page);

  await mockServiceWorkerRegistrationFailure(page);

  expectPlaywrightServiceWorkerPolicyMatchesMatrix(
    testInfo.project.use.serviceWorkers,
    expectations,
  );
  await expectPreviewServerCoiHeadersMatchMatrix(request, expectations);

  await initial.goto();
  await initial.waitUntilLoaded();

  await expectPageIsolationForWasmVariant(page, "asyncify");
  await expectNoRegisteredServiceWorker(page);
  await expect(
    page.evaluate(() => sessionStorage.getItem("mock-sw-register-count")),
  ).resolves.toBe("1");
  await expect(
    page.evaluate(() =>
      sessionStorage.getItem("amethystxmr:service-worker-reload-for-control"),
    ),
  ).resolves.toBeNull();
  await openOptionsAndExpectWasmVariant(page, initial, "asyncify");
});

test("service worker control timeout reloads once then falls back to asyncify", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== SERVICE_WORKER_BOOTSTRAP_PROJECT,
    "Covers the no-server-COI service-worker bootstrap project only.",
  );

  const expectations = getVariantMatrixExpectations(testInfo.project.name);
  const initial = new InitialWalletListPage(page);

  await mockServiceWorkerRegistrationTimeout(page);

  expectPlaywrightServiceWorkerPolicyMatchesMatrix(
    testInfo.project.use.serviceWorkers,
    expectations,
  );
  await expectPreviewServerCoiHeadersMatchMatrix(request, expectations);

  await initial.goto();
  await initial.waitUntilLoaded();

  await expectPageIsolationForWasmVariant(page, "asyncify");
  await expectNoRegisteredServiceWorker(page);
  await expect(
    page.evaluate(() => sessionStorage.getItem("mock-sw-register-count")),
  ).resolves.toBe("2");
  await expect(
    page.evaluate(() =>
      sessionStorage.getItem("amethystxmr:service-worker-reload-for-control"),
    ),
  ).resolves.toMatch(/service-worker\.js$/);
  await openOptionsAndExpectWasmVariant(page, initial, "asyncify");
});

test("options enforces asyncify build via triple-click and restores threads", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== SERVICE_WORKER_BOOTSTRAP_PROJECT,
    "Covers the no-server-COI service-worker bootstrap project only.",
  );

  const expectations = getVariantMatrixExpectations(testInfo.project.name);
  const initial = new InitialWalletListPage(page);
  const buildInfo = page.locator('[aria-label="Build information"]');

  await expectPreviewServerCoiHeadersMatchMatrix(request, expectations);

  await initial.goto();
  await initial.waitUntilLoaded();
  await expectPageIsolationForWasmVariant(page, "threads");

  await test.step("Triple-click threads to enforce the Asyncify build", async () => {
    await page.getByRole("button", { name: /options/i }).click();
    await expect(buildInfo).toContainText("threads");
    const threadsLabel = buildInfo.getByText("threads", { exact: true });
    await threadsLabel.click();
    await threadsLabel.click();
    await threadsLabel.click();
    await page.getByRole("button", { name: "Switch" }).click();
  });

  await test.step("Reloads into the enforced Asyncify build shown in red", async () => {
    await initial.waitUntilLoaded();
    await page.getByRole("button", { name: /options/i }).click();
    await expect(buildInfo).toContainText("asyncify");
    await expect(buildInfo.getByText("asyncify", { exact: true })).toHaveClass(
      /text-red/,
    );
    await expect(
      page.evaluate(() =>
        localStorage.getItem("amethystxmr:force-asyncify-build"),
      ),
    ).resolves.toBe("1");
  });

  await test.step("Switches back to the Threads build", async () => {
    await buildInfo.getByText("asyncify", { exact: true }).click();
    await page.getByRole("button", { name: "Switch" }).click();
    await initial.waitUntilLoaded();
    await expectPageIsolationForWasmVariant(page, "threads");
    await page.getByRole("button", { name: /options/i }).click();
    await expect(buildInfo).toContainText("threads");
    await expect(
      page.evaluate(() =>
        localStorage.getItem("amethystxmr:force-asyncify-build"),
      ),
    ).resolves.toBeNull();
  });
});
