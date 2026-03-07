import { expect, type Page } from "@playwright/test";

export class WalletMainPage {
  constructor(private readonly page: Page) {}

  async openTab(name: "receive" | "send" | "transactions" | "multisig" | "other"): Promise<void> {
    await this.page.getByRole("tab", { name: new RegExp(name, "i") }).click();
  }

  async waitUntilLoaded(): Promise<void> {
    await expect(this.page.getByRole("tab", { name: /receive/i })).toBeVisible();
    await this.page.waitForFunction(() => Boolean((window as any).wallet));
  }

  async clickRefreshInOtherTab(): Promise<void> {
    await this.openTab("other");
    await this.page.getByRole("button", { name: /refresh wallet/i }).click();
    await this.openTab("receive");
  }

  async getPrimaryAddress(): Promise<string> {
    const address = await this.page.evaluate(async () => {
      const wallet = (window as any).wallet;
      if (!wallet) {
        throw new Error("wallet handle is not available on window");
      }
      return wallet.get_address();
    });
    return String(address);
  }

  async sendXmr(destinationAddress: string, amountXmr: string): Promise<void> {
    await this.openTab("send");
    await this.page
      .locator("div")
      .filter({ hasText: /^Recipient address$/ })
      .locator("input")
      .first()
      .fill(destinationAddress);
    await this.page
      .getByPlaceholder("0.000000000000")
      .first()
      .fill(amountXmr);

    await this.page.getByRole("button", { name: /review transaction/i }).click();
    await this.page.getByRole("button", { name: /confirm.*send/i }).click();
    await expect(this.page.getByText(/transaction sent/i)).toBeVisible();
    await this.page.getByRole("button", { name: /send another/i }).click();
  }

  async getPaymentTypeCounts(): Promise<Record<string, number>> {
    return this.page.evaluate(async () => {
      const wallet = (window as any).wallet;
      if (!wallet) {
        throw new Error("wallet handle is not available on window");
      }

      const result: Record<string, number> = {};
      const add = (type: string) => {
        result[type] = (result[type] ?? 0) + 1;
      };

      const confirmed = await wallet.get_payments(0n, (1n << 64n) - 1n);
      for (let i = 0; i < confirmed.size(); i++) {
        add(confirmed.get(i).type);
      }
      confirmed.delete();

      const mempool = await wallet.get_payments_mempool();
      for (let i = 0; i < mempool.size(); i++) {
        add(mempool.get(i).type);
      }
      mempool.delete();

      return result;
    });
  }

  async waitForPaymentTypeCountAtLeast(
    paymentType: "block" | "pending" | "mempool",
    minCount: number,
    timeoutMs = 120_000,
  ): Promise<number> {
    const startedAt = Date.now();
    let lastCount = 0;

    while (Date.now() - startedAt < timeoutMs) {
      try {
        await this.clickRefreshInOtherTab();
        const counts = await this.getPaymentTypeCounts();
        lastCount = counts[paymentType] ?? 0;
        if (lastCount >= minCount) {
          return lastCount;
        }
      } catch {
        // Tolerate transient wallet/RPC errors and keep polling.
      }
      await this.page.waitForTimeout(1_000);
    }

    throw new Error(
      `Expected at least ${minCount} payments of type ${paymentType}, got ${lastCount}`,
    );
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
        await this.clickRefreshInOtherTab();
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
