import React from "react";
import { refreshXmrPrice } from "./useXmrPrice";
import {
  MultisigAccountStatus,
  MoneroWasmWallet,
  PaymentDetailsTransformed,
} from "../../../monero-wasm-module/walletApi";
import {
  Button,
  ButtonsHolder,
  OverlayDialog,
  TextArea,
  Toggle,
  useAlert,
} from "../ui";
import { copyToClipboard, formatWalletTimestamp, withFsLock } from "../utils";

type SeedRevealState =
  | { type: "hidden-idle" }
  | { type: "hidden-loaded"; seed: string }
  | { type: "hidden-error"; error: string }
  | { type: "visible-loading" }
  | { type: "visible-loaded"; seed: string }
  | { type: "visible-error"; error: string };

export function OtherTab({
  onExit,
  wallet,
  onRefresh,
  lastRefreshTimestamp,
  daemonLastBlockHeight,
  multisigStatus,
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
  payments: PaymentDetailsTransformed[] | null;
  priceEur: number | null;
  priceSource: string | null;
  priceFetchedAt: number | null;
}) {
  const [seedState, setSeedState] = React.useState<SeedRevealState>({
    type: "hidden-idle",
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

  const isSeedVisible =
    seedState.type === "visible-loading" ||
    seedState.type === "visible-loaded" ||
    seedState.type === "visible-error";
  const isSeedButtonDisabled = multisigStatus === null;

  const onToggleSeed = async () => {
    if (multisigStatus === null) {
      return;
    }
    if (seedState.type === "visible-loading") {
      setSeedState({ type: "hidden-idle" });
      return;
    }
    if (seedState.type === "visible-loaded") {
      setSeedState({ type: "hidden-loaded", seed: seedState.seed });
      return;
    }
    if (seedState.type === "visible-error") {
      setSeedState({ type: "hidden-error", error: seedState.error });
      return;
    }
    if (seedState.type === "hidden-loaded") {
      setSeedState({ type: "visible-loaded", seed: seedState.seed });
      return;
    }
    if (seedState.type === "hidden-error") {
      setSeedState({ type: "visible-error", error: seedState.error });
      return;
    }

    if (multisigStatus.multisig_is_active && !multisigStatus.is_ready) {
      setSeedState({
        type: "visible-error",
        error: "Unable to get seed while multisig setup is in progress",
      });
      return;
    }

    setSeedState({ type: "visible-loading" });
    try {
      const nextSeed = multisigStatus.multisig_is_active
        ? await wallet.get_multisig_seed("")
        : await wallet.get_seed("English", "");
      setSeedState({ type: "visible-loaded", seed: nextSeed });
    } catch (e) {
      console.error("Failed to load wallet seed:", e);
      setSeedState({
        type: "visible-error",
        error: (e as Error).message || "Unknown error",
      });
    }
  };

  const onCopySeed = async () => {
    if (seedState.type !== "visible-loaded") {
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

  return (
    <div className="mt-2 space-y-3">
      <Button
        className="w-full py-2 text-sm font-semibold"
        variant="neutral"
        disabled={isSeedButtonDisabled}
        onClick={onToggleSeed}
      >
        {isSeedVisible ? "Hide seed phrase" : "Show seed phrase"}
      </Button>
      {isSeedVisible && (
        <div className="-mt-2 space-y-2 rounded-lg bg-white/6 p-2.5">
          <div className="text-[11px] text-white/50">
            Suggested restore scan start block (
            {suggestedRestoreSourceText.toLowerCase()})
          </div>
          <div className="flex items-center justify-between gap-2">
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
            <Button
              type="button"
              variant="soft"
              className="!flex-none px-2.5 py-1 text-xs"
              disabled={seedState.type !== "visible-loaded"}
              onClick={() => {
                void onCopySeed();
              }}
            >
              {seedCopyState === "ok"
                ? "Copied"
                : seedCopyState === "fail"
                  ? "Copy failed"
                  : "Copy"}
            </Button>
          </div>
          {seedState.type === "visible-loading" ? (
            <div className="text-xs text-white/60">Loading seed...</div>
          ) : seedState.type === "visible-error" ? (
            <div className="text-xs text-red-300">{seedState.error}</div>
          ) : (
            <TextArea
              readOnly
              rows={3}
              className="scrollbar-glass scrollbar-hidden-mobile font-mono text-sm leading-relaxed"
              value={
                seedState.type === "visible-loaded"
                  ? seedState.seed
                  : "Seed unavailable"
              }
            />
          )}
        </div>
      )}

      <Button
        className="w-full py-2 text-sm font-semibold"
        variant="neutral"
        onClick={onRefresh}
      >
        Refresh wallet
      </Button>
      <div className="-mt-2 rounded-lg bg-white/5 px-2.5 py-2 text-center text-xs text-white/60">
        {lastRefreshTimestamp
          ? `Last refresh: ${formatElapsedSince(lastRefreshTimestamp.getTime(), now)} ago`
          : "Last refresh: waiting for first sync"}
      </div>
      <Button
        className="w-full py-2 text-sm font-semibold"
        variant="neutral"
        onClick={onOpenRescanDialog}
      >
        Rescan blockchain
      </Button>

      <Button
        className="w-full py-2 text-sm font-semibold"
        variant="neutral"
        onClick={() => {
          refreshXmrPrice();
        }}
      >
        Refresh XMR Price
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
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={rescanState.busy}
              >
                {rescanState.busy ? "Scheduling..." : "OK"}
              </Button>
            </ButtonsHolder>
          </form>
        </OverlayDialog>
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
