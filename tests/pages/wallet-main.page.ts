import { expect, type Page } from "@playwright/test";

export class WalletMainPage {
  constructor(private readonly page: Page) {}

  async waitUntilLoaded(): Promise<void> {
    await expect(this.page.getByRole("tab", { name: /receive/i })).toBeVisible();
    await this.page.waitForFunction(() => Boolean((window as any).wallet));
  }

  async clickRefreshInOtherTab(): Promise<void> {
    await this.page.getByRole("tab", { name: /other/i }).click();
    await this.page.getByRole("button", { name: /refresh wallet/i }).click();
    await this.page.getByRole("tab", { name: /receive/i }).click();
  }

  async getUnlockedBalanceAtomic(): Promise<bigint> {
    const value = await this.page.evaluate(async () => {
      const wallet = (window as any).wallet;
      if (!wallet) {
        throw new Error("wallet handle is not available on window");
      }

      const unlocked = await wallet.unlocked_balance(0, false);
      return unlocked.balance.toString();
    });

    return BigInt(value);
  }

  async waitForUnlockedBalanceAtLeast(
    minBalanceAtomic: bigint,
    timeoutMs = 120_000,
  ): Promise<bigint> {
    const startedAt = Date.now();
    let last = 0n;
    let lastProbe = "";

    while (Date.now() - startedAt < timeoutMs) {
      try {
        last = await this.getUnlockedBalanceAtomic();
        if (last >= minBalanceAtomic) {
          return last;
        }
      } catch {
        // Wallet may still be initializing, retry.
      }
      try {
        lastProbe = await this.page.evaluate(async () => {
          const wallet = (window as any).wallet;
          if (!wallet) {
            return "wallet=null";
          }
          const [walletHeight, daemonHeight, isSynced] = await Promise.all([
            wallet.get_blockchain_current_height(),
            wallet.get_daemon_blockchain_height(),
            wallet.is_synced(),
          ]);
          return `walletHeight=${walletHeight.toString()} daemonHeight=${daemonHeight.toString()} synced=${String(isSynced)}`;
        });
      } catch {
        // Ignore probe errors.
      }
      await this.page.waitForTimeout(1_000);
    }

    throw new Error(
      `Unlocked balance did not reach ${minBalanceAtomic} atomic units. Last value: ${last}. Probe: ${lastProbe}`,
    );
  }
}
