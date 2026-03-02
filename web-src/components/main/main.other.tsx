import React from "react";
import { refreshXmrPrice } from "./useXmrPrice";
import {
  MultisigAccountStatus,
  MoneroWasmWallet,
  PaymentDetailsTransformed,
  WalletKeys,
  readFile,
  unlinkFile,
  writeFile,
} from "../../../monero-wasm-module/walletApi";
import { options } from "../options";
import {
  Button,
  ButtonsHolder,
  FullscreenOverlayPanel,
  OverlayDialog,
  TextArea,
  Toggle,
  useAlert,
  useIsMobileView,
  useMultisigDataOverlayExport,
  useMultisigDataOverlayImport,
} from "../ui";
import {
  balanceToString,
  bytesToHex,
  copyToClipboard,
  formatWalletTimestamp,
  withFsLock,
} from "../utils";

type SeedRevealState =
  | { open: false }
  | { open: true; type: "loading" }
  | {
      open: true;
      type: "loaded";
      seed: string | null;
      seedMessage: string | null;
      keys: WalletKeys;
    }
  | { open: true; type: "error"; error: string };

export function OtherTab({
  onExit,
  wallet,
  onRefresh,
  lastRefreshTimestamp,
  daemonLastBlockHeight,
  multisigStatus,
  hasUnknownKeyImages,
  isViewOnly,
  payments,
  priceEur,
  priceSource,
  priceFetchedAt,
}: {
  onExit: () => void;
  wallet: MoneroWasmWallet;
  onRefresh: () => void;
  lastRefreshTimestamp: Date | null;
  daemonLastBlockHeight: bigint | null;
  multisigStatus: MultisigAccountStatus | null;
  hasUnknownKeyImages: boolean | undefined;
  isViewOnly: boolean | undefined;
  payments: PaymentDetailsTransformed[] | null;
  priceEur: number | null;
  priceSource: string | null;
  priceFetchedAt: number | null;
}) {
  const [seedState, setSeedState] = React.useState<SeedRevealState>({
    open: false,
  });
  const [seedCopyState, setSeedCopyState] = React.useState<
    "idle" | "ok" | "fail"
  >("idle");
  const [now, setNow] = React.useState(() => Date.now());
  const [rescanState, setRescanState] = React.useState({
    open: false,
    hard: false,
    keepKeyImages: true,
    busy: false,
  });
  const alert = useAlert();
  const exportOverlay = useMultisigDataOverlayExport();
  const importOverlay = useMultisigDataOverlayImport();
  const isMobileView = useIsMobileView();
  const seedRows = isMobileView ? 6 : 2;
  const addressRows = isMobileView ? 3 : 1;
  const keyRows = isMobileView ? 2 : 1;

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [priceFetchedAt]);

  const priceFetchText = React.useMemo(() => {
    if (!priceFetchedAt || !priceSource) {
      return "No cached XMR price yet.";
    }
    return `${priceSource}, fetched ${formatElapsedSince(priceFetchedAt, now)} ago`;
  }, [priceFetchedAt, priceSource, now]);
  const priceValueText = React.useMemo(() => {
    if (priceEur === null) {
      return "—";
    }
    return `€${priceEur.toFixed(2)}`;
  }, [priceEur]);

  const firstConfirmedTx = React.useMemo(() => {
    if (!payments || payments.length === 0) {
      return null;
    }
    let earliest: { blockHeight: bigint; timestamp: bigint } | null = null;
    for (const tx of payments) {
      if (tx.block_height <= 0n) {
        continue;
      }
      if (
        earliest === null ||
        tx.block_height < earliest.blockHeight ||
        (tx.block_height === earliest.blockHeight &&
          tx.timestamp < earliest.timestamp)
      ) {
        earliest = { blockHeight: tx.block_height, timestamp: tx.timestamp };
      }
    }
    return earliest;
  }, [payments]);

  const suggestedRestoreHeight =
    firstConfirmedTx?.blockHeight ?? daemonLastBlockHeight;
  const firstConfirmedDateText = firstConfirmedTx
    ? formatWalletTimestamp(firstConfirmedTx.timestamp)
    : null;
  const suggestedRestoreSourceText = firstConfirmedTx
    ? "Based on first confirmed wallet transaction."
    : daemonLastBlockHeight !== null
      ? "No confirmed history found yet, using current daemon height."
      : "Waiting for daemon height...";

  const isSeedButtonDisabled = multisigStatus === null;
  const isMultisigWallet = multisigStatus?.multisig_is_active ?? false;
  const [isExportModeDialogOpen, setIsExportModeDialogOpen] =
    React.useState(false);
  const [isImportConfirmOpen, setIsImportConfirmOpen] = React.useState(false);
  const [busyAction, setBusyAction] = React.useState<
    "idle" | "export" | "import"
  >("idle");
  const isBusy = busyAction !== "idle";

  const onOpenSeedKeys = async () => {
    if (multisigStatus === null) {
      return;
    }

    if (multisigStatus.multisig_is_active && !multisigStatus.is_ready) {
      setSeedState({
        open: true,
        type: "error",
        error: "Unable to get seed while multisig setup is in progress",
      });
      return;
    }

    setSeedState({ open: true, type: "loading" });
    try {
      const keys = await wallet.get_keys(0);
      let seed: string | null = null;
      let seedMessage: string | null = null;

      try {
        if (multisigStatus.multisig_is_active) {
          seed = await wallet.get_multisig_seed("");
        } else {
          const deterministic = await wallet.is_deterministic();
          if (!deterministic) {
            seedMessage = "Wallet is not deterministic";
          } else {
            seed = await wallet.get_seed("English", "");
          }
        }
      } catch (e) {
        seedMessage = (e as Error).message || "Failed to load wallet seed";
      }

      setSeedState({ open: true, type: "loaded", seed, seedMessage, keys });
    } catch (e) {
      console.error("Failed to load wallet seed/keys:", e);
      setSeedState({
        open: true,
        type: "error",
        error: (e as Error).message || "Unknown error",
      });
    }
  };

  const onCopySeed = async () => {
    if (!seedState.open || seedState.type !== "loaded" || !seedState.seed) {
      return;
    }

    setSeedCopyState("idle");
    const ok = await copyToClipboard(seedState.seed);
    setSeedCopyState(ok ? "ok" : "fail");
    window.setTimeout(() => setSeedCopyState("idle"), 1500);
  };

  const onOpenRescanDialog = () => {
    setRescanState({
      open: true,
      hard: false,
      keepKeyImages: true,
      busy: false,
    });
  };

  const onConfirmRescan = async () => {
    if (rescanState.busy) {
      return;
    }

    setRescanState((prev) => ({ ...prev, busy: true }));
    try {
      await withFsLock(async () => {
        await wallet.rescan_blockchain(
          rescanState.hard,
          rescanState.keepKeyImages,
        );
        await wallet.store();
      });
      onRefresh();
    } catch (e) {
      void alert(
        (e as Error).message || "Unknown error while rescanning blockchain",
      );
    } finally {
      setRescanState((prev) => ({ ...prev, busy: false, open: false }));
    }
  };

  const unlinkIfExists = React.useCallback((fileName: string) => {
    try {
      unlinkFile(fileName);
    } catch {
      // File may already be removed.
    }
  }, []);

  const onExportKeyImages = React.useCallback(
    async (all: boolean) => {
      if (isBusy) {
        return;
      }

      setBusyAction("export");
      const tmpFile = `.tmp-key-images-export-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`;
      try {
        const [data, walletFile] = await withFsLock(async () => {
          try {
            await wallet.export_key_images(tmpFile, all);
            const readData = readFile(tmpFile);
            const copied = new Uint8Array(readData.length);
            copied.set(readData);
            const walletFileLocal = await wallet.get_wallet_file();
            return [copied, walletFileLocal] as const;
          } finally {
            unlinkIfExists(tmpFile);
          }
        });

        const walletName = walletFile.split(/[\\/]/).pop() || walletFile;
        await exportOverlay({
          data,
          header: "Your key images data",
          fileName: `${walletName}-key-images`,
        });
      } catch (e) {
        await alert((e as Error)?.message || "Failed to export key images");
      } finally {
        setBusyAction("idle");
      }
    },
    [alert, exportOverlay, isBusy, unlinkIfExists, wallet],
  );

  const onImportKeyImages = React.useCallback(async () => {
    if (isBusy) {
      return;
    }

    const importedData = await importOverlay({
      header: "Paste key images data here",
    });
    if (importedData === null) {
      return;
    }

    setBusyAction("import");
    const tmpFile = `.tmp-key-images-import-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`;
    try {
      const result = await withFsLock(async () => {
        try {
          writeFile(tmpFile, importedData);
          const importResult = await wallet.import_key_images(tmpFile, true);
          await wallet.store();
          return importResult;
        } finally {
          unlinkIfExists(tmpFile);
        }
      });
      await alert(
        `Signed key images imported to height ${result.height.toString()}, ${balanceToString(result.spent)} spent, ${balanceToString(result.unspent)} unspent`,
      );
      onRefresh();
    } catch (e) {
      await alert((e as Error)?.message || "Failed to import key images");
    } finally {
      setBusyAction("idle");
    }
  }, [alert, importOverlay, isBusy, onRefresh, unlinkIfExists, wallet]);

  return (
    <div className="mt-2 space-y-3">
      <Button
        className="w-full py-2 text-sm font-semibold"
        variant="neutral"
        disabled={isSeedButtonDisabled}
        onClick={() => {
          void onOpenSeedKeys();
        }}
      >
        → Show seed/keys
      </Button>

      <Button
        className="w-full py-2 text-sm font-semibold"
        variant="neutral"
        onClick={onRefresh}
      >
        ↺ Refresh wallet
      </Button>
      <div className="-mt-2 rounded-lg bg-white/5 px-2.5 py-2 text-center text-xs text-white/60">
        {lastRefreshTimestamp
          ? `Last refresh: ${formatElapsedSince(lastRefreshTimestamp.getTime(), now)} ago`
          : "Last refresh: waiting for first sync"}
      </div>
      {!isMultisigWallet && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            className="w-full py-2 text-sm font-semibold"
            variant="neutral"
            disabled={isBusy}
            onClick={() => {
              if (isViewOnly === true) {
                void alert(
                  "Export key images is unavailable for view-only wallet",
                );
                return;
              }
              setIsExportModeDialogOpen(true);
            }}
          >
            {busyAction === "export" ? "⬇︎ Exporting..." : "⬇︎ Export key images"}
          </Button>
          <Button
            className="w-full py-2 text-sm font-semibold"
            variant="neutral"
            disabled={isBusy}
            onClick={() => {
              setIsImportConfirmOpen(true);
            }}
          >
            {busyAction === "import" ? "⬆︎ Importing..." : "⬆︎ Import key images"}
          </Button>
        </div>
      )}
      <Button
        className="w-full py-2 text-sm font-semibold"
        variant="neutral"
        onClick={onOpenRescanDialog}
      >
        ↺ Rescan blockchain
      </Button>

      <Button
        className="w-full py-2 text-sm font-semibold"
        variant="neutral"
        onClick={() => {
          refreshXmrPrice();
        }}
      >
        ↺ Refresh XMR Price
      </Button>
      <div className="-mt-2 rounded-lg bg-white/5 px-2.5 py-2 text-center text-xs text-white/60">
        <div className="font-medium text-white/85">
          XMR/EUR: {priceValueText}
        </div>
        <div>Source: {priceFetchText}</div>
      </div>

      <Button
        className="w-full py-2 text-sm font-semibold"
        variant="soft"
        onClick={onExit}
      >
        ✖ Exit
      </Button>
      {!isMultisigWallet && isExportModeDialogOpen && (
        <OverlayDialog
          onClose={() => {
            if (!isBusy) {
              setIsExportModeDialogOpen(false);
            }
          }}
        >
          <div className="space-y-3">
            <div className="text-base font-semibold text-white">
              Export key images
            </div>
            <div className="text-sm text-white/75">Choose export mode:</div>
            <div className="rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70 ring-1 ring-white/10">
              <div>
                This export data can be valuable for view-only wallets from the
                same keys — it allows them to show accurate outgoing history and
                balance.
              </div>
              <div className="mt-1.5">
                <span className="font-semibold text-white/85">
                  Requested range only:
                </span>{" "}
                exports from the first output that has key-image-request flag up
                to the latest one. On regular full wallets this can be empty.
              </div>
              <div className="mt-1.5">
                <span className="font-semibold text-white/85">
                  All key images (default):
                </span>{" "}
                full export for this wallet.
              </div>
            </div>
            <ButtonsHolder>
              <Button
                type="button"
                variant="soft"
                disabled={isBusy}
                onClick={() => setIsExportModeDialogOpen(false)}
              >
                ✖ Cancel
              </Button>
              <Button
                type="button"
                variant="neutral"
                disabled={isBusy}
                onClick={() => {
                  setIsExportModeDialogOpen(false);
                  void onExportKeyImages(false);
                }}
              >
                {busyAction === "export"
                  ? "⬇︎ Exporting..."
                  : "⬇︎ Requested range only"}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={isBusy}
                onClick={() => {
                  setIsExportModeDialogOpen(false);
                  void onExportKeyImages(true);
                }}
              >
                {busyAction === "export"
                  ? "⬇︎ Exporting..."
                  : "⬇︎ All key images (default)"}
              </Button>
            </ButtonsHolder>
          </div>
        </OverlayDialog>
      )}

      {!isMultisigWallet && isImportConfirmOpen && (
        <OverlayDialog onClose={() => setIsImportConfirmOpen(false)}>
          <div className="space-y-3">
            <div className="text-base font-semibold text-white">
              ⬆︎ Import key images
            </div>
            <div className="text-sm text-white/75">
              {hasUnknownKeyImages !== true && (
                <div className="mb-2">
                  ⚠ This wallet has no missing key images, so this action is
                  pretty useless for a regular wallet. It may make sense if you
                  have a watch-only wallet and want to sync key image data.
                </div>
              )}
              <div>
                This operation is recommended to be done on a trusted daemon.
                Continue if you trust{" "}
                <span className="font-mono text-white/90">
                  {options.getValue("daemonAddress")}
                </span>
                .
              </div>
            </div>
            <ButtonsHolder>
              <Button
                type="button"
                variant="soft"
                onClick={() => setIsImportConfirmOpen(false)}
              >
                ✖ Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setIsImportConfirmOpen(false);
                  void onImportKeyImages();
                }}
              >
                ✓ Proceed
              </Button>
            </ButtonsHolder>
          </div>
        </OverlayDialog>
      )}

      {rescanState.open && (
        <OverlayDialog
          onClose={() => {
            if (!rescanState.busy) {
              setRescanState((prev) => ({ ...prev, open: false }));
            }
          }}
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void onConfirmRescan();
            }}
          >
            <div className="text-base font-semibold text-white">
              Rescan blockchain
            </div>
            <div className="text-sm text-white/75">
              This can take time and may trigger significant wallet work.
            </div>
            <Toggle
              checked={rescanState.hard}
              onChange={(next) => {
                if (rescanState.busy) return;
                setRescanState((prev) => ({ ...prev, hard: next }));
              }}
              label="hard"
              className={
                rescanState.busy ? "pointer-events-none opacity-60" : ""
              }
            />
            <Toggle
              checked={rescanState.keepKeyImages}
              onChange={(next) => {
                if (rescanState.busy) return;
                setRescanState((prev) => ({ ...prev, keepKeyImages: next }));
              }}
              label="keep_key_images"
              className={
                rescanState.busy ? "pointer-events-none opacity-60" : ""
              }
            />
            <ButtonsHolder>
              <Button
                type="button"
                variant="soft"
                disabled={rescanState.busy}
                onClick={() =>
                  setRescanState((prev) => ({ ...prev, open: false }))
                }
              >
                ✖ Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={rescanState.busy}
              >
                {rescanState.busy ? "↺ Scheduling..." : "✓ OK"}
              </Button>
            </ButtonsHolder>
          </form>
        </OverlayDialog>
      )}
      {seedState.open && (
        <FullscreenOverlayPanel>
          <div className="flex h-full w-full flex-col">
            <div className="flex items-center justify-between gap-2 pb-2">
              <div className="text-base font-semibold text-white">
                Seed and keys
              </div>
              <Button
                type="button"
                variant="soft"
                className="!flex-none px-3 py-1.5 text-xs"
                onClick={() => {
                  setSeedState({ open: false });
                }}
              >
                ✖ Close
              </Button>
            </div>

            <div className="scrollbar-glass scrollbar-hidden-mobile flex-1 space-y-3 overflow-y-auto rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
              <div className="text-[11px] text-white/50">
                Suggested restore scan start block (
                {suggestedRestoreSourceText.toLowerCase()})
              </div>
              <div className="font-mono text-sm text-white/90">
                {suggestedRestoreHeight !== null
                  ? suggestedRestoreHeight.toString()
                  : "Loading..."}
                {firstConfirmedDateText ? (
                  <span className="font-sans text-sm text-white/60">
                    {" "}
                    ({firstConfirmedDateText})
                  </span>
                ) : null}
              </div>

              {seedState.type === "loading" ? (
                <div className="text-xs text-white/60">
                  Loading seed/keys...
                </div>
              ) : seedState.type === "error" ? (
                <div className="text-xs text-red-300">{seedState.error}</div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-white/55">Seed</div>
                    {seedState.seed ? (
                      <Button
                        type="button"
                        variant="soft"
                        className="!flex-none px-2.5 py-1 text-xs"
                        onClick={() => {
                          void onCopySeed();
                        }}
                      >
                        {seedCopyState === "ok"
                          ? "✓ Copied"
                          : seedCopyState === "fail"
                            ? "✖ Copy failed"
                            : "⎘ Copy"}
                      </Button>
                    ) : null}
                  </div>
                  <TextArea
                    readOnly
                    rows={seedRows}
                    className="scrollbar-glass scrollbar-hidden-mobile font-mono text-sm leading-relaxed"
                    value={
                      seedState.seed ??
                      (seedState.seedMessage
                        ? `(${seedState.seedMessage})`
                        : "")
                    }
                  />

                  <div className="text-xs text-white/55">Address</div>
                  <TextArea
                    readOnly
                    rows={addressRows}
                    className="scrollbar-glass scrollbar-hidden-mobile font-mono text-sm leading-relaxed"
                    value={seedState.keys.address}
                  />

                  <div className="text-xs text-white/55">Private view key</div>
                  <TextArea
                    readOnly
                    rows={keyRows}
                    className="scrollbar-glass scrollbar-hidden-mobile font-mono text-sm leading-relaxed"
                    value={bytesToHex(seedState.keys.viewKey.private)}
                  />

                  <div className="text-xs text-white/55">Public view key</div>
                  <TextArea
                    readOnly
                    rows={keyRows}
                    className="scrollbar-glass scrollbar-hidden-mobile font-mono text-sm leading-relaxed"
                    value={bytesToHex(seedState.keys.viewKey.public)}
                  />

                  <div className="text-xs text-white/55">Private spend key</div>
                  <TextArea
                    readOnly
                    rows={keyRows}
                    className="scrollbar-glass scrollbar-hidden-mobile font-mono text-sm leading-relaxed"
                    value={
                      seedState.keys.spendKey.private
                        ? bytesToHex(seedState.keys.spendKey.private)
                        : "(Not available)"
                    }
                  />

                  <div className="text-xs text-white/55">Public spend key</div>
                  <TextArea
                    readOnly
                    rows={keyRows}
                    className="scrollbar-glass scrollbar-hidden-mobile font-mono text-sm leading-relaxed"
                    value={bytesToHex(seedState.keys.spendKey.public)}
                  />
                </>
              )}
            </div>
          </div>
        </FullscreenOverlayPanel>
      )}
    </div>
  );
}

function formatElapsedSince(fromMs: number, nowMs: number): string {
  const deltaSec = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (deltaSec < 60) {
    return `${deltaSec}s`;
  }
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) {
    return `${deltaMin}m`;
  }
  const deltaHours = Math.floor(deltaMin / 60);
  return `${deltaHours}h`;
}
