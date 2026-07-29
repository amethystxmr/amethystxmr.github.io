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
  withFsLock,
} from "../utils";
import {
  Button,
  ButtonsHolder,
  Input,
  InputWithAction,
  Label,
  Select,
  ShimmerStatus,
  SurfaceCard,
  Toggle,
  FullscreenOverlayPanel,
  useAlert,
  useIsUnmountedRef,
  useMultisigDataOverlayExport,
  useMultisigDataOverlayImport,
} from "../ui";
import {
  FeePriority,
  MoneroWasmWallet,
  TransferItem,
  TransferInfoItem,
  type FeePriority as FeePriorityValue,
  type WalletTxHandle,
} from "../../../monero-wasm-module/walletApi.workerClient";

type SendState =
  | { type: "entering" }
  | { type: "building-transaction" }
  | {
      type: "confirming";
      info: TransferInfoItem[];
      kind:
        | {
            type: "non-multisig";
            txHandle: WalletTxHandle;
          }
        | {
            type: "new-multisig";
            txHandle: WalletTxHandle;
          }
        | {
            type: "continue-multisig";
            iAmTheLastSigner: boolean;
            importData: Uint8Array;
          };
    }
  | { type: "multisig-info-loading" }
  | {
      type: "multisig-signing";
      importData: Uint8Array;
      info: TransferInfoItem[];
    }
  | { type: "multisig-exporting" }
  | {
      type: "sending";
      info: TransferInfoItem[];
    }
  | { type: "sent"; info: TransferInfoItem[] }
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
  normalizedAddress: string;
  parsedAmount: bigint | null;
  isAllAmount: boolean;
  isValid: boolean;
};

type CoinsOverlayState =
  | { type: "loading"; showSpent: boolean }
  | { type: "ready"; coins: TransferItem[]; showSpent: boolean }
  | { type: "error"; message: string; showSpent: boolean };

function summarizeTransfers(transfers: TransferInfoItem[]) {
  const destinations = transfers.flatMap((tx) => tx.destinations);
  const totalOutgoing = destinations.reduce(
    (sum, dst) => sum + dst.dspAmount,
    0n,
  );
  const totalFee = transfers.reduce((sum, tx) => sum + tx.fee, 0n);
  const totalChange = transfers.reduce((sum, tx) => sum + tx.changeAmount, 0n);
  return { destinations, totalOutgoing, totalFee, totalChange };
}

/** Compact address for exact string compare (strip whitespace). */
function compactAddress(address: string): string {
  return address.replace(/\s+/g, "").trim();
}

/**
 * Ensure prepared tx destinations match the addresses the user typed.
 * Returns an error message when a mismatch is found.
 */
function findPreparedAddressMismatch(
  enteredAddresses: string[],
  transferInfo: TransferInfoItem[],
): string | null {
  const entered = enteredAddresses.map(compactAddress);
  const shown = transferInfo.flatMap((tx) =>
    tx.destinations.map((d) => compactAddress(d.dstAddress)),
  );

  if (entered.length === 0) {
    return "A bug detected: no entered destination addresses to verify";
  }
  if (shown.length === 0) {
    return "A bug detected: prepared transaction has no destination addresses";
  }

  // wallet2 may split one destination across multiple pending transactions, so
  // verify membership instead of relying on flattened order or exact counts.
  for (const address of shown) {
    if (!entered.includes(address)) {
      return `A bug detected: address ${address} does not match entered destination(s)`;
    }
  }
  for (const address of entered) {
    if (!shown.includes(address)) {
      return `A bug detected: entered address ${address} does not match prepared destination(s)`;
    }
  }
  return null;
}

function getPostSendBalances(
  currentTotalNonStrictBalance: bigint | null,
  currentUnlockedNonStrictBalance: bigint | null,
  totalOutgoing: bigint,
  totalFee: bigint,
  totalChange: bigint,
) {
  const totalSpent = totalOutgoing + totalFee;
  const balanceAfterSendingRaw =
    currentTotalNonStrictBalance !== null
      ? currentTotalNonStrictBalance - totalSpent
      : null;
  const balanceAfterSending =
    balanceAfterSendingRaw !== null && balanceAfterSendingRaw < 0n
      ? 0n
      : balanceAfterSendingRaw;
  const immediatelyUnlockedRaw =
    currentUnlockedNonStrictBalance !== null
      ? currentUnlockedNonStrictBalance - totalSpent - totalChange
      : null;
  const immediatelyUnlocked =
    immediatelyUnlockedRaw !== null && immediatelyUnlockedRaw < 0n
      ? 0n
      : immediatelyUnlockedRaw;
  return { balanceAfterSending, immediatelyUnlocked };
}

function isAllAmountInput(value: string) {
  return value.trim().toUpperCase() === "ALL";
}

export function SendTab({
  wallet,
  scheduleRefresh,
  price,
  currentTotalNonStrictBalance,
  currentUnlockedNonStrictBalance,
  showMultisigActions,
  isViewOnly,
}: {
  wallet: MoneroWasmWallet;
  scheduleRefresh: () => void;
  price: number | null;
  currentTotalNonStrictBalance: bigint | null;
  currentUnlockedNonStrictBalance: bigint | null;
  showMultisigActions: boolean;
  isViewOnly: boolean | undefined;
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
  const alert = useAlert();
  const isUnmountedRef = useIsUnmountedRef();
  const multisigExportOverlay = useMultisigDataOverlayExport();
  const multisigImportOverlay = useMultisigDataOverlayImport();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const scannerControlsRef = React.useRef<IScannerControls | null>(null);

  const parsedRecipients = React.useMemo<ParsedRecipient[]>(
    () =>
      recipients.map((recipient) => {
        const normalizedAddress = recipient.address.replace(/\s+/g, "").trim();
        const isAllAmount = isAllAmountInput(recipient.amount);
        const parsedAmount = parseXmrToAtomic(recipient.amount);
        return {
          normalizedAddress,
          parsedAmount,
          isAllAmount,
          isValid:
            normalizedAddress.length > 20 &&
            ((parsedAmount !== null && parsedAmount > 0n) || isAllAmount),
        };
      }),
    [recipients],
  );
  const allAmountCount = parsedRecipients.filter((r) => r.isAllAmount).length;
  const hasAllRecipient = allAmountCount > 0;
  const hasMultipleRecipients = recipients.length > 1;
  const isValid =
    recipients.length > 0 &&
    parsedRecipients.every((recipient) => recipient.isValid) &&
    allAmountCount <= 1 &&
    (!hasAllRecipient || recipients.length === 1) &&
    state.type === "entering";

  async function handleCreateTx() {
    if (state.type !== "entering") {
      throw new Error("Invalid state for creating transaction");
    }
    if (
      parsedRecipients.length === 0 ||
      parsedRecipients.some((recipient) => !recipient.isValid)
    ) {
      return;
    }

    if (allAmountCount > 1) {
      setState({
        type: "error",
        message: "Only one destination can have amount ALL",
      });
      return;
    }
    if (allAmountCount === 1 && parsedRecipients.length !== 1) {
      setState({
        type: "error",
        message: "Amount ALL can only be used with one destination",
      });
      return;
    }
    const allRecipientIndex =
      allAmountCount === 1
        ? parsedRecipients.findIndex((recipient) => recipient.isAllAmount)
        : -1;
    let allAmountValue: bigint | null = null;
    if (allRecipientIndex >= 0) {
      if (currentUnlockedNonStrictBalance === null) {
        setState({
          type: "error",
          message: "Unlocked balance is loading, try again in a moment",
        });
        return;
      }
      const nonAllSum = parsedRecipients.reduce(
        (sum, recipient) =>
          !recipient.isAllAmount &&
          recipient.parsedAmount !== null &&
          recipient.parsedAmount > 0n
            ? sum + recipient.parsedAmount
            : sum,
        0n,
      );
      allAmountValue = currentUnlockedNonStrictBalance - nonAllSum;
      if (allAmountValue <= 0n) {
        setState({
          type: "error",
          message: "Not enough unlocked balance for amount ALL",
        });
        return;
      }
    }

    const destinations = parsedRecipients.map(
      (recipient) => recipient.normalizedAddress,
    );
    const amounts: bigint[] = [];
    for (const recipient of parsedRecipients) {
      if (recipient.isAllAmount) {
        if (allAmountValue === null) {
          setState({
            type: "error",
            message: "Failed to calculate amount ALL",
          });
          return;
        }
        amounts.push(allAmountValue);
        continue;
      }
      if (recipient.parsedAmount === null) {
        throw new Error(
          "Unreachable: parsedAmount is null after recipient validation",
        );
      }
      amounts.push(recipient.parsedAmount);
    }

    setState({ type: "building-transaction" });
    let txHandle: WalletTxHandle | null = null;
    try {
      txHandle =
        allRecipientIndex >= 0
          ? await wallet.transfer_prepare_sweep_all(
              destinations[allRecipientIndex],
              feePriority,
            )
          : await wallet.transfer_prepare(
              destinations,
              amounts,
              feePriority,
              null,
            );
      const transferInfo = await wallet.get_transfers_info(txHandle);
      const addressMismatch = findPreparedAddressMismatch(
        destinations,
        transferInfo,
      );
      if (addressMismatch !== null) {
        await wallet.destroy_tx_handle(txHandle);
        txHandle = null;
        if (isUnmountedRef.current) {
          return;
        }
        setState({
          type: "error",
          message: addressMismatch,
        });
        return;
      }
      const multisigStatus = await wallet.get_multisig_status();
      if (isUnmountedRef.current) {
        await wallet.destroy_tx_handle(txHandle);
        return;
      }
      if (multisigStatus.multisig_is_active && !multisigStatus.is_ready) {
        await wallet.destroy_tx_handle(txHandle);
        setState({ type: "entering" });
        await alert("Multisig wallet is enabled but not ready.");
        return;
      }
      console.info("Transfer info:", transferInfo);
      setState({
        type: "confirming",
        kind: {
          type: multisigStatus.multisig_is_active
            ? "new-multisig"
            : "non-multisig",
          txHandle,
        },
        info: transferInfo,
      });
    } catch (e) {
      if (txHandle !== null) {
        await wallet.destroy_tx_handle(txHandle);
      }
      if (isUnmountedRef.current) {
        return;
      }
      setState({
        type: "error",
        message: (e as Error).message ?? "Failed to estimate fee",
      });
    }
  }

  async function handleConfirm() {
    if (state.type !== "confirming") {
      throw new Error("Invalid state for sending transaction");
    }

    if (state.kind.type === "new-multisig") {
      const txHandle = state.kind.txHandle;
      try {
        setState({ type: "multisig-exporting" });
        const data = await wallet.save_multisig_tx_pending_tx(txHandle);
        const dataCopy = new Uint8Array(data.length);
        dataCopy.set(data);
        const walletName = await wallet.get_wallet_file();
        await multisigExportOverlay({
          data: dataCopy,
          header: "Partially signed transaction",
          fileName: `partially-signed-multisig-tx-${walletName}`,
        });
        await wallet.destroy_tx_handle(txHandle);
        if (isUnmountedRef.current) {
          return;
        }
        setState({ type: "entering" });
      } catch (e) {
        await wallet.destroy_tx_handle(txHandle);
        if (isUnmountedRef.current) {
          return;
        }
        setState({
          type: "error",
          message: (e as Error).message ?? "Failed to export multisig tx",
        });
      }
    } else if (state.kind.type === "non-multisig") {
      const txHandle = state.kind.txHandle;
      setState({
        type: "sending",
        info: state.info,
      });
      (async () => {
        await withFsLock(async () => {
          await wallet.transfer_commit_tx(txHandle);
          await wallet.store();
        });
        if (isUnmountedRef.current) {
          return;
        }
        setState({ type: "sent", info: state.info });
        scheduleRefresh();
      })()
        .catch((e) => {
          if (isUnmountedRef.current) {
            return;
          }
          setState({
            type: "error",
            message: (e as Error).message ?? "Transaction failed",
          });
        })
        .finally(() => {
          void wallet.destroy_tx_handle(txHandle);
        });
    } else if (state.kind.type === "continue-multisig") {
      const importData = state.kind.importData;
      const info = state.info;
      setState({ type: "multisig-signing", importData, info });
      (async () => {
        let txHandle: WalletTxHandle | null = null;
        try {
          txHandle = await wallet.load_multisig_tx(importData, true);
          const signTxIds = await wallet.sign_multisig_tx(txHandle);
          const signedData = await wallet.save_multisig_tx(txHandle);
          const signedDataCopy = new Uint8Array(signedData.length);
          signedDataCopy.set(signedData);

          if (signTxIds.length === 0) {
            const multisigStatus = await wallet.get_multisig_status();
            const signersNeeded = Math.max(
              multisigStatus.threshold -
                (await wallet.get_multisig_tx_signers_count(txHandle, true)) -
                1,
              0,
            );

            await wallet.destroy_tx_handle(txHandle);
            txHandle = null;

            await multisigExportOverlay({
              data: signedDataCopy,
              header: `Signed multisig tx (${signersNeeded} more signatures needed)`,
              fileName: "signed-multisig-tx",
            });
            if (isUnmountedRef.current) {
              return;
            }
            setState({ type: "entering" });
          } else {
            const txInfos = await wallet.get_multisig_tx_set_info(txHandle);
            if (isUnmountedRef.current) {
              return;
            }
            setState({
              type: "sending",
              info: txInfos,
            });
            await withFsLock(async () => {
              if (txHandle === null) {
                throw new Error("Multisig transaction handle is not available");
              }
              await wallet.transfer_commit_tx_multisig(txHandle);
              await wallet.store();
            });
            await wallet.destroy_tx_handle(txHandle);
            txHandle = null;
            if (isUnmountedRef.current) {
              return;
            }
            setState({
              type: "sent",
              info: txInfos,
            });
            scheduleRefresh();
          }
        } catch (e) {
          if (txHandle !== null) {
            await wallet.destroy_tx_handle(txHandle);
          }
          if (isUnmountedRef.current) {
            return;
          }
          setState({
            type: "error",
            message:
              (e as Error).message ??
              "Failed to sign partially signed multisig transaction",
          });
        }
      })();
    } else {
      state.kind satisfies never;
    }
  }

  async function handleLoadCoins() {
    const loadingState: CoinsOverlayState = {
      type: "loading",
      showSpent: false,
    };
    setCoinsOverlayState(loadingState);
    try {
      const result = await wallet.get_transfers();
      if (isUnmountedRef.current) {
        return;
      }
      setCoinsOverlayState((prev) =>
        prev === loadingState
          ? {
              type: "ready",
              coins: result,
              showSpent: false,
            }
          : prev,
      );
    } catch (e) {
      if (isUnmountedRef.current) {
        return;
      }
      setCoinsOverlayState((prev) =>
        prev === loadingState
          ? {
              type: "error",
              message: (e as Error)?.message || "Failed to load coins",
              showSpent: false,
            }
          : prev,
      );
    }
  }

  function closeCoinsOverlay() {
    setCoinsOverlayState(null);
  }

  async function handleStartSignMultisigFlow() {
    if (!showMultisigActions || state.type !== "entering") {
      return;
    }

    const imported = await multisigImportOverlay({
      header: "Paste multisig tx data here",
    });
    if (isUnmountedRef.current) {
      return;
    }
    if (imported === null) {
      return;
    }

    const importData = new Uint8Array(imported.length);
    importData.set(imported);

    setState({ type: "multisig-info-loading" });
    let handle: WalletTxHandle | null = null;
    try {
      handle = await wallet.load_multisig_tx(importData, false);
      const txInfos = await wallet.get_multisig_tx_set_info(handle);
      const multisigStatus = await wallet.get_multisig_status();
      if (isUnmountedRef.current) {
        await wallet.destroy_tx_handle(handle);
        return;
      }

      const signersCountWithoutMe = await wallet.get_multisig_tx_signers_count(
        handle,
        true,
      );
      const signersCountWithMe = await wallet.get_multisig_tx_signers_count(
        handle,
        false,
      );
      const signersNeeded = Math.max(
        multisigStatus.threshold - signersCountWithoutMe,
        0,
      );

      await wallet.destroy_tx_handle(handle);
      handle = null;

      if (signersCountWithoutMe !== signersCountWithMe) {
        throw new Error("This wallet already signed this transaction");
      }

      setState({
        type: "confirming",
        info: txInfos,
        kind: {
          type: "continue-multisig",
          importData,
          iAmTheLastSigner: signersNeeded === 1,
        },
      });
    } catch (e) {
      if (handle !== null) {
        await wallet.destroy_tx_handle(handle);
      }
      if (isUnmountedRef.current) {
        return;
      }
      setState({
        type: "error",
        message: (e as Error)?.message || "Failed to parse multisig tx data",
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

  function handleCancelConfirm() {
    if (state.type !== "confirming") {
      return;
    }
    if (
      state.kind.type === "non-multisig" ||
      state.kind.type === "new-multisig"
    ) {
      void wallet.destroy_tx_handle(state.kind.txHandle);
    } else if (state.kind.type === "continue-multisig") {
      // No handles to clean up in this
    } else {
      state.kind satisfies never;
    }

    setState({ type: "entering" });
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
        if (cancelled) {
          return;
        }
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
        if (isClosed) {
          return;
        }
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
      if (isUnmountedRef.current) {
        return;
      }
      setCameraState((prev) => ({ ...prev, torchOn: next }));
    } catch (e) {
      if (isUnmountedRef.current) {
        return;
      }
      console.error("Failed to toggle torch:", e);
      setScannerError((e as Error).message || "Cannot toggle camera light.");
    } finally {
      if (isUnmountedRef.current) {
        return;
      }
      setCameraState((prev) => ({ ...prev, torchBusy: false }));
    }
  }, [
    cameraState.torchAvailable,
    cameraState.torchBusy,
    cameraState.torchOn,
    isUnmountedRef,
  ]);

  function updateRecipient(index: number, next: Partial<RecipientInput>) {
    setRecipients((prevRecipients) =>
      prevRecipients.map((recipient, i) =>
        i === index ? { ...recipient, ...next } : recipient,
      ),
    );
  }

  function addRecipient() {
    if (hasAllRecipient) {
      return;
    }
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

  const renderCoinsOverlayContent = () => (
    <>
      <div className="space-y-1 border-b border-white/10 pb-3">
        <div className="text-base font-semibold text-white/90">Coins</div>
        <div className="text-sm text-white/70">Wallet transfer outputs.</div>
      </div>

      <div className="min-h-0 flex-1 py-3">
        <div className="scrollbar-glass h-full overflow-y-auto rounded-lg bg-white/5 p-3 ring-1 ring-white/10">
          {coinsOverlayState?.type === "loading" && (
            <div className="text-sm text-white/80">Loading coins...</div>
          )}
          {coinsOverlayState?.type === "error" && (
            <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-100 ring-1 ring-red-300/30">
              {coinsOverlayState.message}
            </div>
          )}
          {coinsOverlayState?.type === "ready" && (
            <>
              {(coinsOverlayState.showSpent
                ? coinsOverlayState.coins
                : coinsOverlayState.coins.filter((coin) => !coin.spent)
              ).length === 0 ? (
                <div className="text-sm text-white/65">No coins found.</div>
              ) : (
                <div className="space-y-3">
                  {[
                    ...(coinsOverlayState.showSpent
                      ? coinsOverlayState.coins
                      : coinsOverlayState.coins.filter((coin) => !coin.spent)),
                  ]
                    .reverse()
                    .map((coin, index) => {
                      const isSpent = coin.spent;
                      return (
                        <SurfaceCard
                          key={`${coin.txid}-${coin.global_output_index.toString()}-${index}`}
                          className={`space-y-1.5 p-2.5 ${
                            isSpent
                              ? "bg-white/[0.025] text-white/45 ring-white/10"
                              : "text-white/80"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span
                              className={
                                isSpent ? "text-white/50" : "text-white"
                              }
                            >
                              {balanceToString(coin.amount)} XMR
                            </span>
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${
                                isSpent
                                  ? "bg-white/[0.02] text-white/40 ring-white/15"
                                  : "bg-white/10 text-white/70 ring-white/20"
                              }`}
                            >
                              spent: {coin.spent ? "true" : "false"}
                            </span>
                          </div>
                          <div className="text-[11px] break-all font-mono">
                            <span className="text-white/45">txid:</span>{" "}
                            {coin.txid}
                          </div>
                          <div className="grid grid-cols-1 gap-x-2 gap-y-0.5 text-[11px] sm:grid-cols-2">
                            <div>
                              <span className="text-white/45">
                                block_height:
                              </span>{" "}
                              {coin.block_height.toString()}
                            </div>
                            <div>
                              <span className="text-white/45">
                                global_output_index:
                              </span>{" "}
                              {coin.global_output_index.toString()}
                            </div>
                            <div>
                              <span className="text-white/45">
                                local_output_index:
                              </span>{" "}
                              {coin.local_output_index.toString()}
                            </div>
                            <div>
                              <span className="text-white/45">froze:</span>{" "}
                              {coin.froze ? "true" : "false"}
                            </div>
                            <div>
                              <span className="text-white/45">
                                spent_height:
                              </span>{" "}
                              {coin.spent_height.toString()}
                            </div>
                            <div>
                              <span className="text-white/45">rct:</span>{" "}
                              {coin.rct ? "true" : "false"}
                            </div>
                            <div>
                              <span className="text-white/45">
                                key_image_known:
                              </span>{" "}
                              {coin.key_image_known ? "true" : "false"}
                            </div>
                            <div>
                              <span className="text-white/45">
                                key_image_request:
                              </span>{" "}
                              {coin.key_image_request ? "true" : "false"}
                            </div>
                            <div>
                              <span className="text-white/45">
                                subaddr_index:
                              </span>{" "}
                              {coin.subaddr_index_major}/
                              {coin.subaddr_index_minor}
                            </div>
                            <div>
                              <span className="text-white/45">
                                key_image_partial:
                              </span>{" "}
                              {coin.key_image_partial ? "true" : "false"}
                            </div>
                          </div>
                        </SurfaceCard>
                      );
                    })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="border-t border-white/10 pt-3">
        <div className="flex items-center justify-between gap-2">
          <Toggle
            checked={Boolean(coinsOverlayState?.showSpent)}
            onChange={(next) =>
              setCoinsOverlayState((prev) =>
                prev ? { ...prev, showSpent: next } : prev,
              )
            }
            label="Show spent"
            className={`max-w-[180px] p-2 ${
              coinsOverlayState?.type === "loading"
                ? "pointer-events-none opacity-60"
                : ""
            }`}
          />
          <Button
            type="button"
            variant="soft"
            className="!flex-none px-4 py-1.5 text-xs"
            onClick={closeCoinsOverlay}
          >
            ✖ Close
          </Button>
        </div>
      </div>
    </>
  );

  const renderEnterTxInfoData = () =>
    state.type === "entering" && isViewOnly === false ? (
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
                disabled={hasAllRecipient}
              >
                ➕︎ Add destination
              </Button>
              <Button
                variant="soft"
                type="button"
                onClick={() => setScannerOpen((s) => !s)}
                className="!flex-none px-2.5 py-1 text-xs"
              >
                {scannerOpen ? "✖ Close scanner" : "▣ Scan QR"}
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
                  ↺ Switch camera
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
                  {cameraState.torchOn ? "◎ Light off" : "◉ Light on"}
                </Button>
              </div>
              <div className="text-xs text-white/55">
                Scan a QR with one or many recipients as plain addresses or{" "}
                <span className="font-mono">monero:</span> URIs.
              </div>
              {scannerError && (
                <div className="rounded-md bg-red-500/10 p-2 text-xs text-red-300 ring-1 ring-red-500/30">
                  {scannerError}
                </div>
              )}
            </SurfaceCard>
          )}

          {recipients.map((recipient, index) => {
            const isAllAmount = isAllAmountInput(recipient.amount);
            const parsedAmount = parseXmrToAtomic(recipient.amount);
            const allAmountEstimate =
              isAllAmount && currentUnlockedNonStrictBalance !== null
                ? currentUnlockedNonStrictBalance -
                  parsedRecipients.reduce(
                    (sum, item, itemIndex) =>
                      itemIndex !== index &&
                      !item.isAllAmount &&
                      item.parsedAmount !== null &&
                      item.parsedAmount > 0n
                        ? sum + item.parsedAmount
                        : sum,
                    0n,
                  )
                : null;
            const fiatValue = (() => {
              if (!price) {
                return null;
              }
              if (isAllAmount) {
                if (allAmountEstimate === null || allAmountEstimate <= 0n) {
                  return null;
                }
                return toFiat(allAmountEstimate, price);
              }
              if (parsedAmount === null || parsedAmount <= 0n) {
                return null;
              }
              return toFiat(parsedAmount, price);
            })();

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
                    ✖ Remove
                  </Button>
                </div>

                <div>
                  <Label>Recipient address</Label>
                  <Input
                    aria-label={`Recipient ${index + 1} address`}
                    value={recipient.address}
                    onChange={(e) =>
                      updateRecipient(index, {
                        address: e.target.value,
                      })
                    }
                    placeholder="Enter Monero address"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono text-sm"
                  />
                </div>

                <div>
                  <Label>Amount (XMR)</Label>
                  <InputWithAction
                    aria-label={`Recipient ${index + 1} amount`}
                    type="text"
                    inputMode="decimal"
                    value={recipient.amount}
                    onChange={(e) =>
                      updateRecipient(index, {
                        amount: e.target.value,
                      })
                    }
                    placeholder="0.000000000000"
                    autoComplete="off"
                    actionLabel="All"
                    actionDisabled={
                      hasMultipleRecipients ||
                      parsedRecipients.some(
                        (parsedRecipient, parsedIndex) =>
                          parsedIndex !== index && parsedRecipient.isAllAmount,
                      )
                    }
                    onAction={() =>
                      updateRecipient(index, {
                        amount: "ALL",
                      })
                    }
                  />
                  {fiatValue !== null && (
                    <div className="mt-1 text-xs text-white/50">
                      ≈ {fiatValue.toFixed(2)} EUR
                    </div>
                  )}
                  {isAllAmount && (
                    <div className="mt-1 text-xs text-white/50">
                      Wallet will sweep your spendable unlocked balance minus
                      network fees to this address. The final amount may be sent
                      in one or more transactions.
                    </div>
                  )}
                </div>
              </SurfaceCard>
            );
          })}
          {hasAllRecipient && (
            <div className="rounded-xl bg-white/6 px-3 py-2 text-xs text-white/70 ring-1 ring-white/10">
              Amount ALL only supports one destination. Add destination is
              disabled until ALL is cleared.
            </div>
          )}

          <div>
            <Label>Priority</Label>
            <Select.Root
              value={String(feePriority)}
              onValueChange={(next) => {
                setFeePriority(Number(next) as FeePriorityValue);
              }}
            >
              <Select.Trigger>
                <Select.Value>{FEE_PRIORITY_LABELS[feePriority]}</Select.Value>
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
          → Review transaction
        </Button>
      </>
    ) : null;

  return (
    <>
      <div className="scrollbar-glass h-auto overflow-visible pr-1 lg:h-full lg:min-h-0 lg:overflow-auto">
        <div className="space-y-4 pb-2">
          {/* ENTERING */}
          {state.type === "entering" && (
            <>
              {renderEnterTxInfoData()}
              {isViewOnly === true && (
                <SurfaceCard className="text-sm text-white/75">
                  Wallet is view-only
                </SurfaceCard>
              )}
              <div className="border-t border-white/10 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    variant="neutral"
                    type="button"
                    onClick={() => {
                      void handleLoadCoins();
                    }}
                    className="!flex-none !px-4 !py-2 text-sm"
                  >
                    ☰ Show coins
                  </Button>
                  {isViewOnly === false && showMultisigActions && (
                    <Button
                      variant="neutral"
                      type="button"
                      onClick={() => {
                        void handleStartSignMultisigFlow();
                      }}
                      className="!flex-none !px-4 !py-2 text-sm"
                    >
                      ✎ Sign multisig tx
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}

          {state.type === "building-transaction" && (
            <ShimmerStatus text="Building transaction..." />
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
                  const { balanceAfterSending, immediatelyUnlocked } =
                    getPostSendBalances(
                      currentTotalNonStrictBalance,
                      currentUnlockedNonStrictBalance,
                      summary.totalOutgoing,
                      summary.totalFee,
                      summary.totalChange,
                    );
                  return (
                    <>
                      <div>
                        <div className="text-xs text-white/60">
                          Total outgoing
                        </div>
                        <div
                          aria-label="Send review total outgoing value"
                          className="text-lg font-semibold text-white"
                        >
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

                      <div>
                        <div className="text-xs text-white/60">
                          Balance after sending
                        </div>
                        {balanceAfterSending !== null ? (
                          <>
                            <div
                              aria-label="Send review balance after sending value"
                              className="text-sm text-white"
                            >
                              {formatAtomicToXmr(balanceAfterSending)} XMR
                            </div>
                            {price && (
                              <div className="text-xs text-white/50">
                                ≈{" "}
                                {toFiat(balanceAfterSending, price).toFixed(2)}{" "}
                                EUR
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-sm text-white/60">
                            Balance is loading...
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="text-xs text-white/60">
                          Unlocked balance after sending
                        </div>
                        {immediatelyUnlocked !== null ? (
                          <>
                            <div
                              aria-label="Send review unlocked balance after sending value"
                              className="text-sm text-white"
                            >
                              {formatAtomicToXmr(immediatelyUnlocked)} XMR
                            </div>
                            {price && (
                              <div className="text-xs text-white/50">
                                ≈{" "}
                                {toFiat(immediatelyUnlocked, price).toFixed(2)}{" "}
                                EUR
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-sm text-white/60">
                            Balance is loading...
                          </div>
                        )}
                      </div>

                      {summary.destinations.length === 1 && (
                        <div>
                          <div className="text-xs text-white/60 pt-2">
                            To address
                          </div>
                          <div
                            aria-label="Send review destination address"
                            className="break-all font-mono text-xs text-white/80"
                          >
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
                              <div
                                aria-label={`Send review recipient ${index + 1} address`}
                                className="break-all font-mono text-[11px] text-white/75"
                              >
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
                  onClick={handleCancelConfirm}
                  className="text-sm font-semibold"
                >
                  ✖ Cancel
                </Button>

                <Button
                  onClick={handleConfirm}
                  variant="primary"
                  className="text-sm font-semibold"
                >
                  {state.kind.type === "non-multisig"
                    ? "✓ Confirm & Send"
                    : state.kind.type === "continue-multisig"
                      ? !state.kind.iAmTheLastSigner
                        ? "✓ Confirm"
                        : "✓ Finalize & Send"
                      : state.kind.type === "new-multisig"
                        ? "✓ Confirm"
                        : (state.kind satisfies never)}
                </Button>
              </ButtonsHolder>
            </div>
          )}

          {state.type === "multisig-signing" && (
            <ShimmerStatus text="Signing multisig transaction..." />
          )}

          {state.type === "multisig-exporting" && (
            <ShimmerStatus text="Preparing multisig tx export..." />
          )}

          {/* SENDING */}
          {state.type === "sending" && (
            <ShimmerStatus text="Broadcasting transaction..." />
          )}

          {/* SENT */}
          {state.type === "sent" &&
            (() => {
              const summary = summarizeTransfers(state.info);
              return (
                <div className="space-y-4 text-center">
                  <div className="text-green-400 text-lg font-semibold">
                    ✓ Transaction sent
                  </div>

                  <div className="space-y-1">
                    <div className="text-sm text-white">
                      Total sent: {formatAtomicToXmr(summary.totalOutgoing)} XMR
                    </div>
                    {price && (
                      <div className="text-xs text-white/50">
                        ≈ {toFiat(summary.totalOutgoing, price).toFixed(2)} EUR
                      </div>
                    )}
                  </div>

                  <div className="text-xs text-white/50">
                    Fee paid: {formatAtomicToXmr(summary.totalFee)} XMR
                  </div>

                  <Button
                    onClick={reset}
                    variant="primary"
                    className="w-full text-sm font-semibold"
                  >
                    → Send another
                  </Button>
                </div>
              );
            })()}

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
                ↺ Try again
              </Button>
            </div>
          )}
        </div>
      </div>
      {coinsOverlayState && (
        <FullscreenOverlayPanel>
          {renderCoinsOverlayContent()}
        </FullscreenOverlayPanel>
      )}
    </>
  );
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
