import { expect, test, type Locator, type Page } from "@playwright/test";
import { WalletMainPage } from "./wallet-main.page";

export class InitialWalletListPage {
  lastResolvedStartingHeight: string | null = null;

  constructor(private readonly page: Page) {
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        const value = Reflect.get(target, prop, receiver);
        if (
          typeof prop !== "string" ||
          typeof value !== "function" ||
          prop === "constructor"
        ) {
          return value;
        }
        return (...args: unknown[]) =>
          test.step(`${target.constructor.name}.${prop}`, async () =>
            value.apply(target, args));
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

  private startingHeightSection(): Locator {
    return this.page.locator("div").filter({ hasText: /^Starting height/ });
  }

  private startingHeightInput(): Locator {
    return this.startingHeightSection().locator("input").first();
  }

  private startingHeightDateInput(): Locator {
    return this.startingHeightSection().locator('input[type="date"]').first();
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
    await this.page
      .getByRole("button", { name: this.restoreButtonName })
      .click();
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
    await expect(
      this.page.getByRole("button", { name: walletName }),
    ).toHaveCount(0);
  }

  async pickRestoreStartingHeightDate(isoDate: string): Promise<string> {
    const heightInput = this.startingHeightInput();
    await this.startingHeightDateInput().fill(isoDate);
    await expect(heightInput).not.toHaveValue("Loading...", {
      timeout: 60_000,
    });
    await expect(heightInput).not.toHaveValue("error", { timeout: 60_000 });
    await expect(heightInput).not.toHaveValue("", { timeout: 60_000 });
    const value = await heightInput.inputValue();
    expect(value).toMatch(/^\d+$/);
    this.lastResolvedStartingHeight = value;
    return value;
  }

  async restoreWallet(params: {
    walletName: string;
    seed: string;
    seedType?: "monero-25" | "cake-16" | "multisig";
    startingHeight?: string;
    startingHeightDate?: string;
  }): Promise<WalletMainPage> {
    const seedType = params.seedType ?? "monero-25";

    await this.walletNameInput().fill(params.walletName);
    if (seedType === "cake-16") {
      await this.page.getByRole("tab", { name: /cake 16 words/i }).click();
    } else if (seedType === "multisig") {
      await this.page.getByRole("tab", { name: /multisig/i }).click();
    }
    await this.page
      .locator("div")
      .filter({
        hasText:
          seedType === "multisig" ? /^Multisig seed \(hex\)/ : /^Seed phrase/,
      })
      .locator("textarea")
      .first()
      .fill(params.seed);
    if (seedType === "monero-25" || seedType === "multisig") {
      if (params.startingHeightDate) {
        await this.pickRestoreStartingHeightDate(params.startingHeightDate);
      } else {
        const heightInput = this.startingHeightInput();
        await heightInput.fill(params.startingHeight ?? "0");
        await expect(heightInput).toHaveValue(params.startingHeight ?? "0");
      }
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

  async createNewWallet(params: {
    walletName: string;
  }): Promise<WalletMainPage> {
    await this.walletNameInput().fill(params.walletName);
    await this.page.getByRole("button", { name: /create wallet/i }).click();
    await this.page.getByRole("button", { name: /open wallet/i }).click();

    const walletMainPage = new WalletMainPage(this.page);
    await walletMainPage.waitUntilLoaded();
    return walletMainPage;
  }

  private async fillRestoreFromKeysFields(params: {
    walletName: string;
    address: string;
    secretViewKey: string;
    secretSpendKey?: string;
  }): Promise<void> {
    await this.walletNameInput().fill(params.walletName);
    await this.page.getByRole("tab", { name: /from keys/i }).click();
    await this.page
      .locator("div")
      .filter({ hasText: /^Address$/ })
      .locator("input")
      .first()
      .fill(params.address);
    await this.page
      .locator("div")
      .filter({ hasText: /^Secret view key/ })
      .locator("input")
      .first()
      .fill(params.secretViewKey);
    const spendKeyInput = this.page
      .locator("div")
      .filter({ hasText: /^Secret spend key/ })
      .locator("input")
      .first();
    if (params.secretSpendKey) {
      await spendKeyInput.fill(params.secretSpendKey);
    } else {
      await spendKeyInput.fill("");
    }
  }

  async restoreWalletFromKeys(params: {
    walletName: string;
    address: string;
    secretViewKey: string;
    secretSpendKey?: string;
    startingHeight?: string;
    startingHeightDate?: string;
  }): Promise<WalletMainPage> {
    await this.fillRestoreFromKeysFields(params);
    if (params.startingHeightDate) {
      await this.pickRestoreStartingHeightDate(params.startingHeightDate);
    } else {
      const heightInput = this.startingHeightInput();
      await heightInput.fill(params.startingHeight ?? "0");
      await expect(heightInput).toHaveValue(params.startingHeight ?? "0");
    }

    await this.submitRestoreWalletForm();

    const walletMainPage = new WalletMainPage(this.page);
    await walletMainPage.waitUntilLoaded();
    return walletMainPage;
  }

  private noHeightConfirmDialog(): Locator {
    return this.page.getByText(
      /No height is provided\. Do you want to use current blockchain height\?/i,
    );
  }

  /** Fills the from-keys form leaving the starting height empty, then submits. */
  async submitRestoreFromKeysWithoutHeight(params: {
    walletName: string;
    address: string;
    secretViewKey: string;
    secretSpendKey?: string;
  }): Promise<void> {
    await this.fillRestoreFromKeysFields(params);
    const heightInput = this.startingHeightInput();
    await heightInput.fill("");
    await expect(heightInput).toHaveValue("");
    await this.submitRestoreWalletForm();
  }

  async expectNoHeightConfirmVisible(): Promise<void> {
    await expect(this.noHeightConfirmDialog()).toBeVisible();
  }

  async confirmUseDaemonHeight(): Promise<WalletMainPage> {
    await this.page.getByRole("button", { name: /^Yes$/ }).click();
    const walletMainPage = new WalletMainPage(this.page);
    await walletMainPage.waitUntilLoaded();
    return walletMainPage;
  }

  async declineUseDaemonHeight(): Promise<void> {
    await this.page.getByRole("button", { name: /^No$/ }).click();
    await expect(this.noHeightConfirmDialog()).toHaveCount(0);
  }
}
