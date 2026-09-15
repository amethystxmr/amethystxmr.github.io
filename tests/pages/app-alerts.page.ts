import { expect, type Page } from "@playwright/test";

/** In-app `alert()` / `AlertDialog` (Notice + OK). */
export class AppAlertsPage {
  constructor(private readonly page: Page) {}

  async dismissNoticeMatching(pattern: RegExp): Promise<void> {
    await expect(this.page.getByText(pattern)).toBeVisible({
      timeout: 120_000,
    });
    await this.page.getByRole("button", { name: /^OK$/ }).click();
  }

  /** After importing a zip whose wallet already exists on disk (manage Import). */
  async dismissImportCompletedExpectingSkippedWallet(
    walletName: string,
  ): Promise<void> {
    const escaped = walletName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await expect(
      this.page.getByText(
        new RegExp(
          `Import completed[\\s\\S]*Skipped \\(already exists\\)[\\s\\S]*- ${escaped}`,
          "i",
        ),
      ),
    ).toBeVisible({ timeout: 120_000 });
    await this.page.getByRole("button", { name: /^OK$/ }).click();
  }

  async dismissImportCompletedExpectingWallets(
    walletNames: string[],
  ): Promise<void> {
    const escapedWallets = walletNames.map((walletName) =>
      walletName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    await expect(
      this.page.getByText(
        new RegExp(
          `Import completed[\\s\\S]*Imported[\\s\\S]*${escapedWallets
            .map((walletName) => `- ${walletName}`)
            .join("[\\s\\S]*")}`,
          "i",
        ),
      ),
    ).toBeVisible({ timeout: 120_000 });
    await this.page.getByRole("button", { name: /^OK$/ }).click();
  }

  async dismissImportCompletedExpectingWarning(pattern: RegExp): Promise<void> {
    await expect(this.page.getByText(pattern)).toBeVisible({
      timeout: 120_000,
    });
    await this.page.getByRole("button", { name: /^OK$/ }).click();
  }
}
