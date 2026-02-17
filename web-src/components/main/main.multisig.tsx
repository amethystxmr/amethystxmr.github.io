import React from "react";
import {
  MoneroWasmWallet,
  MultisigAccountStatus,
  PaymentDetailsTransformed,
} from "../../../monero-wasm-module/walletApi";
import {
  Button,
  ButtonRadioRow,
  Label,
  SurfaceCard,
  TextArea,
  useAlert,
  usePasswordPrompt,
} from "../ui";
import { withFsLock } from "../utils";

const PARTICIPANT_OPTIONS = Array.from({ length: 15 }, (_, i) => i + 2);

function MultisigTabWrap({ children }: React.PropsWithChildren) {
  return <div className="mt-2 space-y-3 lg:mt-0 lg:h-full">{children}</div>;
}

const LAST_KEX_MESSAGE_ATTRIBUTE = "amethystxmr_last_kex_message";
const LAST_MULTISIG_KEX_ROUND_ATTRIBUTE = "amethystxmr_last_multisig_kex_round";

type LoadableString =
  | { type: "loading" }
  | { type: "ready"; value: string }
  | { type: "error"; error: string };

export function MultisigTab({
  wallet,
  multisigStatus,
  onRefresh,
  payments,
  mempoolPayments,
  walletHeight,
  daemonHeight,
}: {
  wallet: MoneroWasmWallet;
  multisigStatus: MultisigAccountStatus | null;
  onRefresh: () => void;
  payments: PaymentDetailsTransformed[] | null;
  mempoolPayments: PaymentDetailsTransformed[] | null;
  walletHeight: bigint | null;
  daemonHeight: bigint | null;
}) {
  const alert = useAlert();
  const { promptForWalletPassword, passwordPromptDialog } = usePasswordPrompt();

  // State model:
  // 1) `multisigStatus === null` -> initial loading.
  // 2) `!multisig_is_active` -> prepare flow.
  // 3) `multisig_is_active && is_ready` -> ready summary.
  // 4) `multisig_is_active && !is_ready` -> exchange flow.

  const [busy, setBusy] = React.useState(false);

  const isUnmountedRef = React.useRef(false);

  React.useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
    };
  }, []);

  // No-multisig flow state
  const [allowPrepareWhileSyncing, setAllowPrepareWhileSyncing] =
    React.useState(false);
  const [myRound1Message, setMyRound1Message] =
    React.useState<LoadableString | null>(null);
  const [participants, setParticipants] = React.useState(3);
  const [threshold, setThreshold] = React.useState(2);
  const [showAllParticipants, setShowAllParticipants] = React.useState(false);
  const [othersRound1Messages, setOthersRound1Messages] = React.useState("");

  // Active multisig setup state
  const [myLastKexMessage, setMyLastKexMessage] =
    React.useState<LoadableString>({ type: "loading" });
  const [myLastKexRound, setMyLastKexRound] = React.useState<LoadableString>({
    type: "loading",
  });
  const [othersRoundMessages, setOthersRoundMessages] = React.useState("");

  const isWalletSyncing =
    walletHeight !== null &&
    daemonHeight !== null &&
    walletHeight < daemonHeight;
  const hasAnyPayments =
    payments !== null &&
    mempoolPayments !== null &&
    (payments.length > 0 || mempoolPayments.length > 0);

  const isPrepareBlockedByPayments = hasAnyPayments;
  const isPrepareBlockedBySync = isWalletSyncing && !allowPrepareWhileSyncing;

  const requestValidWalletPassword = React.useCallback(async () => {
    if (await wallet.verify_password("")) {
      return "";
    }
    let message = "Enter wallet password";
    while (true) {
      const password = await promptForWalletPassword(message);
      if (password === null) {
        return null;
      }
      if (await wallet.verify_password(password)) {
        return password;
      }
      message = "Incorrect wallet password. Try again.";
    }
  }, [promptForWalletPassword, wallet]);

  // Load current setup-round attributes only while multisig is active and not ready.
  React.useEffect(() => {
    if (
      multisigStatus === null ||
      !multisigStatus.multisig_is_active ||
      multisigStatus.is_ready
    ) {
      return;
    }

    let cancelled = false;
    setMyLastKexMessage({ type: "loading" });
    setMyLastKexRound({ type: "loading" });

    Promise.all([
      wallet.get_attribute(LAST_KEX_MESSAGE_ATTRIBUTE),
      wallet.get_attribute(LAST_MULTISIG_KEX_ROUND_ATTRIBUTE),
    ])
      .then(([lastKexMessage, lastKexRound]) => {
        if (cancelled) {
          return;
        }
        setMyLastKexMessage({ type: "ready", value: lastKexMessage });
        setMyLastKexRound({ type: "ready", value: lastKexRound });
      })
      .catch((e) => {
        if (cancelled) {
          return;
        }
        const message = (e as Error)?.message || "Unknown error";
        setMyLastKexMessage({ type: "error", error: message });
        setMyLastKexRound({ type: "error", error: message });
      });

    return () => {
      cancelled = true;
    };
  }, [multisigStatus, wallet]);

  const handlePrepareMultisig = React.useCallback(async () => {
    if (busy) {
      return;
    }
    if (isPrepareBlockedByPayments || isPrepareBlockedBySync) {
      return;
    }

    setBusy(true);
    setMyRound1Message({ type: "loading" });
    try {
      const message = await wallet.prepare_multisig();
      if (isUnmountedRef.current) {
        return;
      }
      setMyRound1Message({ type: "ready", value: message });
    } catch (e) {
      if (isUnmountedRef.current) {
        return;
      }
      const errorMessage =
        (e as Error)?.message || "Unknown error while preparing multisig";
      setMyRound1Message({ type: "error", error: errorMessage });
    } finally {
      if (!isUnmountedRef.current) {
        setBusy(false);
      }
    }
  }, [busy, isPrepareBlockedByPayments, isPrepareBlockedBySync, wallet]);

  const handleMakeMultisig = React.useCallback(async () => {
    if (busy) {
      return;
    }
    if (myRound1Message?.type !== "ready") {
      return;
    }

    try {
      setBusy(true);
      const messages = othersRound1Messages
        .split(/[\s\n]+/)
        .map((m) => m.trim())
        .filter((m) => m.length > 0);
      if (messages.length !== participants) {
        throw new Error(`Expected ${participants} messages`);
      }

      const password = await requestValidWalletPassword();
      if (password === null) {
        if (!isUnmountedRef.current) {
          setBusy(false);
        }
        return;
      }

      await withFsLock(async () => {
        const nextKexMessage = await wallet.make_multisig(
          password,
          messages,
          threshold,
        );
        await wallet.set_attribute(LAST_KEX_MESSAGE_ATTRIBUTE, nextKexMessage);
        await wallet.set_attribute(LAST_MULTISIG_KEX_ROUND_ATTRIBUTE, "1");
        await wallet.store();
      });

      if (isUnmountedRef.current) {
        return;
      }
      setOthersRound1Messages("");
      setMyRound1Message({ type: "loading" });
      onRefresh();
    } catch (e) {
      const message =
        (e as Error)?.message || "Unknown error while making multisig";
      if (!isUnmountedRef.current) {
        await alert(message);
      }
    } finally {
      if (!isUnmountedRef.current) {
        setBusy(false);
      }
    }
  }, [
    alert,
    busy,
    onRefresh,
    othersRound1Messages,
    participants,
    myRound1Message,
    requestValidWalletPassword,
    threshold,
    wallet,
  ]);

  const handleExchangeMultisigKeys = React.useCallback(async () => {
    if (busy) {
      return;
    }

    try {
      setBusy(true);

      const messages = othersRoundMessages
        .split(/[\s\n]+/)
        .map((m) => m.trim())
        .filter((m) => m.length > 0);

      const password = await requestValidWalletPassword();
      if (password === null) {
        if (!isUnmountedRef.current) {
          setBusy(false);
        }
        return;
      }

      await withFsLock(async () => {
        const nextKexMessage = await wallet.exchange_multisig_keys(
          password,
          messages,
        );
        await wallet.set_attribute(LAST_KEX_MESSAGE_ATTRIBUTE, nextKexMessage);

        const nextRound =
          myLastKexRound.type === "ready" && myLastKexRound.value !== ""
            ? String(Number(myLastKexRound.value) + 1)
            : "";
        await wallet.set_attribute(
          LAST_MULTISIG_KEX_ROUND_ATTRIBUTE,
          nextRound,
        );
        await wallet.store();
      });

      if (isUnmountedRef.current) {
        return;
      }
      setOthersRoundMessages("");
      setMyLastKexMessage({ type: "loading" });
      onRefresh();
    } catch (e) {
      const message =
        (e as Error)?.message || "Unknown error while exchanging multisig keys";
      if (!isUnmountedRef.current) {
        await alert(`Failed to exchange multisig keys: ${message}`);
      }
    } finally {
      if (!isUnmountedRef.current) {
        setBusy(false);
      }
    }
  }, [
    alert,
    busy,
    myLastKexRound,
    onRefresh,
    othersRoundMessages,
    requestValidWalletPassword,
    wallet,
  ]);

  if (multisigStatus === null) {
    return (
      <MultisigTabWrap>
        <SurfaceCard className="text-sm text-white/75">
          Loading initial status...
        </SurfaceCard>
      </MultisigTabWrap>
    );
  }

  if (!multisigStatus.multisig_is_active) {
    return (
      <>
        <MultisigTabWrap>
          <SurfaceCard className="space-y-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
            {myRound1Message === null ? (
              <>
                <div className="space-y-2 text-sm text-white/75">
                  <p>
                    Multisig lets this wallet require multiple participants to
                    authorize spending (for example, 2-of-3).
                  </p>
                  <p>
                    Start by generating your initial key exchange message, then
                    collect messages from all participants. Depending on
                    threshold and participants, multiple rounds of key exchange
                    may be required.
                  </p>
                  <p>
                    This is recommended on a wallet with no transfers. If the
                    wallet is still syncing, waiting is recommended but you can
                    continue at your own risk.
                  </p>
                </div>

                {isPrepareBlockedByPayments && (
                  <SurfaceCard className="text-sm text-white/75">
                    Not possible when wallet has transfers.
                  </SurfaceCard>
                )}

                {isWalletSyncing && (
                  <SurfaceCard className="space-y-2 text-sm text-white/75">
                    <div>Wallet is not synced yet.</div>
                    <div className="text-white/65">
                      You can still make multisig now, but it is recommended to
                      wait until sync completes.
                    </div>
                    <label className="inline-flex items-center gap-2 text-white/80">
                      <input
                        type="checkbox"
                        className="accent-white"
                        checked={allowPrepareWhileSyncing}
                        onChange={(e) =>
                          setAllowPrepareWhileSyncing(e.target.checked)
                        }
                      />
                      Allow start multisig while syncing
                    </label>
                  </SurfaceCard>
                )}

                <Button
                  variant="primary"
                  className="!flex-none w-full py-2.5"
                  disabled={
                    busy || isPrepareBlockedByPayments || isPrepareBlockedBySync
                  }
                  onClick={() => {
                    void handlePrepareMultisig();
                  }}
                >
                  {busy ? "Preparing multisig..." : "Prepare multisig"}
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  {/* TODO: Add a (i) tooltip with explanation that it 
                  can be different each time but it is ok to use previous one 
                  from the same wallet. Because it is generated on component mount, 
                  but it the same data inside
                  Make this message somehow understanble for non-technical users
                    
                  */}
                  <Label>Your round 1 message</Label>
                  <TextArea
                    readOnly
                    rows={1}
                    className={`resize-none overflow-hidden [field-sizing:content] ${myRound1Message.type === "error" ? "border border-red-400/60" : ""}`}
                    value={
                      myRound1Message.type === "loading"
                        ? "Loading..."
                        : myRound1Message.type === "error"
                          ? `Error: ${myRound1Message.error}`
                          : myRound1Message.value
                    }
                  />
                </div>

                <div className="space-y-1 lg:grid lg:grid-cols-[190px_minmax(0,1fr)] lg:items-start lg:gap-2 lg:space-y-0">
                  <div className="text-sm font-semibold text-white/85">
                    Amount of participants
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8 lg:gap-1">
                    {(showAllParticipants
                      ? PARTICIPANT_OPTIONS
                      : [2, 3, 4]
                    ).map((option) => (
                      <Button
                        key={option}
                        type="button"
                        className="w-full px-2.5 py-1.5 text-xs"
                        variant={option === participants ? "primary" : "soft"}
                        disabled={busy}
                        onClick={() => {
                          setParticipants(option);
                          setThreshold((prev) => Math.min(prev, option));
                        }}
                      >
                        {option}
                      </Button>
                    ))}
                    {!showAllParticipants && (
                      <Button
                        type="button"
                        className="w-full px-2.5 py-1.5 text-xs"
                        variant="soft"
                        disabled={busy}
                        onClick={() => setShowAllParticipants(true)}
                      >
                        More
                      </Button>
                    )}
                  </div>
                </div>

                <ButtonRadioRow
                  label="Threshold"
                  options={Array.from(
                    { length: participants },
                    (_, i) => i + 1,
                  )}
                  value={threshold}
                  compact
                  disabled={busy}
                  onChange={setThreshold}
                />

                <div className="space-y-1 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
                  <Label>All participants round 1 messages</Label>
                  <TextArea
                    rows={10}
                    className="resize-none lg:min-h-0 lg:flex-1"
                    value={othersRound1Messages}
                    onChange={(e) => setOthersRound1Messages(e.target.value)}
                  />
                </div>

                <Button
                  variant="primary"
                  className="!flex-none w-full py-2.5"
                  disabled={busy || myRound1Message.type !== "ready"}
                  onClick={() => {
                    void handleMakeMultisig();
                  }}
                >
                  {busy
                    ? `Making ${threshold}/${participants} multisig...`
                    : `Make ${threshold}/${participants} multisig`}
                </Button>
              </>
            )}
          </SurfaceCard>
        </MultisigTabWrap>
        {passwordPromptDialog}
      </>
    );
  }

  if (multisigStatus.is_ready) {
    return (
      <MultisigTabWrap>
        <SurfaceCard className="space-y-1 text-sm text-white/75">
          <div className="text-white/90">Wallet is multisig</div>
          <div>
            {multisigStatus.threshold}-of-{multisigStatus.total}
          </div>
        </SurfaceCard>
      </MultisigTabWrap>
    );
  }

  const thisRound =
    myLastKexRound.type === "loading"
      ? "[...]"
      : myLastKexRound.type === "error"
        ? `[${myLastKexRound.error}]`
        : myLastKexRound.value === ""
          ? "[error]"
          : Number(myLastKexRound.value) + 1;

  const totalRounds = multisigStatus.total - multisigStatus.threshold + 2;

  return (
    <>
      <MultisigTabWrap>
        <SurfaceCard className="space-y-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
          <div className="text-sm font-semibold text-white/85">
            Setting up {multisigStatus.threshold}/{multisigStatus.total}{" "}
            multisig, round {thisRound} from {totalRounds}
          </div>
          <div className="space-y-1">
            <Label>Your message for this round</Label>
            <TextArea
              readOnly
              rows={1}
              className="resize-none overflow-hidden [field-sizing:content]"
              value={
                myLastKexMessage.type === "loading"
                  ? "Loading..."
                  : myLastKexMessage.type === "error"
                    ? `Error: ${myLastKexMessage.error}`
                    : myLastKexMessage.value === ""
                      ? "Error: no attribute found"
                      : myLastKexMessage.value
              }
            />
          </div>
          <div className="space-y-1 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
            <Label>All participants round {thisRound} messages</Label>
            <TextArea
              rows={12}
              className="resize-none lg:min-h-0 lg:flex-1"
              value={othersRoundMessages}
              onChange={(e) => setOthersRoundMessages(e.target.value)}
            />
          </div>
          <Button
            variant="primary"
            className="!flex-none w-full py-2.5"
            disabled={busy}
            onClick={() => {
              void handleExchangeMultisigKeys();
            }}
          >
            {busy ? "Exchanging keys..." : "Exchange multisig keys"}
          </Button>
        </SurfaceCard>
      </MultisigTabWrap>
      {passwordPromptDialog}
    </>
  );
}
