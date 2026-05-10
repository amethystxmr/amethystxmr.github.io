import { expect, type Page } from "@playwright/test";

/** In-app `alert()` / `AlertDialog` (Notice + OK). */
export class AppAlertsPage {
  constructor(private readonly page: Page) {}

  async dismissNoticeMatching(pattern: RegExp): Promise<void> {
    await expect(this.page.getByText(pattern)).toBeVisible({ timeout: 120_000 });
    await this.page.getByRole("button", { name: /^OK$/ }).click();
  }
}
