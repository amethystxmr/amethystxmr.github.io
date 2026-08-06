import { expect, test } from "@playwright/test";
import {
  getWalletDisplayName,
  isWalletNameAllowed,
  validateWalletName,
} from "../monero-wasm-module/walletName";

test.describe("wallet name validation", () => {
  test("allows simple flat wallet names", () => {
    expect(() => validateWalletName("wallet name-1_2")).not.toThrow();
    expect(isWalletNameAllowed("wallet-name")).toBe(true);
  });

  test("rejects names that are unsafe in the flat wallet layout", () => {
    for (const walletName of [
      "",
      "   ",
      " wallet",
      "wallet ",
      ".",
      "..",
      "a.b",
      "a.keys",
      ".hidden",
      "dir/name",
      "dir\\name",
      "bad\u0000name",
    ]) {
      expect(() => validateWalletName(walletName), walletName).toThrow();
      expect(isWalletNameAllowed(walletName), walletName).toBe(false);
    }
  });

  test("extracts display names from wallet paths", () => {
    expect(getWalletDisplayName("wallet-a")).toBe("wallet-a");
    expect(getWalletDisplayName("/data/wallet-a")).toBe("wallet-a");
    expect(getWalletDisplayName("\\data\\wallet-a.keys")).toBe("wallet-a");
  });
});
