import { expect, type Page } from "@playwright/test";
import { WalletMainPage } from "./wallet-main.page";

export class InitialWalletListPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/");
  }

  async waitUntilLoaded(): Promise<void> {
    await expect(
      this.page.getByRole("button", { name: /restore/i }),
    ).toBeVisible();
  }

  async openRestoreWallet(): Promise<void> {
    await this.page.getByRole("button", { name: /restore/i }).click();
    await expect(
      this.page.getByRole("heading", { name: /restore wallet/i }),
    ).toBeVisible();
  }

  async restoreWallet(params: {
    walletName: string;
    seed: string;
    startingHeight?: string;
  }): Promise<WalletMainPage> {
    const startingHeightInput = this.page
      .locator("div")
      .filter({ hasText: /^Starting height/ })
      .locator("input")
      .first();

    await this.page
      .locator("div")
      .filter({ hasText: /^Wallet name$/ })
      .locator("input")
      .first()
      .fill(params.walletName);
    await this.page
      .locator("div")
      .filter({ hasText: /^Seed phrase$/ })
      .locator("textarea")
      .first()
      .fill(params.seed);
    await startingHeightInput.fill(params.startingHeight ?? "0");
    await expect(startingHeightInput).toHaveValue(params.startingHeight ?? "0");

    await this.page.getByRole("button", { name: /restore wallet/i }).click();

    const walletMainPage = new WalletMainPage(this.page);
    await walletMainPage.waitUntilLoaded();
    return walletMainPage;
  }
}
