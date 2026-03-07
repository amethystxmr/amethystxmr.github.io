import { expect, type Page } from "@playwright/test";

export class WalletMainPage {
  constructor(private readonly page: Page) {}

  private static readonly ATOMIC_UNITS_PER_XMR = 1_000_000_000_000n;

  async openTab(name: "receive" | "send" | "transactions" | "multisig" | "other"): Promise<void> {
    await this.page.getByRole("tab", { name: new RegExp(name, "i") }).click();
  }

  async waitUntilLoaded(timeoutMs = 60_000): Promise<void> {
    await expect(this.page.getByRole("tab", { name: /receive/i })).toBeVisible();

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const balance = await this.getUnlockedBalanceAtomic();
      if (balance !== null) {
        return;
      }
      await this.page.waitForTimeout(500);
    }
    throw new Error(`Wallet main view did not show XMR balance within ${timeoutMs}ms`);
  }

  async clickRefreshInOtherTab(): Promise<void> {
    await this.openTab("other");
    await this.page.getByRole("button", { name: /refresh wallet/i }).click();
  }

  async getPrimaryAddress(): Promise<string> {
    await this.openTab("receive");
    const input = this.page.getByLabel("Primary address address");
    await expect(input).toBeVisible();
    const text = (await input.inputValue()).replace(/\s+/g, "");
    return text;
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
    await this.openTab("transactions");
    const mined = await this.page.getByLabel("Transaction type: Mined").count();
    const pending = await this.page.getByLabel("Transaction type: Pending").count();
    const mempool = await this.page.getByLabel("Transaction type: Mempool In").count();
    return {
      block: mined,
      pending,
      mempool,
    };
  }

  async waitForPaymentTypeCountAtLeast(
    paymentType: "block" | "pending" | "mempool",
    minCount: number,
    timeoutMs = 180_000,
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

  async getUnlockedBalanceAtomic(): Promise<bigint | null> {
    const text = (await this.page.getByLabel("XMR available value").first().textContent()) ?? "";
    const parsed = WalletMainPage.parseXmrTextToAtomic(text);
    return parsed;
  }

  async waitForUnlockedBalanceAtLeast(
    minBalanceAtomic: bigint,
    timeoutMs = 180_000,
  ): Promise<bigint> {
    const startedAt = Date.now();
    let last = 0n;
    let lastUi = "";

    while (Date.now() - startedAt < timeoutMs) {
      try {
        await this.clickRefreshInOtherTab();
        const balance = await this.getUnlockedBalanceAtomic();
        if (balance !== null) {
          last = balance;
        }
        if (balance !== null && balance >= minBalanceAtomic) {
          return last;
        }
      } catch {
        // Wallet may still be refreshing, retry.
      }
      try {
        lastUi = ((await this.page.getByLabel("XMR available value").first().textContent()) ?? "").trim();
      } catch {
        // Ignore UI probe errors.
      }
      await this.page.waitForTimeout(1_000);
    }

    throw new Error(
      `Unlocked balance did not reach ${minBalanceAtomic} atomic units. Last value: ${last}. Last UI text: ${lastUi}`,
    );
  }

  private static parseXmrTextToAtomic(text: string): bigint | null {
    const normalized = text.trim().replace(/,/g, "");
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!match) {
      return null;
    }
    const numberText = match[0];
    const [wholeRaw, fractionRaw = ""] = numberText.split(".");
    const whole = BigInt(wholeRaw);
    const fractionPadded = (fractionRaw + "0".repeat(12)).slice(0, 12);
    const fraction = BigInt(fractionPadded);
    return whole * WalletMainPage.ATOMIC_UNITS_PER_XMR + fraction;
  }
}
