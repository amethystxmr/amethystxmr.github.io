import { expect, test, type Locator, type Page } from "@playwright/test";
import { WalletMainPage } from "./wallet-main.page";

export class InitialWalletListPage {
  constructor(private readonly page: Page) {
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop !== "string" || typeof value !== "function" || prop === "constructor") {
          return value;
        }
        return (...args: unknown[]) =>
          test.step(`${target.constructor.name}.${prop}`, async () => value.apply(target, args));
      },
    }) as this;
  }

  private readonly restoreButtonName = /^(?:↺\s*)?Restore$/i;

  private walletNameInput(): Locator {
    return this.page
      .locator("div")
      .filter({ hasText: /^Wallet name$/ })
      .locator("input")
      .first();
  }

  async goto(): Promise<void> {
    await this.page.goto("/");
  }

  /** Main wallet list shell is visible (Restore button, same readiness as {@link waitUntilLoaded}). */
  async expectLoaded(): Promise<void> {
    await expect(
      this.page.getByRole("button", { name: this.restoreButtonName }),
    ).toBeVisible();
  }

  async waitUntilLoaded(): Promise<void> {
    await this.expectLoaded();
  }

  async openRestoreWallet(): Promise<void> {
    await this.page.getByRole("button", { name: this.restoreButtonName }).click();
    await expect(
      this.page.getByRole("heading", { name: /restore wallet/i }),
    ).toBeVisible();
  }

  async openCreateWallet(): Promise<void> {
    await this.page.getByRole("button", { name: /new wallet/i }).click();
    await expect(
      this.page.getByRole("heading", { name: /create new wallet/i }),
    ).toBeVisible();
  }

  async fillCreateWalletName(walletName: string): Promise<void> {
    await this.walletNameInput().fill(walletName);
  }

  async submitCreateWalletForm(): Promise<void> {
    await this.page.getByRole("button", { name: /create wallet/i }).click();
  }

  async cancelCreateOrRestore(): Promise<void> {
    await this.page.getByRole("button", { name: /^✖ Cancel$/ }).click();
  }

  async openManageWallets(): Promise<void> {
    await this.page.getByRole("button", { name: /manage wallets/i }).click();
  }

  async expectMainHomeVisible(): Promise<void> {
    await expect(
      this.page.getByRole("heading", { name: /amethyst xmr wallet/i }),
    ).toBeVisible();
  }

  async openWalletFromList(walletName: string): Promise<void> {
    await this.page.getByRole("button", { name: walletName }).click();
  }

  async expectWalletNotOnList(walletName: string): Promise<void> {
    await expect(this.page.getByRole("button", { name: walletName })).toHaveCount(0);
  }

  async restoreWallet(params: {
    walletName: string;
    seed: string;
    seedType?: "monero-25" | "cake-16";
    startingHeight?: string;
  }): Promise<WalletMainPage> {
    const seedType = params.seedType ?? "monero-25";

    await this.walletNameInput().fill(params.walletName);
    if (seedType === "cake-16") {
      await this.page.getByRole("tab", { name: /cake 16 words/i }).click();
    }
    await this.page
      .locator("div")
      .filter({ hasText: /^Seed phrase/ })
      .locator("textarea")
      .first()
      .fill(params.seed);
    if (seedType === "monero-25") {
      const startingHeightInput = this.page
        .locator("div")
        .filter({ hasText: /^Starting height/ })
        .locator("input")
        .first();
      await startingHeightInput.fill(params.startingHeight ?? "0");
      await expect(startingHeightInput).toHaveValue(
        params.startingHeight ?? "0",
      );
    }

    await this.page.getByRole("button", { name: /restore wallet/i }).click();

    const walletMainPage = new WalletMainPage(this.page);
    await walletMainPage.waitUntilLoaded();
    return walletMainPage;
  }

  async fillRestoreWalletName(walletName: string): Promise<void> {
    await this.walletNameInput().fill(walletName);
  }

  async submitRestoreWalletForm(): Promise<void> {
    await this.page.getByRole("button", { name: /restore wallet/i }).click();
  }

  async createNewWallet(params: { walletName: string }): Promise<WalletMainPage> {
    await this.walletNameInput().fill(params.walletName);
    await this.page.getByRole("button", { name: /create wallet/i }).click();
    await this.page.getByRole("button", { name: /open wallet/i }).click();

    const walletMainPage = new WalletMainPage(this.page);
    await walletMainPage.waitUntilLoaded();
    return walletMainPage;
  }
}
