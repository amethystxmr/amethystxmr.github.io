import { expect, test, type Download, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";

export type MultisigSignResult =
  | { sent: true; exportedData: null }
  | { sent: false; exportedData: Uint8Array };

export class WalletMainPage {
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
        if (
          prop.startsWith("readDownloadToUint8Array") ||
          prop.startsWith("parseXmrTextToAtomic")
        ) {
          return value;
        }
        return (...args: unknown[]) =>
          test.step(`${target.constructor.name}.${prop}`, async () =>
            value.apply(target, args));
      },
    }) as this;
  }

  private static readonly ATOMIC_UNITS_PER_XMR = 1_000_000_000_000n;

  async openTab(
    name: "receive" | "send" | "transactions" | "multisig" | "other",
  ): Promise<void> {
    const tab = this.page.getByRole("tab", { name: new RegExp(name, "i") });
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.waitForBlockingOverlayToDisappear();
      try {
        await tab.click({ timeout: 5_000 });
      } catch {
        // Retry if click was intercepted by transient UI state.
      }
      const isSelected = (await tab.getAttribute("aria-selected")) === "true";
      if (isSelected) {
        await this.waitForBlockingOverlayToDisappear();
        return;
      }
      await this.page.waitForTimeout(200);
    }
    throw new Error(`Failed to open tab: ${name}`);
  }

  async waitUntilLoaded(timeoutMs = 60_000): Promise<void> {
    await expect(
      this.page.getByRole("tab", { name: /receive/i }),
    ).toBeVisible();

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const balance = await this.getUnlockedBalanceAtomic();
      if (balance !== null) {
        return;
      }
      await this.page.waitForTimeout(500);
    }
    throw new Error(
      `Wallet main view did not show XMR balance within ${timeoutMs}ms`,
    );
  }

  async reloadAndWaitForWallet(): Promise<void> {
    await this.page.reload({ waitUntil: "domcontentloaded" });
    await this.waitUntilLoaded();
  }

  /** Clicks Exit on the Other tab (how the app leaves the wallet; no assumptions about reload vs in-app navigation). */
  async exitFromWallet(): Promise<void> {
    await this.openTab("other");
    await this.page.getByRole("button", { name: /exit/i }).click();
  }

  async clickRefreshWallet(): Promise<void> {
    await this.openTab("other");
    await this.page.getByRole("button", { name: /refresh wallet/i }).click();
    const refreshingLabel = this.page.getByText(/Refreshing\.\.\./i);
    const isRefreshingVisible = await refreshingLabel
      .isVisible()
      .catch(() => false);
    if (isRefreshingVisible) {
      await refreshingLabel.waitFor({ state: "hidden", timeout: 120_000 });
    }
    await this.waitForBlockingOverlayToDisappear(120_000);
  }

  async getPrimaryAddress(): Promise<string> {
    await this.openTab("receive");
    const input = this.page.getByLabel("Primary address address");
    await expect(input).toBeVisible();
    const text = (await input.inputValue()).replace(/\s+/g, "");
    return text;
  }

  private receiveAddressCard(titlePattern: RegExp | string) {
    return this.page
      .locator('div[class*="rounded-xl"][class*="ring-1"]')
      .filter({
        has: this.page.getByText(titlePattern, { exact: true }),
      })
      .first();
  }

  async addSubaddress(label: string): Promise<void> {
    await this.openTab("receive");
    await this.page.getByRole("button", { name: /add subaddress/i }).click();
    await this.page.getByPlaceholder(/optional label/i).fill(label);
    await this.page.getByRole("button", { name: /^\+ Create$/i }).click();
    await expect(
      this.page.getByText(`${label} (#1)`, { exact: true }),
    ).toBeVisible({ timeout: 60_000 });
  }

  async expectReceiveRowUnused(title: string): Promise<void> {
    await this.openTab("receive");
    const card = this.receiveAddressCard(title);
    await expect(card.getByText("Unused yet")).toBeVisible();
  }

  async getAddressFromReceiveRow(title: string): Promise<string> {
    await this.openTab("receive");
    const card = this.receiveAddressCard(title);
    const input = card.locator("input[readonly]").first();
    await expect(input).toBeVisible();
    return (await input.inputValue()).replace(/\s+/g, "");
  }

  async openPrimaryAddressQr(): Promise<void> {
    await this.openTab("receive");
    const card = this.receiveAddressCard("Primary address");
    await card.getByRole("button", { name: /QR/i }).click();
    await expect(this.page.getByText("Scan to copy address")).toBeVisible();
  }

  async expectViewOnlyMode(): Promise<void> {
    await expect(
      this.page.getByText("View-only", { exact: true }),
    ).toBeVisible();
    await this.openTab("send");
    await expect(this.page.getByText("Wallet is view-only")).toBeVisible();
    await expect(this.page.getByLabel("Recipient 1 address")).toHaveCount(0);
    await expect(
      this.page.getByRole("button", { name: /review transaction/i }),
    ).toHaveCount(0);
  }

  async expectSendReviewDisabled(): Promise<void> {
    await this.openTab("send");
    await expect(
      this.page.getByRole("button", { name: /review transaction/i }),
    ).toBeDisabled();
  }

  async fillSendRecipient(address: string, amountXmr: string): Promise<void> {
    await this.openTab("send");
    await this.page.getByLabel("Recipient 1 address").fill(address);
    await this.page.getByLabel("Recipient 1 amount").fill(amountXmr);
  }

  async openSeedKeysOverlay(): Promise<void> {
    await this.openTab("other");
    await this.page.getByRole("button", { name: /show seed\/keys/i }).click();
    await expect(this.page.getByText("Seed and keys")).toBeVisible();
    await expect(this.page.getByText("Loading seed/keys...")).toBeHidden({
      timeout: 60_000,
    });
  }

  async readSeedKeysOverlay(): Promise<{
    address: string;
    privateViewKey: string;
  }> {
    const textareas = this.page.locator("textarea");
    const address = (await textareas.nth(1).inputValue()).replace(/\s+/g, "");
    const privateViewKey = (await textareas.nth(2).inputValue()).replace(
      /\s+/g,
      "",
    );
    expect(address.length).toBeGreaterThan(20);
    expect(privateViewKey).toMatch(/^[0-9a-f]{64}$/i);
    return { address, privateViewKey };
  }

  async closeSeedKeysOverlay(): Promise<void> {
    await this.page.getByRole("button", { name: /close/i }).click();
    await expect(this.page.getByText("Seed and keys")).toBeHidden();
  }

  async reviewSend(
    destinationAddress: string,
    amountXmr: string,
  ): Promise<void> {
    await this.openTab("send");
    await this.page.getByLabel("Recipient 1 address").fill(destinationAddress);
    await this.page.getByLabel("Recipient 1 amount").fill(amountXmr);
    await this.page
      .getByRole("button", { name: /review transaction/i })
      .click();
    await expect(this.page.getByText("Total outgoing")).toBeVisible();
  }

  async expectSendReviewOutgoing(amountXmr: string): Promise<void> {
    await expect(
      this.page.getByText(WalletMainPage.xmrAmountPattern(amountXmr)).first(),
    ).toBeVisible();
    await expect(this.page.getByText("Network fee")).toBeVisible();
  }

  async confirmSend(): Promise<void> {
    await this.page.getByRole("button", { name: /confirm.*send/i }).click();
    await expect(this.page.getByText(/transaction sent/i)).toBeVisible();
  }

  async expectSentScreen(totalXmr: string): Promise<void> {
    await expect(
      this.page.getByText(
        new RegExp(
          `Total sent:\\s*${WalletMainPage.xmrAmountPatternSource(totalXmr)}\\s*XMR`,
        ),
      ),
    ).toBeVisible();
    await expect(this.page.getByText(/Fee paid:/)).toBeVisible();
  }

  async dismissSentScreen(): Promise<void> {
    await this.page.getByRole("button", { name: /send another/i }).click();
  }

  async sendXmr(destinationAddress: string, amountXmr: string): Promise<void> {
    await this.reviewSend(destinationAddress, amountXmr);
    await this.confirmSend();
    await this.dismissSentScreen();
  }

  async openCoinsOverlay(): Promise<void> {
    await this.openTab("send");
    await this.page.getByRole("button", { name: /show coins/i }).click();
    await expect(this.page.getByText("Coins", { exact: true })).toBeVisible();
    await expect(this.page.getByText("Loading coins...")).toBeHidden({
      timeout: 60_000,
    });
  }

  async expectUnspentCoinCountAtLeast(minCount: number): Promise<number> {
    const count = await this.page
      .getByText("spent: false", { exact: true })
      .count();
    expect(count).toBeGreaterThanOrEqual(minCount);
    return count;
  }

  async closeCoinsOverlay(): Promise<void> {
    await this.page.getByRole("button", { name: /close/i }).click();
    await expect(this.page.getByText("Wallet transfer outputs.")).toBeHidden();
  }

  async expectLatestTransactionAmount(
    typeLabel: "Mined" | "Pending" | "Mempool In",
    amountXmr: string,
    sign: "+" | "-",
  ): Promise<void> {
    await this.openTab("transactions");
    const typeBadge = this.page
      .getByLabel(`Transaction type: ${typeLabel}`)
      .first();
    await expect(typeBadge).toBeVisible();
    const card = this.page
      .locator('div[class*="rounded-xl"][class*="ring-1"]')
      .filter({ has: typeBadge })
      .first();
    const signPattern = sign === "+" ? "\\+" : "-";
    await expect(
      card.getByText(
        new RegExp(
          `${signPattern}\\s*${WalletMainPage.xmrAmountPatternSource(amountXmr)}\\s*XMR`,
        ),
      ),
    ).toBeVisible();
  }

  async sweepAllXmr(destinationAddress: string): Promise<void> {
    await this.openTab("send");
    await this.page.getByLabel("Recipient 1 address").fill(destinationAddress);
    await this.page.getByRole("button", { name: /^All$/i }).click();

    await this.page
      .getByRole("button", { name: /review transaction/i })
      .click();
    await this.page.getByRole("button", { name: /confirm.*send/i }).click();
    await expect(this.page.getByText(/transaction sent/i)).toBeVisible();
    await this.page.getByRole("button", { name: /send another/i }).click();
  }

  async waitForMultisigInProgress(
    threshold: number,
    total: number,
    timeoutMs = 180_000,
  ): Promise<void> {
    const startedAt = Date.now();
    const setupHeader = this.page.getByText(
      new RegExp(`Setting up\\s+${threshold}-of-${total}\\s+multisig`, "i"),
    );
    const readyHeader = this.page.getByText(
      new RegExp(
        `Multisig\\s+${threshold}-of-${total}\\s+is\\s+ready\\s+to\\s+use`,
        "i",
      ),
    );
    const exchangeButton = this.page.getByRole("button", {
      name: /exchange multisig keys/i,
    });

    while (Date.now() - startedAt < timeoutMs) {
      await this.openTab("multisig");
      if (await readyHeader.isVisible().catch(() => false)) {
        return;
      }
      if (
        (await setupHeader.isVisible().catch(() => false)) &&
        (await exchangeButton.isVisible().catch(() => false))
      ) {
        return;
      }
      await this.page.waitForTimeout(500);
    }

    throw new Error(
      `Multisig did not reach in-progress state within ${timeoutMs}ms`,
    );
  }

  async waitForMultisigReady(
    threshold: number,
    total: number,
    timeoutMs = 180_000,
  ): Promise<void> {
    const startedAt = Date.now();
    const readyHeader = this.page.getByText(
      new RegExp(
        `Multisig\\s+${threshold}-of-${total}\\s+is\\s+ready\\s+to\\s+use`,
        "i",
      ),
    );
    const exportButton = this.page.getByRole("button", {
      name: /export latest multisig data/i,
    });
    const readyStatus = this.page.getByText(
      /status:\s*ready to create or sign transactions/i,
    );

    while (Date.now() - startedAt < timeoutMs) {
      await this.openTab("multisig");
      const headerVisible = await readyHeader.isVisible().catch(() => false);
      const exportVisible = await exportButton.isVisible().catch(() => false);
      if (headerVisible || exportVisible) {
        await expect(readyHeader).toBeVisible();
        await expect(exportButton).toBeVisible();
        await expect(readyStatus).toBeVisible();
        return;
      }
      await this.page.waitForTimeout(500);
    }

    throw new Error(`Multisig did not become ready within ${timeoutMs}ms`);
  }

  async prepareMultisigAndGetRound1Message(
    timeoutMs = 60_000,
  ): Promise<string> {
    await this.openTab("multisig");
    await this.page.getByRole("button", { name: /prepare multisig/i }).click();
    const messageField = this.page.getByRole("textbox", {
      name: "Multisig round 1 message",
      exact: true,
    });
    await expect(messageField).toBeVisible({ timeout: timeoutMs });
    await expect(messageField).toHaveAttribute("data-ready", "true", {
      timeout: timeoutMs,
    });
    return (await messageField.inputValue()).trim();
  }

  async makeMultisig(
    threshold: number,
    participants: number,
    allRoundMessages: string,
  ): Promise<void> {
    await this.openTab("multisig");
    if (participants > 4) {
      const moreButton = this.page.getByRole("button", { name: /^More$/i });
      if (await moreButton.isVisible().catch(() => false)) {
        await moreButton.click();
      }
    }
    await this.page
      .getByRole("button", { name: `Multisig participants ${participants}` })
      .click();
    await this.page
      .getByRole("button", { name: `Multisig threshold ${threshold}` })
      .click();
    await this.page
      .getByRole("textbox", {
        name: "Multisig round 1 messages input",
        exact: true,
      })
      .fill(allRoundMessages);
    await this.page
      .getByRole("button", {
        name: new RegExp(
          `make\\s+${threshold}\\/${participants}\\s+multisig`,
          "i",
        ),
      })
      .click();
  }

  async isMultisigReady(): Promise<boolean> {
    await this.openTab("multisig");
    return await this.page
      .getByRole("button", { name: /export latest multisig data/i })
      .isVisible()
      .catch(() => false);
  }

  async getCurrentMultisigRoundMessage(timeoutMs = 60_000): Promise<string> {
    await this.openTab("multisig");
    const messageField = this.page.getByRole("textbox", {
      name: "Multisig current round message",
      exact: true,
    });
    await expect(messageField).toBeVisible({ timeout: timeoutMs });
    await expect(messageField).toHaveAttribute("data-ready", "true", {
      timeout: timeoutMs,
    });
    await expect(messageField).not.toHaveValue("", { timeout: timeoutMs });
    return (await messageField.inputValue()).trim();
  }

  async waitForMultisigRound(round: number, timeoutMs = 60_000): Promise<void> {
    await this.openTab("multisig");
    await expect(
      this.page.getByText(
        new RegExp(`All participants round\\s+${round}\\s+messages`, "i"),
      ),
    ).toBeVisible({ timeout: timeoutMs });
  }

  async exchangeMultisigRoundMessages(messages: string): Promise<void> {
    await this.openTab("multisig");
    const readyExportButton = this.page.getByRole("button", {
      name: /export latest multisig data/i,
    });
    if (await readyExportButton.isVisible().catch(() => false)) {
      return;
    }
    const exchangeButton = this.page.getByRole("button", {
      name: /exchange multisig keys/i,
    });
    await expect(exchangeButton).toBeVisible();
    const input = this.page.getByRole("textbox", {
      name: /Multisig round \d+ messages input/,
    });
    await expect(input).toBeVisible();
    await input.fill(messages);
    await exchangeButton.click({ timeout: 5_000 });
    const exchangeErrorNotice = this.page.getByText(
      /Failed to exchange multisig keys:/i,
    );
    const hasError = await exchangeErrorNotice
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!hasError) {
      return;
    }
    const errorText =
      (await exchangeErrorNotice.textContent())?.trim() || "unknown error";
    await this.page.getByRole("button", { name: /^OK$/i }).click();
    throw new Error(errorText);
  }

  async createMultisigTransactionAndExport(
    destinationAddress: string,
    amountXmr: string,
  ): Promise<Uint8Array> {
    await this.openTab("send");
    await this.page.getByLabel("Recipient 1 address").fill(destinationAddress);
    await this.page.getByLabel("Recipient 1 amount").fill(amountXmr);
    await this.page
      .getByRole("button", { name: /review transaction/i })
      .click();
    await this.page.getByRole("button", { name: /^✓\s*Confirm$/i }).click();
    return await this.downloadFromExportOverlay(
      /Partially signed transaction/i,
    );
  }

  async exportLatestMultisigData(): Promise<Uint8Array> {
    await this.openTab("multisig");
    await this.page
      .getByRole("button", { name: /export latest multisig data/i })
      .click();
    await this.page.getByRole("button", { name: /yes,\s*export/i }).click();
    await expect(this.page.getByText(/Your multisig data/i)).toBeVisible();
    const downloadPromise = this.page.waitForEvent("download");
    await this.page.getByRole("button", { name: /^Save to file$/i }).click();
    const download = await downloadPromise;
    return await this.readDownloadToUint8Array(download);
  }

  async importParticipantMultisigData(files: Uint8Array[]): Promise<void> {
    await this.openTab("multisig");
    await this.page
      .getByRole("button", { name: /import participant data/i })
      .click();
    await expect(
      this.page.getByText(/paste data from others here/i),
    ).toBeVisible();
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles(
      files.map((buffer, index) => ({
        name: `multisig-${index + 1}.bin`,
        mimeType: "application/octet-stream",
        buffer: Buffer.from(buffer),
      })),
    );
    const successAlert = this.page.getByText(/Multisig info imported/i);
    const errorAlert = this.page.getByText(
      /Wrong number of multisig sources|Failed to import/i,
    );
    const hasSuccess = await successAlert
      .waitFor({ state: "visible", timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    if (!hasSuccess) {
      const errorText = (
        (await errorAlert.textContent().catch(() => "")) || ""
      ).trim();
      if (
        await this.page
          .getByRole("button", { name: /^OK$/i })
          .isVisible()
          .catch(() => false)
      ) {
        await this.page.getByRole("button", { name: /^OK$/i }).click();
      }
      throw new Error(
        `Failed to import multisig participant data: ${errorText || "unknown error"}`,
      );
    }
    await this.page.getByRole("button", { name: /^OK$/i }).click();
  }

  async hasPartialKeyImagesWarning(): Promise<boolean> {
    await this.openTab("multisig");
    return await this.page
      .getByText(/partial key images detected/i)
      .isVisible()
      .catch(() => false);
  }

  async signMultisigTransactionAndContinue(
    importData: Uint8Array,
  ): Promise<MultisigSignResult> {
    await this.openTab("send");
    await this.page.getByRole("button", { name: /sign multisig tx/i }).click();
    await this.importMultisigTxDataFromFile(importData);

    const finalizeButton = this.page.getByRole("button", {
      name: /^✓\s*Finalize\s*&\s*Send$/i,
    });
    const confirmButton = this.page.getByRole("button", {
      name: /^✓\s*Confirm$/i,
    });
    await expect(
      this.page.getByRole("button", {
        name: /^✓\s*(Confirm|Finalize\s*&\s*Send)$/i,
      }),
    ).toBeVisible();
    const isFinalSigner = await finalizeButton.isVisible().catch(() => false);
    if (isFinalSigner) {
      await finalizeButton.click();
      await expect(this.page.getByText(/transaction sent/i)).toBeVisible();
      return { exportedData: null, sent: true };
    }

    await confirmButton.click();
    const exportedData =
      await this.downloadFromExportOverlay(/Signed multisig tx/i);
    return { exportedData, sent: false };
  }

  private async importMultisigTxDataFromFile(data: Uint8Array): Promise<void> {
    await expect(
      this.page.getByText(/paste multisig tx data here/i),
    ).toBeVisible();
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "partially-signed-multisig.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(data),
    });
  }

  private async downloadFromExportOverlay(
    headerPattern: RegExp,
  ): Promise<Uint8Array> {
    await expect(this.page.getByText(headerPattern)).toBeVisible();
    const downloadPromise = this.page.waitForEvent("download");
    await this.page.getByRole("button", { name: /^Save to file$/i }).click();
    const download = await downloadPromise;
    return await this.readDownloadToUint8Array(download);
  }

  private async readDownloadToUint8Array(
    download: Download,
  ): Promise<Uint8Array> {
    const stream = await download.createReadStream();
    if (!stream) {
      throw new Error("Failed to read downloaded multisig data");
    }

    const chunks: Uint8Array[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk) => {
        if (chunk instanceof Uint8Array) {
          chunks.push(chunk);
          return;
        }
        reject(new Error("Unexpected chunk type while reading download"));
      });
      stream.on("end", () => resolve());
      stream.on("error", (error) => reject(error));
    });
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  async getPaymentTypeCounts(): Promise<Record<string, number>> {
    await this.openTab("transactions");
    const mined = await this.page.getByLabel("Transaction type: Mined").count();
    const pending = await this.page
      .getByLabel("Transaction type: Pending")
      .count();
    const mempool = await this.page
      .getByLabel("Transaction type: Mempool In")
      .count();
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
    await this.reloadAndWaitForWallet();
    const startedAt = Date.now();
    let lastCount = 0;

    while (Date.now() - startedAt < timeoutMs) {
      try {
        await this.clickRefreshWallet();
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
    const text =
      (await this.page
        .getByLabel("XMR available value")
        .first()
        .textContent()) ?? "";
    const parsed = WalletMainPage.parseXmrTextToAtomic(text);
    return parsed;
  }

  async waitForUnlockedBalanceAtLeast(
    minBalanceAtomic: bigint,
    timeoutMs = 180_000,
  ): Promise<bigint> {
    await this.reloadAndWaitForWallet();
    const startedAt = Date.now();
    let last = 0n;
    let lastUi = "";

    while (Date.now() - startedAt < timeoutMs) {
      try {
        await this.clickRefreshWallet();
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
        lastUi = (
          (await this.page
            .getByLabel("XMR available value")
            .first()
            .textContent()) ?? ""
        ).trim();
      } catch {
        // Ignore UI probe errors.
      }
      await this.page.waitForTimeout(1_000);
    }

    throw new Error(
      `Unlocked balance did not reach ${minBalanceAtomic} atomic units. Last value: ${last}. Last UI text: ${lastUi}`,
    );
  }

  async waitForExactSyncedHeight(
    expectedHeight: number,
    timeoutMs = 120_000,
  ): Promise<void> {
    await this.reloadAndWaitForWallet();
    const startedAt = Date.now();
    let lastWalletHeightText = "";
    let lastDaemonHeightText = "";
    let lastWalletHeight: number | null = null;
    let lastDaemonHeight: number | null = null;

    while (Date.now() - startedAt < timeoutMs) {
      try {
        await this.clickRefreshWallet();
        const walletHeightText =
          (await this.page
            .getByLabel("Wallet current height")
            .first()
            .textContent()) ?? "";
        const daemonHeightText =
          (await this.page
            .getByLabel("Daemon current height")
            .first()
            .textContent()) ?? "";
        lastWalletHeightText = walletHeightText.trim();
        lastDaemonHeightText = daemonHeightText.trim();

        const walletHeight = Number.parseInt(lastWalletHeightText, 10);
        const daemonHeight = Number.parseInt(lastDaemonHeightText, 10);

        if (!Number.isNaN(walletHeight)) {
          lastWalletHeight = walletHeight;
        }
        if (!Number.isNaN(daemonHeight)) {
          lastDaemonHeight = daemonHeight;
        }

        if (
          walletHeight === expectedHeight &&
          daemonHeight === expectedHeight
        ) {
          return;
        }
      } catch {
        // Refresh/read may fail transiently while wallet is updating.
      }
      await this.page.waitForTimeout(1_000);
    }

    throw new Error(
      `Wallet did not reach exact synced height ${expectedHeight}/${expectedHeight}. ` +
        `Last wallet height: ${lastWalletHeight ?? "NaN"} (UI text: "${lastWalletHeightText}"), ` +
        `last daemon height: ${lastDaemonHeight ?? "NaN"} (UI text: "${lastDaemonHeightText}")`,
    );
  }

  private static xmrAmountPatternSource(amountXmr: string): string {
    const parts = amountXmr.split(".");
    const whole = parts[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (parts.length > 1) {
      const fraction = parts[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return `${whole}\\.${fraction}0*`;
    }
    return `${whole}(?:\\.0+)?`;
  }

  private static xmrAmountPattern(amountXmr: string): RegExp {
    return new RegExp(
      `${WalletMainPage.xmrAmountPatternSource(amountXmr)}\\s*XMR`,
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

  private async waitForBlockingOverlayToDisappear(
    timeoutMs = 30_000,
  ): Promise<void> {
    const blockingOverlay = this.page.locator(
      "div[class*='inset-0'][class*='z-[70]']",
    );
    const hasVisibleOverlay = await blockingOverlay
      .first()
      .isVisible()
      .catch(() => false);
    if (!hasVisibleOverlay) {
      return;
    }
    await blockingOverlay
      .first()
      .waitFor({ state: "hidden", timeout: timeoutMs });
  }
}
