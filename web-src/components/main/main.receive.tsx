import React, { useCallback, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  PaymentDetailsTransformed,
  WalletAddress,
} from "../../../monero-wasm-module/monero-wasm-wallet-async";
import {
  balanceToString,
  copyToClipboard,
  shortenAddress,
  splitAddressBy6,
  stringToBalance,
  toFiat,
} from "../utils";
import { Button, Input, SurfaceCard } from "../ui";

type ReceiveAddressesProps = {
  addresses: WalletAddress[] | null;
  payments: PaymentDetailsTransformed[] | null;
  mempoolPayments: PaymentDetailsTransformed[] | null;
  onAddSubaddressAdd: (newLabel: string) => Promise<void>;
  price: number | null;
};

function AddressRow({
  title,
  address,
  label,
  indexBadge,
  isQrOpen,
  onToggleQr,
  qrValue,
  qrAmountInput,
  onQrAmountInputChange,
  hasQrAmountError,
  qrAmount,
  price,
  totalReceivedAtomic,
  incomingTxCount,
}: {
  title: string;
  address: string;
  label?: string;
  indexBadge?: string;
  isQrOpen: boolean;
  onToggleQr: () => void;
  qrValue: string;
  qrAmountInput: string;
  onQrAmountInputChange: (value: string) => void;
  hasQrAmountError: boolean;
  qrAmount?: bigint;
  price: number | null;
  totalReceivedAtomic: bigint;
  incomingTxCount: number;
}) {
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");

  async function onCopy() {
    setCopied("idle");
    const ok = await copyToClipboard(address);
    setCopied(ok ? "ok" : "fail");
    window.setTimeout(() => setCopied("idle"), 1200);
  }
  const hasIncomingStats = totalReceivedAtomic > 0n || incomingTxCount > 0;
  const txWord = incomingTxCount === 1 ? "tx" : "txes";
  const formattedAddress = splitAddressBy6(address);

  return (
    <SurfaceCard>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-white/90">{title}</div>
            {indexBadge ? (
              <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/70 ring-1 ring-white/10">
                {indexBadge}
              </span>
            ) : null}
          </div>

          {label && (
            <div className="mt-0.5 text-xs text-white/60">
              <span className="text-white/70">{label}</span>
            </div>
          )}

          {hasIncomingStats ? (
            <div className="mt-1 text-[11px] text-white/55">
              Received {balanceToString(totalReceivedAtomic)} XMR in{" "}
              {incomingTxCount} {txWord}
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-white/50">Unused yet</div>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            onClick={onToggleQr}
            variant="primary"
            className="!flex-none rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            {isQrOpen ? <><span aria-hidden="true">✖</span>{" "}Hide QR</> : <><span aria-hidden="true">▣</span>{" "}QR</>}
          </Button>
          <Button
            type="button"
            onClick={onCopy}
            variant="primary"
            className="!flex-none rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            {copied === "ok"
              ? <><span aria-hidden="true">✓</span>{" "}Copied</>
              : copied === "fail"
                ? <><span aria-hidden="true">✖</span>{" "}Copy failed</>
                : <><span aria-hidden="true">⎘</span>{" "}Copy</>}
          </Button>
        </div>
      </div>

      {/* Wide address: read-only input with horizontal scroll */}
      <div className="relative">
        <Input
          aria-label={`${title} address`}
          readOnly
          value={formattedAddress}
          onFocus={(e) => e.currentTarget.select()}
          className="rounded-lg border-white/10 bg-black/20 py-2 font-mono text-xs text-white/85 overflow-x-auto whitespace-nowrap focus-visible:ring-white/30"
          style={
            {
              // ensures horizontal scroll works nicely in many browsers
              // WebkitTextSecurity: "none",
            }
          }
        />

        {/* Small helper showing shortened version (optional) */}
        <div className="mt-1 text-[11px] text-white/50">
          {/* some info about the address, e.g. shortened version */}
        </div>
      </div>

      {isQrOpen && (
        <div className="mt-3 flex flex-col items-center gap-2 rounded-lg bg-black/20 p-3 ring-1 ring-white/10">
          <div className="rounded-md bg-white p-2">
            <QRCodeSVG value={qrValue} size={240} />
          </div>
          <div className="text-[11px] text-white/55">
            Scan to copy address
            {qrAmount ? ` and amount (${balanceToString(qrAmount)} XMR)` : ""}
          </div>
          <div className="w-[240px] space-y-1.5 text-center">
            <div className="text-xs font-semibold text-white/75">
              Optional amount in QR (XMR)
            </div>
            <Input
              value={qrAmountInput}
              onChange={(e) => onQrAmountInputChange(e.target.value)}
              placeholder="e.g. 0.25"
              inputMode="decimal"
              className="py-2 text-center text-sm"
            />
            {hasQrAmountError ? (
              <div className="text-xs text-red-300">
                Invalid amount. Use numeric value with up to 12 decimals.
              </div>
            ) : (
              <div className="text-[11px] text-white/50">
                {formatFiatHint(qrAmount, price)}
              </div>
            )}
          </div>
        </div>
      )}
    </SurfaceCard>
  );
}

export function ReceiveAddresses({
  addresses,
  payments,
  mempoolPayments,
  onAddSubaddressAdd,
  price,
}: ReceiveAddressesProps) {
  const rows = addresses
    ? addresses
        .filter((a) => a?.address)
        .map((a) => ({
          address: a.address,
          label: a.label,
          indexMinor: a.indexMinor,
        }))
    : null;

  const incomingStatsByIndexMinor = useMemo(() => {
    const stats = new Map<number, { amount: bigint; txCount: number }>();
    const all = [...(payments || []), ...(mempoolPayments || [])];

    for (const p of all) {
      if (p.type !== "block" && p.type !== "in" && p.type !== "mempool") {
        continue;
      }
      const indexMinor = p.index_minor;
      const current = stats.get(indexMinor) || { amount: 0n, txCount: 0 };
      current.amount += p.amount;
      current.txCount += 1;
      stats.set(indexMinor, current);
    }

    return stats;
  }, [mempoolPayments, payments]);

  const [isAdding, setIsAdding] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [activeQrAddress, setActiveQrAddress] = useState<string | null>(null);
  const [qrAmountInput, setQrAmountInput] = useState("");
  const qrAmountAtomic = parseMoneroAmountAtomic(qrAmountInput);
  const hasQrAmountError =
    qrAmountInput.trim().length > 0 && qrAmountAtomic === undefined;
  const handleCreate = useCallback(() => {
    setIsAdding(true);
    onAddSubaddressAdd(newLabel)
      .then(() => {
        setIsCreating(false);
        setNewLabel("");
      })
      .catch((error) => {
        console.error("Failed to create subaddress:", error);
        alert("Failed to create subaddress. See console for details.");
      })
      .finally(() => {
        setIsAdding(false);
      });
  }, [onAddSubaddressAdd, newLabel]);

  return (
    <div className="scrollbar-glass h-auto overflow-visible pr-1 lg:h-full lg:min-h-0 lg:overflow-auto">
      <div className="space-y-3 pb-2">
        {rows && rows.length > 0 ? (
          <div className="pt-1">
            <div className="space-y-3">
              {rows.map((a, i) => (
                <AddressRow
                  key={`${a.address}-${i}`}
                  title={
                    a.indexMinor === 0
                      ? "Primary address"
                      : a.label
                        ? `${a.label} (#${a.indexMinor})`
                        : `Subaddress #${a.indexMinor}`
                  }
                  address={a.address}
                  label={shortenAddress(a.address)}
                  totalReceivedAtomic={
                    incomingStatsByIndexMinor.get(a.indexMinor)?.amount || 0n
                  }
                  incomingTxCount={
                    incomingStatsByIndexMinor.get(a.indexMinor)?.txCount || 0
                  }
                  isQrOpen={activeQrAddress === a.address}
                  onToggleQr={() =>
                    setActiveQrAddress((current) =>
                      current === a.address ? null : a.address,
                    )
                  }
                  qrValue={buildMoneroQrValue(a.address, qrAmountAtomic)}
                  qrAmountInput={qrAmountInput}
                  onQrAmountInputChange={setQrAmountInput}
                  hasQrAmountError={hasQrAmountError}
                  qrAmount={qrAmountAtomic}
                  price={price}
                />
              ))}
            </div>
          </div>
        ) : (
          <SurfaceCard className="text-xs text-white/60">
            {rows === null ? "Loading addresses..." : "No addresses yet."}
          </SurfaceCard>
        )}

        <div className="pt-2">
          {!isCreating ? (
            <Button
              onClick={() => setIsCreating(true)}
              variant="primary"
              className="w-full text-sm font-semibold"
            >
              + Add subaddress
            </Button>
          ) : (
            <SurfaceCard className="space-y-3">
              <div className="text-sm font-semibold text-white/90">
                New subaddress
              </div>

              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Optional label (e.g. Donations)"
                className="rounded-lg border-white/10 bg-black/20 py-2 text-sm text-white/85 placeholder-white/40 focus-visible:ring-white/30"
              />

              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    setIsCreating(false);
                    setNewLabel("");
                  }}
                  disabled={isAdding}
                  variant="soft"
                  className="rounded-lg py-2 text-sm font-semibold"
                >
                  × Cancel
                </Button>

                <Button
                  onClick={handleCreate}
                  disabled={isAdding}
                  variant="primary"
                  className="rounded-lg py-2 text-sm font-semibold"
                >
                  {isAdding ? "Generating..." : "+ Create"}
                </Button>
              </div>
            </SurfaceCard>
          )}
        </div>
      </div>
    </div>
  );
}

function buildMoneroQrValue(address: string, amount?: bigint): string {
  if (!amount) {
    return address;
  }
  return `monero:${address}?tx_amount=${encodeURIComponent(balanceToString(amount))}`;
}

function parseMoneroAmountAtomic(value: string): bigint | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return stringToBalance(trimmed);
  } catch {
    return undefined;
  }
}

function formatFiatHint(
  amount: bigint | undefined,
  price: number | null,
): string {
  if (!amount) {
    return "";
  }
  if (!price) {
    return `${balanceToString(amount)} XMR`;
  }
  return `≈ ${toFiat(amount, price).toFixed(2)} EUR`;
}
