import { expect, test } from "@playwright/test";
import {
  planWalletArchiveImport,
  type WalletArchiveEntry,
} from "../web-src/components/starting/walletArchiveCandidates";

function file(path: string, byte: number = 1): WalletArchiveEntry {
  return {
    path,
    isDirectory: false,
    data: new Uint8Array([byte]),
  };
}

function directory(path: string): WalletArchiveEntry {
  return {
    path,
    isDirectory: true,
    data: new Uint8Array(),
  };
}

test.describe("wallet archive candidates", () => {
  test("plans multiple flat wallets and groups companion files", () => {
    const plan = planWalletArchiveImport([
      file("alice", 1),
      file("alice.keys", 2),
      file("alice.address.txt", 3),
      file("alice.background.keys", 4),
      file("bob", 5),
      file("bob.keys", 6),
    ]);

    expect(plan.errors).toEqual([]);
    expect(plan.invalidWalletNames).toEqual([]);
    expect(plan.unusedFiles).toEqual([]);
    expect(plan.candidates.map((candidate) => candidate.walletName)).toEqual([
      "alice",
      "bob",
    ]);
    expect(plan.candidates[0].files.map((file) => file.storageName)).toEqual([
      "alice",
      "alice.address.txt",
      "alice.background.keys",
      "alice.keys",
    ]);
  });

  test("supports keys-only wallets with a warning", () => {
    const plan = planWalletArchiveImport([file("keysOnly.keys")]);

    expect(plan.errors).toEqual([]);
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0].walletName).toBe("keysOnly");
    expect(plan.warnings).toEqual([
      'Wallet "keysOnly" has no wallet cache file; it will be recreated/refreshed after open.',
    ]);
  });

  test("reports invalid names and unused nested files", () => {
    const plan = planWalletArchiveImport([
      directory("nested/"),
      file("nested/nested.keys"),
      file("a.b.keys"),
      file("notes.txt"),
    ]);

    expect(plan.errors).toEqual([]);
    expect(plan.candidates).toEqual([]);
    expect(plan.invalidWalletNames).toEqual([
      {
        archivePath: "a.b.keys",
        walletName: "a.b",
        reason: "Wallet name cannot contain dots",
      },
    ]);
    expect(plan.unusedFiles).toEqual(["nested/nested.keys", "notes.txt"]);
  });

  test("rejects unsafe archive paths", () => {
    const plan = planWalletArchiveImport([
      file("../evil.keys"),
      file("/evil.keys"),
      file("C:/evil.keys"),
      file("dir\\evil.keys"),
    ]);

    expect(plan.candidates).toEqual([]);
    expect(plan.errors).toEqual([
      "Unsafe archive path: ../evil.keys",
      "Unsafe archive path: /evil.keys",
      "Unsafe archive path: C:/evil.keys",
      "Unsafe archive path: dir\\evil.keys",
    ]);
  });

  test("rejects duplicate flat archive entries", () => {
    const plan = planWalletArchiveImport([
      file("alice.keys", 1),
      file("alice.keys", 2),
    ]);

    expect(plan.candidates).toEqual([]);
    expect(plan.errors).toEqual(["Duplicate archive file: alice.keys"]);
  });
});
