import React from "react";
import { refreshXmrPrice } from "./useXmrPrice";
import {
  MoneroWasmWallet,
  PaymentDetailsTransformed,
} from "../../../monero-wasm-module/walletApi";
import { Button, TextArea } from "../ui";
import { formatWalletTimestamp } from "../utils";

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
  payments: PaymentDetailsTransformed[] | null;
  priceEur: number | null;
  priceSource: string | null;
  priceFetchedAt: number | null;
}) {
  const [seedState, setSeedState] = React.useState<SeedRevealState>({
    type: "hidden-idle",
  });
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!priceFetchedAt) {
      return;
    }
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

  const onToggleSeed = async () => {
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

    setSeedState({ type: "visible-loading" });
    try {
      const nextSeed = await wallet.get_seed("English", "");
      setSeedState({ type: "visible-loaded", seed: nextSeed });
    } catch (e) {
      console.error("Failed to load wallet seed:", e);
      setSeedState({
        type: "visible-error",
        error: (e as Error).message || "Unknown error",
      });
    }
  };

  return (
    <div className="mt-2 space-y-3">
      <Button
        className="w-full py-2 text-sm font-semibold"
        variant="neutral"
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
          <div className="font-mono text-sm text-white/90">
            {suggestedRestoreHeight !== null
              ? suggestedRestoreHeight.toString()
              : "Loading..."}
            {firstConfirmedDateText ? (
              <span className="font-sans text-xs text-white/60">
                , {firstConfirmedDateText}
              </span>
            ) : null}
          </div>
          {seedState.type === "visible-loading" ? (
            <div className="text-xs text-white/60">Loading seed...</div>
          ) : seedState.type === "visible-error" ? (
            <div className="text-xs text-red-300">{seedState.error}</div>
          ) : (
            <TextArea
              readOnly
              rows={3}
              className="font-mono text-sm leading-relaxed"
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
          ? `Last refresh: ${lastRefreshTimestamp.toLocaleTimeString()}`
          : "Last refresh: waiting for first sync"}
      </div>

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
