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
  useMultisigDataOverlayExport,
  useMultisigDataOverlayImport,
} from "../ui";
import {
  FeePriority,
  MoneroWasmWallet,
  PendingTxHandle,
  TransferInfoItem,
  type FeePriority as FeePriorityValue,
} from "../../../monero-wasm-module/walletApi";

type SendState =
  | { type: "entering" }
  | { type: "estimating" }
  | {
      type: "confirming";
      txHandle: PendingTxHandle;
      info: TransferInfoItem[];
    }
  | { type: "multisig-info-loading" }
  | {
      type: "multisig-info";
      importData: Uint8Array;
      info: MultisigTxInfo;
    }
  | {
      type: "multisig-signing";
      importData: Uint8Array;
      info: MultisigTxInfo;
    }
  | { type: "sending"; txFee: bigint; txHandle: PendingTxHandle }
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

type RecipientInput = {
  address: string;
  amount: string;
};

type ParsedRecipient = {
  index: number;
  normalizedAddress: string;
  parsedAmount: bigint | null;
  isValid: boolean;
};

type CoinsOverlayState =
  | { type: "loading" }
  | { type: "ready"; todoMessage: string }
  | { type: "error"; message: string };

type MultisigTxInfo = {
  fee: bigint;
  recipients: Array<{ address: string; amount: bigint }>;
  summary: string;
};

function summarizeTransfers(transfers: TransferInfoItem[]) {
  const destinations = transfers.flatMap((tx) => tx.destinations);
  const totalOutgoing = destinations.reduce(
    (sum, dst) => sum + dst.dspAmount,
    0n,
  );
  const totalFee = transfers.reduce((sum, tx) => sum + tx.fee, 0n);
  return { destinations, totalOutgoing, totalFee };
}

export function SendTab({
  wallet,
  scheduleRefresh,
  price,
  showMultisigActions,
}: {
  wallet: MoneroWasmWallet;
  scheduleRefresh: () => void;
  price: number | null;
  showMultisigActions: boolean;
}) {
  const [recipients, setRecipients] = React.useState<RecipientInput[]>([
    { address: "", amount: "" },
  ]);
  const [feePriority, setFeePriority] = React.useState<FeePriorityValue>(
    FeePriority.Default,
  );
  const [state, setState] = React.useState<SendState>({ type: "entering" });
  const [coinsOverlayState, setCoinsOverlayState] =
    React.useState<CoinsOverlayState | null>(null);
  const [scannerOpen, setScannerOpen] = React.useState(false);
  const [scannerError, setScannerError] = React.useState<string | null>(null);
  const [cameraState, setCameraState] =
    React.useState<CameraState>(INITIAL_CAMERA_STATE);
  const multisigExportOverlay = useMultisigDataOverlayExport();
  const multisigImportOverlay = useMultisigDataOverlayImport();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = React.useRef<IScannerControls | null>(null);

  const parsedRecipients = React.useMemo<ParsedRecipient[]>(
    () =>
      recipients.map((recipient, index) => {
        const normalizedAddress = recipient.address.replace(/\s+/g, "").trim();
        const parsedAmount = parseXmrToAtomic(recipient.amount);
        return {
          index,
          normalizedAddress,
          parsedAmount,
          isValid:
            normalizedAddress.length > 20 &&
            parsedAmount !== null &&
            parsedAmount > 0n,
        };
      }),
    [recipients],
  );
  const totalParsedAmount = React.useMemo(
    () =>
      parsedRecipients.reduce(
        (sum, recipient) => sum + (recipient.parsedAmount ?? 0n),
        0n,
      ),
    [parsedRecipients],
  );
  const totalFiatValue =
    totalParsedAmount > 0n && price ? toFiat(totalParsedAmount, price) : null;
  const isValid =
    recipients.length > 0 &&
    parsedRecipients.every((recipient) => recipient.isValid) &&
    state.type === "entering";

  async function handleCreateTx() {
    if (state.type !== "entering") {
      throw new Error("Invalid state for creating transaction");
    }
    if (
      parsedRecipients.length === 0 ||
      parsedRecipients.some((r) => !r.isValid)
    ) {
      return;
    }

    const destinations = parsedRecipients.map(
      (recipient) => recipient.normalizedAddress,
    );
    const amounts = parsedRecipients.map(
      (recipient) => recipient.parsedAmount as bigint,
    );

    setState({ type: "estimating" });
    wallet.transfer_prepare(destinations, amounts, feePriority).then(
      (txHandle) => {
        const transferInfo = wallet.get_transfers_info(txHandle);
        console.info("Transfer info:", transferInfo);
        setState({
          type: "confirming",
          txHandle,
          info: transferInfo,
        });
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
    const summary = summarizeTransfers(state.info);
    setState({
      type: "sending",
      txFee: summary.totalFee,
      txHandle: state.txHandle,
    });
    wallet
      .transfer_commit_tx(state.txHandle)
      .then(() => {
        setState({ type: "sent", txFee: summary.totalFee });
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

  async function handleLoadCoins() {
    setCoinsOverlayState({ type: "loading" });
    try {
      const result = await getCoinsStub(wallet);
      setCoinsOverlayState({
        type: "ready",
        todoMessage: result.todoMessage,
      });
    } catch (e) {
      setCoinsOverlayState({
        type: "error",
        message: (e as Error)?.message || "Failed to load coins",
      });
    }
  }

  async function handleStartSignMultisigFlow() {
    if (!showMultisigActions || state.type !== "entering") {
      return;
    }

    const imported = await multisigImportOverlay({
      header: "Paste multisig tx data here",
    });
    if (imported === null) {
      return;
    }

    const importData = new Uint8Array(imported.length);
    importData.set(imported);

    setState({ type: "multisig-info-loading" });
    try {
      const info = await getMultisigTxInfoStub(wallet, importData);
      setState({ type: "multisig-info", importData, info });
    } catch (e) {
      setState({
        type: "error",
        message: (e as Error)?.message || "Failed to parse multisig tx data",
      });
    }
  }

  async function handleSignMultisigTx() {
    if (state.type !== "multisig-info") {
      return;
    }

    const importData = state.importData;
    const info = state.info;
    setState({ type: "multisig-signing", importData, info });
    try {
      const signed = await signMultisigTxStub(wallet, importData);
      const signedDataCopy = new Uint8Array(signed.data.length);
      signedDataCopy.set(signed.data);

      await multisigExportOverlay({
        data: signedDataCopy,
        header: signed.is_ready
          ? "Signed multisig tx (ready to broadcast)"
          : "Signed multisig tx (collect more signatures)",
        fileName: "signed-multisig-tx",
        action: signed.is_ready
          ? {
              label: "Broadcast",
              onAction: async () => {
                await broadcastMultisigTxStub(wallet, signedDataCopy);
                scheduleRefresh();
              },
            }
          : undefined,
      });
      setState({ type: "entering" });
    } catch (e) {
      setState({
        type: "error",
        message: (e as Error)?.message || "Failed to sign multisig tx",
      });
    }
  }

  function reset() {
    setRecipients([{ address: "", amount: "" }]);
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
                : preferredEnvDeviceId &&
                    deviceIds.includes(preferredEnvDeviceId)
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
      .decodeFromVideoDevice(
        cameraState.activeDeviceId,
        videoElement,
        (result) => {
          if (isClosed || !result) {
            return;
          }
          const parsed = parseMoneroQrPayload(result.getText());
          if (!parsed || parsed.length === 0) {
            setScannerError(
              "Unsupported QR format. Expected Monero address or monero: URI.",
            );
            return;
          }
          setRecipients((prevRecipients) => {
            const nextRecipients = [...prevRecipients];
            while (
              nextRecipients.length > 0 &&
              isRecipientEmpty(nextRecipients[nextRecipients.length - 1])
            ) {
              nextRecipients.pop();
            }
            for (const recipient of parsed) {
              nextRecipients.push({
                address: recipient.address,
                amount: recipient.amount ?? "",
              });
            }
            return nextRecipients.length > 0
              ? nextRecipients
              : [{ address: "", amount: "" }];
          });
          setScannerOpen(false);
          setScannerError(null);
        },
      )
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

  function updateRecipient(index: number, next: Partial<RecipientInput>) {
    setRecipients((prevRecipients) =>
      prevRecipients.map((recipient, i) =>
        i === index ? { ...recipient, ...next } : recipient,
      ),
    );
  }

  function addRecipient() {
    setRecipients((prevRecipients) => [
      ...prevRecipients,
      { address: "", amount: "" },
    ]);
  }

  function removeRecipient(index: number) {
    setRecipients((prevRecipients) => {
      if (prevRecipients.length <= 1) {
        return prevRecipients;
      }
      return prevRecipients.filter((_, i) => i !== index);
    });
  }

  return (
    <>
      <div className="scrollbar-glass h-auto overflow-visible pr-1 lg:h-full lg:min-h-0 lg:overflow-auto">
        <div className="space-y-4 pb-2">
          {/* ENTERING */}
          {state.type === "entering" && (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label>Recipients</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="soft"
                      type="button"
                      onClick={addRecipient}
                      className="!flex-none px-2.5 py-1 text-xs"
                    >
                      Add destination
                    </Button>
                    <Button
                      variant="soft"
                      type="button"
                      onClick={() => setScannerOpen((s) => !s)}
                      className="!flex-none px-2.5 py-1 text-xs"
                    >
                      {scannerOpen ? "Close scanner" : "Scan QR"}
                    </Button>
                  </div>
                </div>

                {scannerOpen && (
                  <SurfaceCard className="space-y-2 p-2.5">
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
                      Scan a QR with one or many recipients as plain addresses
                      or <span className="font-mono">monero:</span> URIs.
                    </div>
                    {scannerError && (
                      <div className="rounded-md bg-red-500/10 p-2 text-xs text-red-300 ring-1 ring-red-500/30">
                        {scannerError}
                      </div>
                    )}
                  </SurfaceCard>
                )}

                {recipients.map((recipient, index) => {
                  const parsedAmount = parseXmrToAtomic(recipient.amount);
                  const fiatValue =
                    parsedAmount !== null && parsedAmount > 0n && price
                      ? toFiat(parsedAmount, price)
                      : null;

                  return (
                    <SurfaceCard key={index} className="space-y-3 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs text-white/60">
                          Recipient #{index + 1}
                        </div>
                        <Button
                          type="button"
                          variant="soft"
                          className="!flex-none px-2.5 py-1 text-xs"
                          onClick={() => removeRecipient(index)}
                          disabled={recipients.length <= 1}
                        >
                          Remove
                        </Button>
                      </div>

                      <div>
                        <Label>Recipient address</Label>
                        <Input
                          value={recipient.address}
                          onChange={(e) =>
                            updateRecipient(index, { address: e.target.value })
                          }
                          placeholder="Enter Monero address"
                          autoComplete="off"
                          spellCheck={false}
                          className="font-mono text-sm"
                        />
                      </div>

                      <div>
                        <Label>Amount (XMR)</Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={recipient.amount}
                          onChange={(e) =>
                            updateRecipient(index, { amount: e.target.value })
                          }
                          placeholder="0.000000000000"
                          autoComplete="off"
                        />
                        {fiatValue !== null && (
                          <div className="mt-1 text-xs text-white/50">
                            ≈ {fiatValue.toFixed(2)} EUR
                          </div>
                        )}
                      </div>
                    </SurfaceCard>
                  );
                })}

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

              <div className="border-t border-white/10 pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="neutral"
                    type="button"
                    onClick={() => {
                      void handleLoadCoins();
                    }}
                    className="!flex-none px-3 py-1.5 text-xs"
                  >
                    Coins
                  </Button>
                  {showMultisigActions && (
                    <Button
                      variant="neutral"
                      type="button"
                      onClick={() => {
                        void handleStartSignMultisigFlow();
                      }}
                      className="!flex-none px-3 py-1.5 text-xs"
                    >
                      Sign multisig tx
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ESTIMATING */}
          {state.type === "estimating" && (
            <ShimmerStatus text="Estimating network fee..." />
          )}

          {state.type === "multisig-info-loading" && (
            <ShimmerStatus text="Loading multisig transaction info..." />
          )}

          {/* CONFIRMING */}
          {state.type === "confirming" && (
            <div className="space-y-4">
              <SurfaceCard className="space-y-3">
                {(() => {
                  const summary = summarizeTransfers(state.info);
                  return (
                    <>
                      <div>
                        <div className="text-xs text-white/60">
                          Total outgoing
                        </div>
                        <div className="text-lg font-semibold text-white">
                          {formatAtomicToXmr(summary.totalOutgoing)} XMR
                        </div>
                        {summary.totalOutgoing > 0n && price && (
                          <div className="text-sm text-white/60">
                            ≈ {toFiat(summary.totalOutgoing, price).toFixed(2)}{" "}
                            EUR
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="text-xs text-white/60">Network fee</div>
                        <div className="text-sm text-white">
                          {formatAtomicToXmr(summary.totalFee)} XMR
                        </div>
                        {price && (
                          <div className="text-xs text-white/50">
                            ≈ {toFiat(summary.totalFee, price).toFixed(2)} EUR
                          </div>
                        )}
                      </div>

                      {summary.destinations.length === 1 && (
                        <div>
                          <div className="text-xs text-white/60 pt-2">
                            To address
                          </div>
                          <div className="break-all font-mono text-xs text-white/80">
                            {splitAddressBy6(
                              summary.destinations[0].dstAddress,
                            )}
                          </div>
                        </div>
                      )}

                      {summary.destinations.length > 1 && (
                        <div className="space-y-2 pt-2">
                          <div className="text-xs text-white/60">
                            Recipients
                          </div>
                          {summary.destinations.map((recipient, index) => (
                            <div
                              key={`${recipient.dstAddress}-${recipient.dspAmount.toString()}-${index}`}
                              className="rounded-lg bg-white/5 p-2"
                            >
                              <div className="break-all font-mono text-[11px] text-white/75">
                                {splitAddressBy6(recipient.dstAddress)}
                              </div>
                              <div className="mt-1 text-xs text-white">
                                {formatAtomicToXmr(recipient.dspAmount)} XMR
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
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

          {state.type === "multisig-info" && (
            <div className="space-y-4">
              <SurfaceCard className="space-y-3">
                <div>
                  <div className="text-xs text-white/60">Total outgoing</div>
                  <div className="text-lg font-semibold text-white">
                    {formatAtomicToXmr(
                      state.info.recipients.reduce(
                        (sum, recipient) => sum + recipient.amount,
                        0n,
                      ),
                    )}{" "}
                    XMR
                  </div>
                  {price && (
                    <div className="text-sm text-white/60">
                      ≈{" "}
                      {toFiat(
                        state.info.recipients.reduce(
                          (sum, recipient) => sum + recipient.amount,
                          0n,
                        ),
                        price,
                      ).toFixed(2)}{" "}
                      EUR
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-xs text-white/60">Network fee</div>
                  <div className="text-sm text-white">
                    {formatAtomicToXmr(state.info.fee)} XMR
                  </div>
                  {price && (
                    <div className="text-xs text-white/50">
                      ≈ {toFiat(state.info.fee, price).toFixed(2)} EUR
                    </div>
                  )}
                </div>

                <div className="space-y-2 pt-2">
                  <div className="text-xs text-white/60">Recipients</div>
                  {state.info.recipients.length > 0 ? (
                    state.info.recipients.map((recipient, index) => (
                      <div
                        key={`${recipient.address}-${index}`}
                        className="rounded-lg bg-white/5 p-2"
                      >
                        <div className="break-all font-mono text-[11px] text-white/75">
                          {splitAddressBy6(recipient.address)}
                        </div>
                        <div className="mt-1 text-xs text-white">
                          {formatAtomicToXmr(recipient.amount)} XMR
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg bg-white/5 p-2 text-xs text-white/65">
                      No recipients parsed yet.
                    </div>
                  )}
                </div>

                <div className="rounded-lg bg-white/5 p-2 text-xs text-white/70">
                  {state.info.summary}
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
                  onClick={() => {
                    void handleSignMultisigTx();
                  }}
                  variant="primary"
                  className="text-sm font-semibold"
                >
                  Sign
                </Button>
              </ButtonsHolder>
            </div>
          )}

          {state.type === "multisig-signing" && (
            <ShimmerStatus text="Signing multisig transaction..." />
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
      </div>
      {coinsOverlayState && (
        <div className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-[1px]">
          <div className="flex h-full w-full flex-col bg-[#211239] p-3 ring-1 ring-white/15 sm:p-4">
            <div className="space-y-1 border-b border-white/10 pb-3">
              <div className="text-base font-semibold text-white/90">Coins</div>
              <div className="text-sm text-white/70">
                Coins view will be added after wallet method implementation.
              </div>
            </div>

            <div className="min-h-0 flex-1 py-3">
              <div className="scrollbar-glass h-full overflow-y-auto rounded-lg bg-white/5 p-3 text-sm text-white/80 ring-1 ring-white/10">
                {coinsOverlayState.type === "loading" && (
                  <div>Loading coins... (TODO)</div>
                )}
                {coinsOverlayState.type === "error" && (
                  <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-100 ring-1 ring-red-300/30">
                    {coinsOverlayState.message}
                  </div>
                )}
                {coinsOverlayState.type === "ready" && (
                  <div>{coinsOverlayState.todoMessage}</div>
                )}
              </div>
            </div>

            <div className="border-t border-white/10 pt-3">
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="soft"
                  className="!flex-none px-4 py-1.5 text-xs"
                  onClick={() => setCoinsOverlayState(null)}
                  disabled={coinsOverlayState.type === "loading"}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

async function getCoinsStub(wallet: MoneroWasmWallet): Promise<{
  todoMessage: string;
}> {
  const maybeWallet = wallet as unknown as {
    getCoins?: () => Promise<unknown>;
  };
  if (typeof maybeWallet.getCoins === "function") {
    await maybeWallet.getCoins();
  } else {
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return {
    todoMessage:
      "TODO: Coins data loaded. UI content will be implemented when getCoins() is ready.",
  };
}

async function getMultisigTxInfoStub(
  wallet: MoneroWasmWallet,
  data: Uint8Array,
): Promise<MultisigTxInfo> {
  const maybeWallet = wallet as unknown as {
    getMultisigTxInfo?: (input: Uint8Array) => Promise<{
      fee?: bigint;
      recipients?: Array<{ address: string; amount: bigint }>;
      summary?: string;
    }>;
  };
  if (typeof maybeWallet.getMultisigTxInfo === "function") {
    const info = await maybeWallet.getMultisigTxInfo(data);
    return {
      fee: info.fee ?? 0n,
      recipients: info.recipients ?? [],
      summary: info.summary ?? "Multisig tx info loaded.",
    };
  }

  await new Promise((resolve) => setTimeout(resolve, 350));
  return {
    fee: 0n,
    recipients: [],
    summary:
      "TODO: parse and display multisig tx info once getMultisigTxInfo() is implemented.",
  };
}

async function signMultisigTxStub(
  wallet: MoneroWasmWallet,
  input: Uint8Array,
): Promise<{ data: Uint8Array; is_ready: boolean }> {
  const maybeWallet = wallet as unknown as {
    signMultisigTx?: (
      data: Uint8Array,
    ) => Promise<{ data: Uint8Array; is_ready: boolean }>;
    signMulsiigTx?: (
      data: Uint8Array,
    ) => Promise<{ data: Uint8Array; is_ready: boolean }>;
  };
  if (typeof maybeWallet.signMultisigTx === "function") {
    return maybeWallet.signMultisigTx(input);
  }
  if (typeof maybeWallet.signMulsiigTx === "function") {
    return maybeWallet.signMulsiigTx(input);
  }

  await new Promise((resolve) => setTimeout(resolve, 350));
  const data = new Uint8Array(input.length);
  data.set(input);
  return { data, is_ready: false };
}

async function broadcastMultisigTxStub(
  wallet: MoneroWasmWallet,
  data: Uint8Array,
): Promise<void> {
  const maybeWallet = wallet as unknown as {
    broadcastMultisigTx?: (input: Uint8Array) => Promise<void>;
  };
  if (typeof maybeWallet.broadcastMultisigTx === "function") {
    await maybeWallet.broadcastMultisigTx(data);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
}

function parseMoneroQrPayload(
  raw: string,
): { address: string; amount?: string }[] | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }

  const direct = parseMoneroRecipientEntries(text);
  if (direct && direct.length > 0) {
    return direct;
  }

  const lines = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (lines.length > 1) {
    const recipients: { address: string; amount?: string }[] = [];
    for (const line of lines) {
      const parsedLine = parseMoneroRecipientEntries(line);
      if (!parsedLine || parsedLine.length === 0) {
        return null;
      }
      recipients.push(...parsedLine);
    }
    return recipients.length > 0 ? recipients : null;
  }

  return null;
}

function parseMoneroRecipientEntries(
  text: string,
): { address: string; amount?: string }[] | null {
  if (isLikelyMoneroAddress(text)) {
    return [{ address: text }];
  }

  if (!text.toLowerCase().startsWith("monero:")) {
    return null;
  }

  const afterScheme = text.slice(text.indexOf(":") + 1).replace(/^\/\//, "");
  const [addressPart, query = ""] = afterScheme.split("?");
  const encodedAddress = addressPart?.trim() || "";
  const decodedAddress = safeDecodeURIComponent(encodedAddress);
  if (!isLikelyMoneroAddress(decodedAddress)) {
    return null;
  }

  const params = new URLSearchParams(query);
  const baseRecipient = toRecipient(
    decodedAddress,
    params.get("tx_amount") || params.get("amount"),
  );
  const recipients = [baseRecipient];

  const nestedEntries = Array.from(params.entries())
    .filter(([key]) => /^uri_\d+$/i.test(key))
    .sort((a, b) => toUriIndex(a[0]) - toUriIndex(b[0]));
  for (const [, value] of nestedEntries) {
    const nestedRecipients = parseMoneroRecipientEntries(
      safeDecodeURIComponent(value),
    );
    if (!nestedRecipients || nestedRecipients.length === 0) {
      continue;
    }
    recipients.push(...nestedRecipients);
  }

  const extraAddressEntries = Array.from(params.entries())
    .filter(([key]) => /^address_\d+$/i.test(key))
    .sort((a, b) => toUriIndex(a[0]) - toUriIndex(b[0]));
  for (const [key, value] of extraAddressEntries) {
    const decodedNestedAddress = safeDecodeURIComponent(value).trim();
    if (!isLikelyMoneroAddress(decodedNestedAddress)) {
      continue;
    }
    const suffix = key.split("_")[1];
    const amountValue =
      params.get(`tx_amount_${suffix}`) ?? params.get(`amount_${suffix}`);
    recipients.push(toRecipient(decodedNestedAddress, amountValue));
  }

  return recipients.length > 0 ? recipients : null;
}

function toRecipient(
  address: string,
  rawAmount: string | null,
): { address: string; amount?: string } {
  const amountAtomic = parseMoneroAmountAtomic(rawAmount);
  return amountAtomic !== undefined
    ? { address, amount: balanceToString(amountAtomic) }
    : { address };
}

function toUriIndex(key: string): number {
  const [, numeric] = key.split("_");
  return Number(numeric);
}

function isRecipientEmpty(
  recipient: Pick<RecipientInput, "address" | "amount">,
) {
  return recipient.address.trim() === "" && recipient.amount.trim() === "";
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
