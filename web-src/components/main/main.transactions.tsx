import {
  CRYPTONOTE_DEFAULT_TX_SPENDABLE_AGE,
  MoneroWasmWallet,
  PaymentDetailsTransformed,
  WalletAddress,
} from "../../../monero-wasm-module/walletApi";
import React from "react";
import {
  balanceToString,
  downloadBlob,
  formatWalletTimestamp,
  splitAddressBy6,
  toFiat,
} from "../utils";
import {
  Button,
  ButtonsHolder,
  Input,
  OverlayDialog,
  SurfaceCard,
  TextArea,
  useAlert,
} from "../ui";

type PaymentProofState =
  | {
      type: "proof";
      txid: string;
      address: string;
      proof: string;
      loading: boolean;
    }
  | {
      type: "tx-key";
      txid: string;
      address: string;
      keysString: string;
      loading: boolean;
    };

export function TransactionsTab({
  wallet,
  payments,
  mempoolPayments,
  addresses,
  price,
  daemonLastBlockHeight,
}: {
  wallet: MoneroWasmWallet;
  mempoolPayments: PaymentDetailsTransformed[] | null;
  payments: PaymentDetailsTransformed[] | null;
  addresses: WalletAddress[] | null;
  price: number | null;
  daemonLastBlockHeight: bigint | null;
}) {
  const alert = useAlert();
  const [expandedIndexFromEnd, setExpandedIndexFromEnd] = React.useState<
    number | null
  >(null);
  const [paymentProofState, setPaymentProofState] =
    React.useState<PaymentProofState | null>(null);

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

  const onExportProof = React.useCallback(
    async (txid: string, address: string) => {
      setPaymentProofState({
        type: "proof",
        txid,
        address,
        proof: "",
        loading: true,
      });
      try {
        const proof = await wallet.get_tx_proof(txid, address, "");
        setPaymentProofState({
          type: "proof",
          txid,
          address,
          proof,
          loading: false,
        });
      } catch (e) {
        setPaymentProofState(null);
        await alert((e as Error).message || "Failed to generate payment proof");
      }
    },
    [alert, wallet],
  );

  const onGetTxKey = React.useCallback(
    async (txid: string, address: string) => {
      setPaymentProofState({
        type: "tx-key",
        txid,
        address,
        keysString: "",
        loading: true,
      });
      try {
        const keysString = await wallet.get_tx_key(txid);
        setPaymentProofState({
          type: "tx-key",
          txid,
          address,
          keysString,
          loading: false,
        });
      } catch (e) {
        setPaymentProofState(null);
        await alert((e as Error).message || "Failed to get tx key");
      }
    },
    [alert, wallet],
  );

  const onDownloadProof = React.useCallback(async () => {
    if (
      !paymentProofState ||
      paymentProofState.type !== "proof" ||
      paymentProofState.loading ||
      !paymentProofState.proof
    ) {
      return;
    }
    const blob = new Blob([paymentProofState.proof], {
      type: "text/plain;charset=utf-8",
    });
    downloadBlob(blob, `tx-proof-${paymentProofState.txid}.txt`);
    await alert("Payment proof download started");
  }, [alert, paymentProofState]);

  const onOpenInMoneroCom = React.useCallback(() => {
    if (
      !paymentProofState ||
      paymentProofState.type !== "tx-key" ||
      paymentProofState.loading ||
      !paymentProofState.keysString
    ) {
      return;
    }

    const url = `https://monero.com/payment/${encodeURIComponent(
      paymentProofState.txid,
    )}/${encodeURIComponent(paymentProofState.address)}/${encodeURIComponent(
      paymentProofState.keysString,
    )}/`;
    window.open(url, "_blank", "noopener,noreferrer");
    setPaymentProofState(null);
  }, [paymentProofState]);

  return (
    <>
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
                    Answer: It might be that restored wallets do not have the destination address
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
                          <div className="mt-2">
                            <div className="text-white/45">Destinations:</div>
                            <div className="mt-1.5 space-y-1.5">
                              {p.destinations.map((d, destI) => (
                                <div
                                  key={`${d.address}-${destI}`}
                                  className="rounded-lg border border-white/10 bg-white/4 px-2.5 py-2"
                                >
                                  <div
                                    className="break-all whitespace-normal text-white/80"
                                    title={d.address}
                                  >
                                    {splitAddressBy6(d.address)}
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
                                    <span className="text-white/45">
                                      Amount:
                                    </span>
                                    <span className="font-semibold text-white/90">
                                      {balanceToString(d.amount)} XMR
                                    </span>
                                    <button
                                      className="ml-1 cursor-pointer text-cyan-300 underline decoration-cyan-300/60 underline-offset-2 transition hover:text-cyan-200 disabled:cursor-not-allowed disabled:text-white/35 disabled:no-underline"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void onExportProof(
                                          p.tx_hash,
                                          d.address,
                                        );
                                      }}
                                      disabled={!p.tx_hash.trim()}
                                      type="button"
                                    >
                                      Export proof
                                    </button>
                                    <button
                                      className="ml-1 cursor-pointer text-cyan-300 underline decoration-cyan-300/60 underline-offset-2 transition hover:text-cyan-200 disabled:cursor-not-allowed disabled:text-white/35 disabled:no-underline"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void onGetTxKey(p.tx_hash, d.address);
                                      }}
                                      disabled={!p.tx_hash.trim()}
                                      type="button"
                                    >
                                      Get tx key
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      {p.note.trim() && (
                        <div className="mt-1 break-all whitespace-normal">
                          <span className="text-white/45">Note:</span> {p.note}
                        </div>
                      )}
                      {p.block_height > 0n && (
                        <div className="mt-1">
                          <span className="text-white/45">Block:</span>{" "}
                          {p.block_height.toString()}
                        </div>
                      )}
                    </div>
                  )}
                </SurfaceCard>
              );
            })}
          </div>
        )}
      </div>
      {paymentProofState?.type === "proof" && (
        <OverlayDialog onClose={() => setPaymentProofState(null)}>
          <div className="space-y-3">
            <div className="text-base font-semibold text-white">
              Export payment proof
            </div>
            {paymentProofState.loading ? (
              <div className="text-xs text-white/60">
                Generating payment proof...
              </div>
            ) : (
              <>
                <div className="space-y-1 text-xs text-white/70">
                  <div className="text-white/45">tx</div>
                  <Input
                    readOnly
                    value={paymentProofState.txid}
                    className="bg-white/[0.04] py-2 font-mono text-xs text-white/90"
                  />
                </div>
                <div className="space-y-1 text-xs text-white/70">
                  <div className="text-white/45">address</div>
                  <Input
                    readOnly
                    value={paymentProofState.address}
                    className="bg-white/[0.04] py-2 font-mono text-xs text-white/90"
                  />
                </div>
                <div className="space-y-1 text-xs text-white/70">
                  <div className="text-white/45">payment proof</div>
                  <TextArea
                    readOnly
                    value={paymentProofState.proof}
                    className="scrollbar-glass h-40 resize-none overflow-y-auto bg-white/[0.04] py-2 font-mono text-xs text-white/90"
                    spellCheck={false}
                  />
                </div>
              </>
            )}
            <ButtonsHolder>
              <Button
                type="button"
                variant="soft"
                onClick={() => setPaymentProofState(null)}
              >
                Close
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  void onDownloadProof();
                }}
                disabled={paymentProofState.loading || !paymentProofState.proof}
              >
                Download tx proof
              </Button>
            </ButtonsHolder>
          </div>
        </OverlayDialog>
      )}
      {paymentProofState?.type === "tx-key" && (
        <OverlayDialog onClose={() => setPaymentProofState(null)}>
          <div className="space-y-3">
            <div className="text-base font-semibold text-white">Get tx key</div>
            {paymentProofState.loading ? (
              <div className="text-xs text-white/60">Loading tx key...</div>
            ) : (
              <>
                <div className="space-y-1 text-xs text-white/70">
                  <div className="text-white/45">tx</div>
                  <Input
                    readOnly
                    value={paymentProofState.txid}
                    className="bg-white/[0.04] py-2 font-mono text-xs text-white/90"
                  />
                </div>
                <div className="space-y-1 text-xs text-white/70">
                  <div className="text-white/45">address</div>
                  <Input
                    readOnly
                    value={paymentProofState.address}
                    className="bg-white/[0.04] py-2 font-mono text-xs text-white/90"
                  />
                </div>
                <div className="space-y-1 text-xs text-white/70">
                  <div className="text-white/45">keysstring</div>
                  <TextArea
                    readOnly
                    value={paymentProofState.keysString}
                    className="scrollbar-glass h-28 resize-none overflow-y-auto bg-white/[0.04] py-2 font-mono text-xs text-white/90"
                    spellCheck={false}
                  />
                </div>
              </>
            )}
            <ButtonsHolder>
              <Button
                type="button"
                variant="soft"
                onClick={() => setPaymentProofState(null)}
              >
                close
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={onOpenInMoneroCom}
                disabled={
                  paymentProofState.loading || !paymentProofState.keysString
                }
              >
                open in monero.com
              </Button>
            </ButtonsHolder>
          </div>
        </OverlayDialog>
      )}
    </>
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
