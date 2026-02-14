import React, { useCallback, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { balanceToString, shortenAddress, stringToBalance, toFiat } from "../utils";
import { Button, Input, SurfaceCard } from "../ui";

type AddressItem = {
  address: string; // full Monero address
  label?: string; // optional
};

type ReceiveAddressesProps = {
  primaryAddress: string; // starts with "4"
  secondaryAddresses?: AddressItem[]; // 0..many
  onAddSubaddressAdd: (newLabel: string) => Promise<void>;
  price: number | null;
};

async function copyToClipboard(text: string) {
  // navigator.clipboard can fail on non-https / some embedded contexts
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

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
}) {
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");

  async function onCopy() {
    setCopied("idle");
    const ok = await copyToClipboard(address);
    setCopied(ok ? "ok" : "fail");
    window.setTimeout(() => setCopied("idle"), 1200);
  }

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
        </div>

        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            onClick={onToggleQr}
            variant="primary"
            className="!flex-none rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            {isQrOpen ? "Hide QR" : "QR"}
          </Button>
          <Button
            type="button"
            onClick={onCopy}
            variant="primary"
            className="!flex-none rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          >
            {copied === "ok" ? "Copied" : copied === "fail" ? "Copy failed" : "Copy"}
          </Button>
        </div>
      </div>

      {/* Wide address: read-only input with horizontal scroll */}
      <div className="relative">
        <Input
          readOnly
          value={address}
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
            Scan to copy address{qrAmount ? ` and amount (${balanceToString(qrAmount)} XMR)` : ""}
          </div>
          <div className="w-[240px] space-y-1.5 text-center">
            <div className="text-xs font-semibold text-white/75">Optional amount in QR (XMR)</div>
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
              <div className="text-[11px] text-white/50">{formatFiatHint(qrAmount, price)}</div>
            )}
          </div>
        </div>
      )}
    </SurfaceCard>
  );
}

export function ReceiveAddresses({
  primaryAddress,
  secondaryAddresses,
  onAddSubaddressAdd,
  price,
}: ReceiveAddressesProps) {
  const rows = useMemo(() => {
    const cleanedSecondary = secondaryAddresses
      ?.filter((a) => a?.address?.trim())
      ?.map((a) => ({ address: a.address.trim(), label: a.label }));

    return cleanedSecondary;
  }, [secondaryAddresses]);

  const [isAdding, setIsAdding] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [activeQrAddress, setActiveQrAddress] = useState<string | null>(null);
  const [qrAmountInput, setQrAmountInput] = useState("");
  const qrAmountAtomic = parseMoneroAmountAtomic(qrAmountInput);
  const hasQrAmountError = qrAmountInput.trim().length > 0 && qrAmountAtomic === undefined;
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
        <AddressRow
          title="Primary address"
          address={primaryAddress}
          label={shortenAddress(primaryAddress)}
          isQrOpen={activeQrAddress === primaryAddress}
          onToggleQr={() =>
            setActiveQrAddress((current) => (current === primaryAddress ? null : primaryAddress))
          }
          qrValue={buildMoneroQrValue(primaryAddress, qrAmountAtomic)}
          qrAmountInput={qrAmountInput}
          onQrAmountInputChange={setQrAmountInput}
          hasQrAmountError={hasQrAmountError}
          qrAmount={qrAmountAtomic}
          price={price}
        />

        {rows && rows.length > 0 ? (
          <div className="pt-1">
            {/*
            <div className="mb-2 text-xs font-semibold text-white/70">
              Subaddresses ({rows.length})
            </div>
              */}
            <div className="space-y-3">
              {rows.map((a, i) => (
                <AddressRow
                  key={`${a.address}-${i}`}
                  title={a.label || `Subaddress #${i + 1}`}
                  address={a.address}
                  label={shortenAddress(a.address)}
                  isQrOpen={activeQrAddress === a.address}
                  onToggleQr={() =>
                    setActiveQrAddress((current) => (current === a.address ? null : a.address))
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
            {rows === null ? "Loading subaddresses..." : "No subaddresses yet."}
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
              <div className="text-sm font-semibold text-white/90">New subaddress</div>

              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Optional label (e.g. Donations)"
                className="rounded-lg border-white/10 bg-black/20 py-2 text-sm text-white/85 placeholder-white/40 focus-visible:ring-white/30"
              />

              <div className="flex gap-2">
                <Button
                  onClick={handleCreate}
                  disabled={isAdding}
                  variant="primary"
                  className="rounded-lg py-2 text-sm font-semibold"
                >
                  {isAdding ? "Generating..." : "+ Create"}
                </Button>

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

function formatFiatHint(amount: bigint | undefined, price: number | null): string {
  if (!amount) {
    return "";
  }
  if (!price) {
    return `${balanceToString(amount)} XMR`;
  }
  return `≈ ${toFiat(amount, price).toFixed(2)} EUR`;
}
