import { expect, test } from "@playwright/test";
import {
  getWalletDisplayName,
  isWalletNameAllowed,
  isWalletOwnedFileName,
  validateWalletName,
  leftoverWalletFileNames,
  unexpectedKeysExportFileNames,
  unexpectedKeysFileNames,
  walletKeysFileName,
  walletNameFromKeysCompanionFile,
  walletNameFromKeysFile,
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
      "C:alice",
      "dir/name",
      "dir\\name",
      "bad\u0000name",
    ]) {
      expect(() => validateWalletName(walletName), walletName).toThrow();
      expect(isWalletNameAllowed(walletName), walletName).toBe(false);
    }
  });

  test("maps keys files and companion files back to a wallet", () => {
    expect(walletKeysFileName("alice")).toBe("alice.keys");
    expect(walletNameFromKeysFile("alice.keys")).toBe("alice");
    expect(walletNameFromKeysFile("alice.background.keys")).toBeNull();
    expect(walletNameFromKeysCompanionFile("alice.background.keys")).toBe(
      "alice",
    );
    expect(isWalletOwnedFileName("alice", "alice")).toBe(true);
    expect(isWalletOwnedFileName("alice", "alice.address.txt")).toBe(true);
    expect(isWalletOwnedFileName("alice", "bob.keys")).toBe(false);
  });

  test("finds stored files that are not part of a listed wallet", () => {
    expect(
      leftoverWalletFileNames([
        "alice",
        "alice.address.txt",
        "alice.background.keys",
        "alice.keys",
      ]),
    ).toEqual([]);

    expect(
      leftoverWalletFileNames([
        "alice",
        "alice.keys",
        "alice.v1",
        "alice.v1.keys",
      ]),
    ).toEqual([]);

    expect(
      leftoverWalletFileNames(["alice.v1", "alice.v1.keys", "notes.txt"]),
    ).toEqual(["alice.v1", "alice.v1.keys", "notes.txt"]);

    expect(leftoverWalletFileNames(["alice.background.keys"])).toEqual([
      "alice.background.keys",
    ]);
  });

  test("finds keys files whose names this app will not list", () => {
    expect(
      unexpectedKeysFileNames([
        "alice",
        "alice.background.keys",
        "alice.keys",
        "alice.v1",
        "alice.v1.keys",
        "notes.txt",
      ]),
    ).toEqual(["alice.v1.keys"]);
    expect(
      unexpectedKeysExportFileNames(["alice.v1", "alice.v1.keys", "notes.txt"]),
    ).toEqual(["alice.v1.keys", "alice.v1"]);
    expect(unexpectedKeysFileNames(["alice.background.keys"])).toEqual([]);
  });

  test("extracts display names from wallet paths", () => {
    expect(getWalletDisplayName("wallet-a")).toBe("wallet-a");
    expect(getWalletDisplayName("/data/wallet-a")).toBe("wallet-a");
    expect(getWalletDisplayName("\\data\\wallet-a.keys")).toBe("wallet-a");
  });
});
