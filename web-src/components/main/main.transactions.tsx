import {
  CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE,
  PaymentDetailsTransformed,
  WalletAddress,
} from "../../../monero-wasm-module/walletApi";
import React from "react";
import { balanceToString, formatWalletTimestamp, toFiat } from "../utils";
import { MonoScrollPanel, SurfaceCard } from "../ui";

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
  const allPayments = React.useMemo(
    () => (payments ? [...(mempoolPayments || []), ...payments] : null),
    [mempoolPayments, payments],
  );
  const addressLabelByMinor = React.useMemo(() => {
    const map = new Map<number, string>();
    for (const item of addresses || []) {
      map.set(item.indexMinor, item.label);
    }
    return map;
  }, [addresses]);

  return (
    <MonoScrollPanel>
      {allPayments === null ? (
        "Loading transactions..."
      ) : allPayments.length === 0 ? (
        "No transactions yet"
      ) : (
        <div className="space-y-3">
          {allPayments.map((p, i) => {
            const lockStateText = getLockStateText(p, daemonLastBlockHeight);
            const fromOrToText =
              p.type === "out"
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
                : p.index_minor === 0
                  ? "Primary address"
                  : addressLabelByMinor.get(p.index_minor) ||
                    `Subaddress #${p.index_minor}`;
            const typeTone = getTypeToneClass(p.type);
            const amountTone = getAmountToneClass(p.type);
            const isOutgoing =
              p.type === "out" || p.type === "pending" || p.type === "failed";
            const blockText =
              p.type === "pending" || p.type === "mempool"
                ? ""
                : p.block_height > 0n
                  ? p.block_height.toString()
                  : "";

            return (
              <SurfaceCard key={`${p.tx_hash}-${i}`} className="py-2.5">
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
                    {blockText && (
                      <div className="text-[11px] text-white/45">
                        Block {blockText}
                      </div>
                    )}
                  </div>
                </div>
              </SurfaceCard>
            );
          })}
        </div>
      )}
    </MonoScrollPanel>
  );
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
    return `${blockSinceConfirmed + 1n}/${CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE}`;
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
