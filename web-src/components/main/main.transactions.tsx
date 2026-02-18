import {
  CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE,
  PaymentDetailsTransformed,
  WalletAddress,
} from "../../../monero-wasm-module/walletApi";
import React from "react";
import {
  balanceToString,
  formatWalletTimestamp,
  splitAddressBy6,
  toFiat,
} from "../utils";
import { SurfaceCard } from "../ui";

export function TransactionsTab({
  payments,
  mempoolPayments,
  addresses,
  price,
  daemonLastBlockHeight,
}: {
  mempoolPayments: PaymentDetailsTransformed[] | null;
  payments: PaymentDetailsTransformed[] | null;
  addresses: WalletAddress[] | null;
  price: number | null;
  daemonLastBlockHeight: bigint | null;
}) {
  const [expandedIndexFromEnd, setExpandedIndexFromEnd] = React.useState<
    number | null
  >(null);
  const allPayments = React.useMemo(
    () => (payments ? [...(mempoolPayments || []), ...payments] : null),
    [mempoolPayments, payments],
  );
  const addressByMinor = React.useMemo(() => {
    const map = new Map<number, WalletAddress>();
    for (const item of addresses || []) {
      map.set(item.indexMinor, item);
    }
    return map;
  }, [addresses]);

  return (
    <div className="scrollbar-glass h-auto overflow-visible pr-1 lg:h-full lg:min-h-0 lg:overflow-auto">
      {allPayments === null ? (
        <SurfaceCard className="text-xs text-white/60">
          Loading transactions...
        </SurfaceCard>
      ) : allPayments.length === 0 ? (
        <SurfaceCard className="text-xs text-white/60">
          No transactions yet.
        </SurfaceCard>
      ) : (
        <div className="space-y-3">
          {allPayments.map((p, i) => {
            const lockStateText = getLockStateText(p, daemonLastBlockHeight);
            const indexFromEnd = allPayments.length - i - 1;
            const isExpanded = expandedIndexFromEnd === indexFromEnd;
            const incomingAddress = addressByMinor.get(p.index_minor);
            const incomingLabel =
              p.index_minor === 0
                ? "Primary address"
                : incomingAddress?.label || `Subaddress #${p.index_minor}`;
            const fromOrToText =
              p.type === "out" || p.type === "failed" || p.type === "pending"
                ? p.destinations.length > 0
                  ? p.destinations
                      .map(
                        (d) =>
                          d.address.slice(0, 8) + "..." + d.address.slice(-8),
                      )
                      .join(", ")
                  : /* 
                  TODO: why is this empty? Why we do not know the destination address?
                  It might be that restored wallets do not have the destination address
                  */ ""
                : incomingLabel;
            const typeTone = getTypeToneClass(p.type);
            const amountTone = getAmountToneClass(p.type);
            const isOutgoing =
              p.type === "out" || p.type === "pending" || p.type === "failed";
            const confirmationsText = getConfirmationsText(
              p,
              daemonLastBlockHeight,
            );

            return (
              <SurfaceCard
                key={`${p.tx_hash}-${indexFromEnd}`}
                className="py-2.5"
                onClick={() =>
                  setExpandedIndexFromEnd((prev) =>
                    prev === indexFromEnd ? prev : indexFromEnd,
                  )
                }
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
                  <div className="min-w-0 space-y-1 text-xs text-white/70">
                    <div className="flex flex-wrap items-center gap-1.5 text-white/65">
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${typeTone}`}
                      >
                        {getTypeLabel(p.type)}
                      </span>
                      {lockStateText ? (
                        <span className="rounded-md bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-200 ring-1 ring-amber-400/20">
                          {lockStateText}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-white/65">
                      <span className="whitespace-nowrap">
                        {formatWalletTimestamp(p.timestamp, {
                          hideDateIfToday: true,
                          hideCurrentYear: true,
                        })}
                      </span>
                      {p.fee > 0n && (
                        <span className="whitespace-nowrap text-white/50">
                          fee {balanceToString(p.fee)} XMR
                        </span>
                      )}
                    </div>
                    <div
                      className="truncate text-white/70"
                      title={fromOrToText}
                    >
                      {fromOrToText}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className={`text-sm font-semibold ${amountTone}`}>
                      {isOutgoing ? "-" : "+"}
                      {balanceToString(p.amount)} XMR
                    </div>
                    <div className="text-xs text-white/50">
                      {price
                        ? `~${toFiat(p.amount, price).toFixed(2)} EUR`
                        : "Fiat unavailable"}
                    </div>
                    {confirmationsText && (
                      <div className="text-[11px] text-white/45">
                        {confirmationsText}
                      </div>
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <div className="mt-2.5 border-t border-white/10 pt-2.5 text-xs text-white/70">
                    {p.tx_hash.trim() && (
                      <div className="break-all whitespace-normal">
                        <span className="text-white/45">Tx hash:</span>{" "}
                        {p.tx_hash}
                      </div>
                    )}
                    {(p.type === "in" ||
                      p.type === "mempool" ||
                      p.type === "block") && (
                      <div className="mt-1 break-all whitespace-normal">
                        <span className="text-white/45">Address:</span>{" "}
                        {incomingAddress?.address
                          ? splitAddressBy6(incomingAddress.address)
                          : "unknown"}
                        <span className="text-white/45">
                          {" "}
                          ({incomingLabel})
                        </span>
                      </div>
                    )}
                    {(p.type === "out" ||
                      p.type === "failed" ||
                      p.type === "pending") &&
                      p.destinations.length > 0 && (
                        <div className="mt-1">
                          <div className="text-white/45">Destinations:</div>
                          {p.destinations.map((d, destI) => (
                            <div
                              key={`${d.address}-${destI}`}
                              className="break-all whitespace-normal"
                            >
                              {splitAddressBy6(d.address)}
                            </div>
                          ))}
                        </div>
                      )}
                    {p.note.trim() && (
                      <div className="mt-1 break-all whitespace-normal">
                        <span className="text-white/45">Note:</span> {p.note}
                      </div>
                    )}
                    <div className="mt-1">
                      <span className="text-white/45">Block:</span>{" "}
                      {p.block_height.toString()}
                    </div>
                  </div>
                )}
              </SurfaceCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getConfirmationsText(
  p: PaymentDetailsTransformed,
  daemonLastBlockHeight: bigint | null,
): string {
  if (p.type === "pending" || p.type === "mempool") {
    return "";
  }
  if (p.block_height < 0n) {
    return `Block ${p.block_height.toString()}`;
  }
  if (daemonLastBlockHeight === null) {
    return "";
  }

  const confirmations = daemonLastBlockHeight - p.block_height;
  if (confirmations < 0n) {
    return `Block ${p.block_height.toString()}`;
  }
  return `${confirmations.toString()} confirmations`;
}

function getLockStateText(
  p: PaymentDetailsTransformed,
  daemonLastBlockHeight: bigint | null,
): string {
  if (p.type === "pending" || p.type === "mempool") {
    return "";
  }

  const blockSinceConfirmed =
    (p.type === "in" || p.type === "out") &&
    daemonLastBlockHeight !== null &&
    p.block_height <= daemonLastBlockHeight
      ? daemonLastBlockHeight - p.block_height
      : null;

  if (
    p.is_unlocked ||
    (blockSinceConfirmed !== null &&
      blockSinceConfirmed > CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE)
  ) {
    return "";
  }

  if (blockSinceConfirmed !== null) {
    return `${blockSinceConfirmed}/${CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE}`;
  }

  return `0/${CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE}`;
}

function getTypeLabel(type: PaymentDetailsTransformed["type"]): string {
  if (type === "in") return "Incoming";
  if (type === "out") return "Outgoing";
  if (type === "pending") return "Pending";
  if (type === "mempool") return "Mempool In";
  if (type === "failed") return "Failed";
  if (type === "block") return "Mined";
  return type;
}

function getTypeToneClass(type: PaymentDetailsTransformed["type"]): string {
  if (type === "in" || type === "mempool" || type === "block") {
    return "bg-emerald-500/10 text-emerald-200 ring-emerald-300/20";
  }
  if (type === "out" || type === "pending") {
    return "bg-blue-500/10 text-blue-200 ring-blue-300/20";
  }
  if (type === "failed") {
    return "bg-red-500/10 text-red-200 ring-red-300/20";
  }
  return "bg-white/10 text-white/80 ring-white/20";
}

function getAmountToneClass(type: PaymentDetailsTransformed["type"]): string {
  if (type === "in" || type === "mempool" || type === "block")
    return "text-emerald-300";
  if (type === "failed") return "text-red-300";
  return "text-white";
}
