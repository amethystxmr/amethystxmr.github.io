import {
  expect,
  test,
  type Download,
  type Locator,
  type Page,
} from "@playwright/test";

export class ManageWalletsPage {
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

  /** One row card (`SurfaceCard`), not a parent that wraps the whole list. */
  private walletCard(walletName: string): Locator {
    return this.page
      .locator('div[class*="rounded-xl"][class*="ring-1"]')
      .filter({ has: this.page.getByText(walletName, { exact: true }) })
      .first();
  }

  async expectLoaded(): Promise<void> {
    await expect(
      this.page.getByRole("heading", { name: /manage wallets/i }),
    ).toBeVisible();
  }

  async expectWalletRowVisible(walletName: string): Promise<void> {
    await expect(this.walletCard(walletName)).toBeVisible({ timeout: 120_000 });
  }

  async expectEmptyState(): Promise<void> {
    await expect(this.page.getByText(/No wallets available/i)).toBeVisible({
      timeout: 120_000,
    });
  }

  async startRemoveForWallet(walletName: string): Promise<void> {
    await this.walletCard(walletName)
      .getByRole("button", { name: "🗑 Remove" })
      .click();
  }

  async confirmRemoveDialog(walletNameToType: string): Promise<void> {
    await this.page.getByPlaceholder(walletNameToType).fill(walletNameToType);
    await this.page.getByRole("button", { name: /^Remove wallet$/ }).click();
  }

  async startRenameForWallet(walletName: string): Promise<void> {
    await this.walletCard(walletName)
      .getByRole("button", { name: "✎ Rename" })
      .click();
  }

  async submitRenameDialog(newWalletName: string): Promise<void> {
    const renameForm = this.page
      .locator("form")
      .filter({ hasText: /Enter new name for/i });
    await renameForm.locator("input").fill(newWalletName);
    await renameForm.getByRole("button", { name: /rename wallet/i }).click();
  }

  async exportWalletToPath(
    walletName: string,
    absolutePath: string,
  ): Promise<void> {
    const downloadPromise = this.page.waitForEvent("download");
    await this.walletCard(walletName)
      .getByRole("button", { name: "⬇︎ Export" })
      .click();
    const download: Download = await downloadPromise;
    await download.saveAs(absolutePath);
  }

  async importZipFromPath(zipPath: string): Promise<void> {
    await this.page
      .locator('input[type="file"][accept*="zip"]')
      .setInputFiles(zipPath);
  }

  async backToWalletList(): Promise<void> {
    await this.page.getByRole("button", { name: /^← Back$/ }).click();
  }
}
