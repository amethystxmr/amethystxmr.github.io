import React from "react";
import {
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import {
  balanceToString,
  splitAddressBy6,
  stringToBalance,
  toFiat,
} from "../utils";
import {
  Button,
  ButtonsHolder,
  Input,
  Label,
  Select,
  ShimmerStatus,
  SurfaceCard,
} from "../ui";
import {
  FeePriority,
  MoneroWasmWallet,
  PendingTxHandle,
  type FeePriority as FeePriorityValue,
} from "../../../monero-wasm-module/walletApi";

type SendState =
  | { type: "entering" }
  | { type: "estimating" }
  | { type: "confirming"; fee: bigint; txHandle: PendingTxHandle }
  | { type: "sending"; fee: bigint; txHandle: PendingTxHandle }
  | { type: "sent"; txFee: bigint }
  | { type: "error"; message: string };

type CameraState = {
  didProbe: boolean;
  deviceIds: string[];
  activeDeviceId: string | undefined;
  torchAvailable: boolean;
  torchOn: boolean;
  torchBusy: boolean;
};

const INITIAL_CAMERA_STATE: CameraState = {
  didProbe: false,
  deviceIds: [],
  activeDeviceId: undefined,
  torchAvailable: false,
  torchOn: false,
  torchBusy: false,
};

const FEE_PRIORITY_LABELS = {
  [FeePriority.Default]: "Default",
  [FeePriority.Unimportant]: "Unimportant",
  [FeePriority.Normal]: "Normal",
  [FeePriority.Elevated]: "Elevated",
  [FeePriority.Priority]: "Priority",
} satisfies Record<FeePriorityValue, string>;

const FEE_PRIORITY_OPTIONS = (
  Object.values(FeePriority) as FeePriorityValue[]
).map((priority) => ({
  value: String(priority),
  label: FEE_PRIORITY_LABELS[priority],
}));

function parseXmrToAtomic(value: string): bigint | null {
  if (!value.trim()) return null;
  if (!/^\d*\.?\d*$/.test(value)) return null;

  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > 12) return null;

  const paddedFraction = fraction.padEnd(12, "0");

  try {
    return BigInt(whole || "0") * 10n ** 12n + BigInt(paddedFraction || "0");
  } catch {
    return null;
  }
}

function formatAtomicToXmr(amount: bigint): string {
  const whole = amount / 10n ** 12n;
  const fraction = (amount % 10n ** 12n).toString().padStart(12, "0");
  return `${whole}.${fraction.replace(/0+$/, "") || "0"}`;
}

export function SendTab({
  wallet,
  scheduleRefresh,
  price,
}: {
  wallet: MoneroWasmWallet;
  scheduleRefresh: () => void;
  price: number | null;
}) {
  const [address, setAddress] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [feePriority, setFeePriority] = React.useState<FeePriorityValue>(
    FeePriority.Default,
  );
  const [state, setState] = React.useState<SendState>({ type: "entering" });
  const [scannerOpen, setScannerOpen] = React.useState(false);
  const [scannerError, setScannerError] = React.useState<string | null>(null);
  const [cameraState, setCameraState] =
    React.useState<CameraState>(INITIAL_CAMERA_STATE);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = React.useRef<IScannerControls | null>(null);

  const parsedAmount = React.useMemo(() => parseXmrToAtomic(amount), [amount]);
  const normalizedAddress = React.useMemo(
    () => address.replace(/\s+/g, "").trim(),
    [address],
  );
  const fiatValue = parsedAmount && price ? toFiat(parsedAmount, price) : null;

  const isValid =
    normalizedAddress.length > 20 &&
    parsedAmount !== null &&
    parsedAmount > 0n &&
    state.type === "entering";

  async function handleCreateTx() {
    if (!parsedAmount) return;
    if (state.type !== "entering") {
      throw new Error("Invalid state for creating transaction");
    }

    setState({ type: "estimating" });
    wallet.transfer_prepare(normalizedAddress, parsedAmount, feePriority).then(
      (txHandle) => {
        const fee = wallet.transfer_get_fee(txHandle);
        setState({ type: "confirming", fee, txHandle });
      },
      (e) => {
        setState({
          type: "error",
          message: (e as Error).message ?? "Failed to estimate fee",
        });
      },
    );
  }

  async function handleSend() {
    if (state.type !== "confirming") {
      throw new Error("Invalid state for sending transaction");
    }
    setState({ type: "sending", fee: state.fee, txHandle: state.txHandle });
    wallet
      .transfer_commit_tx(state.txHandle)
      .then(() => {
        setState({ type: "sent", txFee: state.fee });
        scheduleRefresh();
      })
      .catch((e) => {
        setState({
          type: "error",
          message: (e as Error).message ?? "Transaction failed",
        });
      })
      .finally(() => {
        state.txHandle.delete();
      });
  }

  function reset() {
    setAddress("");
    setAmount("");
    setFeePriority(FeePriority.Default);
    setState({ type: "entering" });
    setScannerOpen(false);
    setScannerError(null);
    setCameraState(INITIAL_CAMERA_STATE);
  }

  React.useEffect(() => {
    if (!scannerOpen) {
      return;
    }
    let cancelled = false;
    void (async () => {
      let tempStream: MediaStream | null = null;
      try {
        tempStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) {
          return;
        }
        const videoInputs = devices.filter((d) => d.kind === "videoinput");
        const deviceIds = videoInputs
          .map((d) => d.deviceId)
          .filter((id) => id.length > 0);
        const preferredEnvDeviceId = videoInputs.find((d) =>
          /(back|rear|environment)/i.test(d.label),
        )?.deviceId;
        setCameraState((prev) => ({
          ...prev,
          didProbe: true,
          deviceIds,
          activeDeviceId:
            deviceIds.length === 0
              ? undefined
              : prev.activeDeviceId && deviceIds.includes(prev.activeDeviceId)
                ? prev.activeDeviceId
                : preferredEnvDeviceId && deviceIds.includes(preferredEnvDeviceId)
                  ? preferredEnvDeviceId
                  : deviceIds[0],
        }));
      } catch (e) {
        console.error("Failed to probe camera devices:", e);
        if (!cancelled) {
          setScannerError((e as Error).message || "Cannot access camera.");
          setCameraState((prev) => ({
            ...prev,
            didProbe: true,
          }));
        }
      } finally {
        tempStream?.getTracks().forEach((track) => track.stop());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scannerOpen]);

  React.useEffect(() => {
    if (!scannerOpen) {
      return;
    }
    if (!cameraState.didProbe) {
      return;
    }

    const videoElement = videoRef.current;
    if (!videoElement) {
      setScannerError("Camera preview is not available.");
      return;
    }

    setScannerError(null);
    setCameraState((prev) => ({
      ...prev,
      torchOn: false,
      torchAvailable: false,
    }));
    let isClosed = false;
    const reader = new BrowserMultiFormatReader();

    reader
      .decodeFromVideoDevice(cameraState.activeDeviceId, videoElement, (result) => {
        if (isClosed || !result) {
          return;
        }
        const parsed = parseMoneroQrPayload(result.getText());
        if (!parsed) {
          setScannerError(
            "Unsupported QR format. Expected Monero address or monero: URI.",
          );
          return;
        }
        setAddress(parsed.address);
        if (parsed.amount) {
          setAmount(parsed.amount);
        }
        setScannerOpen(false);
        setScannerError(null);
      })
      .then((controls) => {
        if (isClosed) {
          controls.stop();
          return;
        }
        scannerControlsRef.current = controls;
        const capabilities =
          controls.streamVideoCapabilitiesGet?.((track) => [track]) ?? null;
        const hasTorchCapability =
          !!capabilities &&
          "torch" in capabilities &&
          capabilities.torch === true;
        setCameraState((prev) => ({
          ...prev,
          torchAvailable:
            hasTorchCapability && typeof controls.switchTorch === "function",
        }));
      })
      .catch((e) => {
        console.error("Failed to start QR scanner:", e);
        setScannerError((e as Error).message || "Cannot access camera.");
      });

    return () => {
      isClosed = true;
      setCameraState((prev) => ({ ...prev, torchOn: false }));
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
    };
  }, [cameraState.activeDeviceId, cameraState.didProbe, scannerOpen]);

  const toggleCamera = React.useCallback(() => {
    if (cameraState.deviceIds.length < 2) {
      return;
    }
    setCameraState((prev) => {
      const currentIndex = prev.activeDeviceId
        ? prev.deviceIds.indexOf(prev.activeDeviceId)
        : -1;
      const nextIndex = (currentIndex + 1) % prev.deviceIds.length;
      return {
        ...prev,
        activeDeviceId: prev.deviceIds[nextIndex],
      };
    });
  }, [cameraState.deviceIds.length]);

  const toggleTorch = React.useCallback(async () => {
    const controls = scannerControlsRef.current;
    if (
      !controls?.switchTorch ||
      !cameraState.torchAvailable ||
      cameraState.torchBusy
    ) {
      return;
    }
    const next = !cameraState.torchOn;
    setCameraState((prev) => ({ ...prev, torchBusy: true }));
    try {
      await controls.switchTorch(next);
      setCameraState((prev) => ({ ...prev, torchOn: next }));
    } catch (e) {
      console.error("Failed to toggle torch:", e);
      setScannerError((e as Error).message || "Cannot toggle camera light.");
    } finally {
      setCameraState((prev) => ({ ...prev, torchBusy: false }));
    }
  }, [cameraState.torchAvailable, cameraState.torchBusy, cameraState.torchOn]);

  return (
    <div className="space-y-4 lg:h-full lg:overflow-y-auto">
      {/* ENTERING */}
      {state.type === "entering" && (
        <>
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <Label>Recipient address</Label>
                <Button
                  variant="soft"
                  type="button"
                  onClick={() => setScannerOpen((s) => !s)}
                  className="!flex-none px-2.5 py-1 text-xs"
                >
                  {scannerOpen ? "Close scanner" : "Scan QR"}
                </Button>
              </div>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Enter Monero address"
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-sm"
              />
              {scannerOpen && (
                <SurfaceCard className="mt-2 space-y-2 p-2.5">
                  <video
                    ref={videoRef}
                    className="w-full rounded-lg bg-black/30"
                    autoPlay
                    playsInline
                    muted
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="soft"
                      className="w-full text-xs"
                      onClick={toggleCamera}
                      disabled={cameraState.deviceIds.length < 2}
                    >
                      Switch camera
                    </Button>
                    <Button
                      type="button"
                      variant="soft"
                      className="w-full text-xs"
                      onClick={() => {
                        void toggleTorch();
                      }}
                      disabled={
                        !cameraState.torchAvailable || cameraState.torchBusy
                      }
                    >
                      {cameraState.torchOn ? "Light off" : "Light on"}
                    </Button>
                  </div>
                  <div className="text-xs text-white/55">
                    Scan a QR with either a plain address or a{" "}
                    <span className="font-mono">monero:</span> URI.
                  </div>
                  {scannerError && (
                    <div className="rounded-md bg-red-500/10 p-2 text-xs text-red-300 ring-1 ring-red-500/30">
                      {scannerError}
                    </div>
                  )}
                </SurfaceCard>
              )}
            </div>

            <div>
              <Label>Amount (XMR)</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.000000000000"
                autoComplete="off"
              />

              {fiatValue !== null && (
                <div className="mt-1 text-xs text-white/50">
                  ≈ {fiatValue.toFixed(2)} EUR
                </div>
              )}
            </div>

            <div>
              <Label>Priority</Label>
              <Select.Root
                value={String(feePriority)}
                onValueChange={(next) => {
                  setFeePriority(Number(next) as FeePriorityValue);
                }}
              >
                <Select.Trigger>
                  <Select.Value>
                    {FEE_PRIORITY_LABELS[feePriority]}
                  </Select.Value>
                </Select.Trigger>
                <Select.Content>
                  {FEE_PRIORITY_OPTIONS.map((option) => (
                    <Select.Option key={option.value} value={option.value}>
                      {option.label}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
          </div>

          <Button
            variant="primary"
            disabled={!isValid}
            onClick={handleCreateTx}
            className="w-full text-sm font-semibold"
          >
            Review transaction
          </Button>
        </>
      )}

      {/* ESTIMATING */}
      {state.type === "estimating" && (
        <ShimmerStatus text="Estimating network fee..." />
      )}

      {/* CONFIRMING */}
      {state.type === "confirming" && parsedAmount && (
        <div className="space-y-4">
          <SurfaceCard className="space-y-3">
            <div>
              <div className="text-xs text-white/60">Amount</div>
              <div className="text-lg font-semibold text-white">
                {amount} XMR
              </div>
              {fiatValue !== null && (
                <div className="text-sm text-white/60">
                  ≈ {fiatValue.toFixed(2)} EUR
                </div>
              )}
            </div>

            <div>
              <div className="text-xs text-white/60">Network fee</div>
              <div className="text-sm text-white">
                {formatAtomicToXmr(state.fee)} XMR
              </div>
              {price && (
                <div className="text-xs text-white/50">
                  ≈ {toFiat(state.fee, price).toFixed(2)} EUR
                </div>
              )}
            </div>

            <div>
              <div className="text-xs text-white/60 pt-2">To address</div>
              <div className="break-all font-mono text-xs text-white/80">
                {splitAddressBy6(normalizedAddress)}
              </div>
            </div>
          </SurfaceCard>

          <ButtonsHolder>
            <Button
              onClick={() => setState({ type: "entering" })}
              className="text-sm font-semibold"
            >
              Cancel
            </Button>

            <Button
              onClick={handleSend}
              variant="primary"
              className="text-sm font-semibold"
            >
              Confirm &amp; Send
            </Button>
          </ButtonsHolder>
        </div>
      )}

      {/* SENDING */}
      {state.type === "sending" && (
        <ShimmerStatus text="Broadcasting transaction..." />
      )}

      {/* SENT */}
      {state.type === "sent" && (
        <div className="space-y-4 text-center">
          <div className="text-green-400 text-lg font-semibold">
            ✓ Transaction sent
          </div>

          <div className="text-sm text-white/60">
            Fee paid: {formatAtomicToXmr(state.txFee)} XMR
          </div>

          <Button
            onClick={reset}
            variant="primary"
            className="w-full text-sm font-semibold"
          >
            Send another
          </Button>
        </div>
      )}

      {/* ERROR */}
      {state.type === "error" && (
        <div className="space-y-4">
          <div className="rounded-xl bg-red-500/10 ring-1 ring-red-500/30 p-3 text-sm text-red-300">
            {state.message}
          </div>

          <Button
            onClick={() => setState({ type: "entering" })}
            variant="soft"
            className="w-full text-sm font-semibold"
          >
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

function parseMoneroQrPayload(
  raw: string,
): { address: string; amount?: string } | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }

  if (isLikelyMoneroAddress(text)) {
    return { address: text };
  }

  if (text.toLowerCase().startsWith("monero:")) {
    const afterScheme = text.slice(text.indexOf(":") + 1).replace(/^\/\//, "");
    const [addressPart, query = ""] = afterScheme.split("?");
    const encodedAddress = addressPart?.trim() || "";
    const decodedAddress = safeDecodeURIComponent(encodedAddress);
    if (isLikelyMoneroAddress(decodedAddress)) {
      const params = new URLSearchParams(query);
      const rawAmount = params.get("tx_amount") || params.get("amount");
      const amountAtomic = parseMoneroAmountAtomic(rawAmount);
      return amountAtomic !== undefined
        ? { address: decodedAddress, amount: balanceToString(amountAtomic) }
        : { address: decodedAddress };
    }
  }

  return null;
}

function isLikelyMoneroAddress(value: string): boolean {
  return /^(4|8)[1-9A-HJ-NP-Za-km-z]{90,120}$/.test(value);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseMoneroAmountAtomic(value: string | null): bigint | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  try {
    return stringToBalance(trimmed);
  } catch {
    return undefined;
  }
}
