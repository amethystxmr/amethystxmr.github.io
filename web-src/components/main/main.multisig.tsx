import React from "react";
import {
  MoneroWasmWallet,
  multisig_account_status,
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

type MultisigUiState =
  | { type: "loading" }
  | {
      type: "round1";
      prepareMessage: string;
      othersKexMessages: string;
      participants: number;
      threshold: number;
      showAllParticipants: boolean;
      making: boolean;
    }
  | {
      type: "roundN";
      status: multisig_account_status;
      othersKexMessages: string;
      exchanging: boolean;
    }
  | {
      type: "ready";
      status: multisig_account_status;
    }
  | {
      type: "error";
      message: string;
    };

const PARTICIPANT_OPTIONS = Array.from({ length: 15 }, (_, i) => i + 2);

function MultisigTabWrap({ children }: React.PropsWithChildren) {
  return <div className="mt-2 space-y-3 lg:mt-0 lg:h-full">{children}</div>;
}

export function MultisigTab({
  wallet,
  onRefresh,
  payments,
  mempoolPayments,
  walletHeight,
  daemonHeight,
}: {
  wallet: MoneroWasmWallet;
  onRefresh: () => void;
  payments: PaymentDetailsTransformed[] | null;
  mempoolPayments: PaymentDetailsTransformed[] | null;
  walletHeight: bigint | null;
  daemonHeight: bigint | null;
}) {
  const alert = useAlert();
  const [reloadToken, setReloadToken] = React.useState(0);
  const [state, setState] = React.useState<MultisigUiState>({
    type: "loading",
  });
  const { promptForWalletPassword, passwordPromptDialog } = usePasswordPrompt();
  const requestValidWalletPassword = React.useCallback(async () => {
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
  const isPropsLoading =
    payments === null ||
    mempoolPayments === null ||
    walletHeight === null ||
    daemonHeight === null;
  const isWalletSyncing =
    walletHeight !== null &&
    daemonHeight !== null &&
    walletHeight < daemonHeight;
  const hasAnyPayments =
    payments !== null &&
    mempoolPayments !== null &&
    (payments.length > 0 || mempoolPayments.length > 0);
  React.useEffect(() => {
    let cancelled = false;

    if (isPropsLoading || isWalletSyncing || hasAnyPayments) {
      return;
    }

    const loadState = async () => {
      setState({ type: "loading" });

      const status = await wallet.get_multisig_status();
      if (cancelled) {
        return;
      }

      if (!status.multisig_is_active) {
        const prepareMessage = await wallet.prepare_multisig();
        if (cancelled) {
          return;
        }
        setState({
          type: "round1",
          prepareMessage,
          othersKexMessages: "",
          participants: 2,
          threshold: 2,
          showAllParticipants: false,
          making: false,
        });
        return;
      }

      if (!status.is_ready) {
        setState({
          type: "roundN",
          status,
          othersKexMessages: "",
          exchanging: false,
        });
        return;
      }

      setState({ type: "ready", status });
    };

    void loadState().catch((e) => {
      if (cancelled) {
        return;
      }
      const message = (e as Error)?.message;
      setState({ type: "error", message });
    });
    return () => {
      cancelled = true;
    };
  }, [
    alert,
    hasAnyPayments,
    isPropsLoading,
    isWalletSyncing,
    reloadToken,
    wallet,
  ]);

  const handleMakeMultisig = React.useCallback(async () => {
    if (state.type !== "round1" || state.making) {
      return;
    }
    try {
      setState({ ...state, making: true });
      const othersKexMessages = state.othersKexMessages;
      const messages = othersKexMessages
        .split(/[\s\n]+/)
        .map((m) => m.trim())
        .filter((m) => m.length > 0);
      if (messages.length !== state.participants) {
        throw new Error(`Expected ${state.participants} messages`);
      }

      const password = await requestValidWalletPassword();
      if (password === null) {
        setState({ ...state, making: false });
        return;
      }

      const r = await withFsLock(() =>
        wallet.make_multisig(password, messages.join(" "), state.threshold),
      );
      console.log("make_multisig result:", r);

      onRefresh();
      setReloadToken((x) => x + 1);
    } catch (e) {
      const message =
        (e as Error)?.message || "Unknown error while making multisig";
      setState({ ...state, making: false });
      await alert(message);
    }
  }, [alert, onRefresh, requestValidWalletPassword, state]);

  const handleExchangeMultisigKeys = React.useCallback(async () => {
    if (state.type !== "roundN" || state.exchanging) {
      return;
    }
    try {
      setState({ ...state, exchanging: true });
      await new Promise((resolve) => setTimeout(resolve, 3000));
      onRefresh();
      setReloadToken((x) => x + 1);
    } catch (e) {
      const message =
        (e as Error)?.message || "Unknown error while exchanging multisig keys";
      setState({ ...state, exchanging: false });
      await alert(`Failed to exchange multisig keys: ${message}`);
    }
  }, [alert, onRefresh, state]);

  if (isPropsLoading) {
    return (
      <MultisigTabWrap>
        <SurfaceCard className="text-sm text-white/75">
          Loading wallet state...
        </SurfaceCard>
      </MultisigTabWrap>
    );
  }
  if (isWalletSyncing) {
    return (
      <MultisigTabWrap>
        <SurfaceCard className="text-sm text-white/75">
          Wallet is still syncing...
        </SurfaceCard>
      </MultisigTabWrap>
    );
  }
  if (hasAnyPayments) {
    return (
      <MultisigTabWrap>
        <SurfaceCard className="text-sm text-white/75">
          Wallet has payments, unable to do multisig
        </SurfaceCard>
      </MultisigTabWrap>
    );
  }
  if (state.type === "loading") {
    return (
      <MultisigTabWrap>
        <SurfaceCard className="text-sm text-white/75">
          Loading multisig status...
        </SurfaceCard>
      </MultisigTabWrap>
    );
  }
  if (state.type === "round1") {
    return (
      <>
        <MultisigTabWrap>
          <SurfaceCard className="space-y-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
            <div className="space-y-1">
              <Label>Your round 1 message</Label>
              <TextArea
                readOnly
                rows={1}
                className="resize-none overflow-hidden [field-sizing:content]"
                value={state.prepareMessage}
              />
            </div>

            <div className="space-y-1 lg:grid lg:grid-cols-[190px_minmax(0,1fr)] lg:items-start lg:gap-2 lg:space-y-0">
              <div className="text-sm font-semibold text-white/85">
                Amount of participants
              </div>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8 lg:gap-1">
                {(state.showAllParticipants
                  ? PARTICIPANT_OPTIONS
                  : [2, 3, 4]
                ).map((option) => (
                  <Button
                    key={option}
                    type="button"
                    className="w-full px-2.5 py-1.5 text-xs"
                    variant={option === state.participants ? "primary" : "soft"}
                    disabled={state.making}
                    onClick={() => {
                      setState((prev) => {
                        if (prev.type !== "round1") {
                          return prev;
                        }
                        const nextThreshold = Math.min(prev.threshold, option);
                        return {
                          ...prev,
                          participants: option,
                          threshold: nextThreshold,
                        };
                      });
                    }}
                  >
                    {option}
                  </Button>
                ))}
                {!state.showAllParticipants && (
                  <Button
                    type="button"
                    className="w-full px-2.5 py-1.5 text-xs"
                    variant="soft"
                    disabled={state.making}
                    onClick={() =>
                      setState((prev) =>
                        prev.type !== "round1"
                          ? prev
                          : { ...prev, showAllParticipants: true },
                      )
                    }
                  >
                    More
                  </Button>
                )}
              </div>
            </div>

            <ButtonRadioRow
              label="Threshold"
              options={Array.from(
                { length: state.participants },
                (_, i) => i + 1,
              )}
              value={state.threshold}
              compact
              disabled={state.making}
              onChange={(threshold) =>
                setState((prev) =>
                  prev.type !== "round1"
                    ? prev
                    : {
                        ...prev,
                        threshold,
                      },
                )
              }
            />

            <div className="space-y-1 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
              <Label>All participants round 1 messages</Label>
              <TextArea
                rows={10}
                className="resize-none lg:min-h-0 lg:flex-1"
                value={state.othersKexMessages}
                onChange={(e) =>
                  setState((prev) =>
                    prev.type !== "round1"
                      ? prev
                      : { ...prev, othersKexMessages: e.target.value },
                  )
                }
              />
            </div>

            <Button
              variant="primary"
              className="!flex-none w-full py-2.5"
              disabled={state.making}
              onClick={() => {
                void handleMakeMultisig();
              }}
            >
              {state.making
                ? `Making ${state.threshold}/${state.participants} multisig...`
                : `Make ${state.threshold}/${state.participants} multisig`}
            </Button>
          </SurfaceCard>
        </MultisigTabWrap>
        {passwordPromptDialog}
      </>
    );
  }
  if (state.type === "roundN") {
    return (
      <>
        <MultisigTabWrap>
          <SurfaceCard className="space-y-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
            <div className="text-sm font-semibold text-white/85">
              Setting up {state.status.threshold}/{state.status.total} multisig
            </div>
            <div className="space-y-1 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
              <Label>All participants round N messages</Label>
              <TextArea
                rows={12}
                className="resize-none lg:min-h-0 lg:flex-1"
                value={state.othersKexMessages}
                onChange={(e) =>
                  setState((prev) =>
                    prev.type !== "roundN"
                      ? prev
                      : { ...prev, othersKexMessages: e.target.value },
                  )
                }
              />
            </div>
            <Button
              variant="primary"
              className="!flex-none w-full py-2.5"
              disabled={state.exchanging}
              onClick={() => {
                void handleExchangeMultisigKeys();
              }}
            >
              {state.exchanging
                ? "Exchanging keys..."
                : "Exchange multisig keys"}
            </Button>
          </SurfaceCard>
        </MultisigTabWrap>
        {passwordPromptDialog}
      </>
    );
  }
  if (state.type === "ready") {
    return (
      <MultisigTabWrap>
        <SurfaceCard className="space-y-1 text-sm text-white/75">
          <div className="text-white/90">Wallet is multisig</div>
          <div>
            {state.status.threshold}-of-{state.status.total}
          </div>
        </SurfaceCard>
      </MultisigTabWrap>
    );
  }
  return (
    <MultisigTabWrap>
      <SurfaceCard className="space-y-2">
        <div className="text-sm text-red-200">
          {state.message || "Unknown error while loading multisig status"}
        </div>
        <Button
          variant="soft"
          className="w-full"
          onClick={() => setReloadToken((x) => x + 1)}
        >
          Retry
        </Button>
      </SurfaceCard>
    </MultisigTabWrap>
  );
}
