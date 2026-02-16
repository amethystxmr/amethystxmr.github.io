import React, { useEffect, useMemo } from "react";
import {
  max64,
  MoneroWasmWallet,
  MultisigAccountStatus,
  PaymentDetailsTransformed,
  transformPayments,
} from "../../../monero-wasm-module/walletApi";
import { ProgressBar } from "../ui";
import { SectionPanel, SurfaceCard } from "../ui";
import { useXmrPrice } from "./useXmrPrice";
import { NiceTabs } from "./tabs";
import { ReceiveAddresses } from "./main.receive";
import { balanceToString, saveWalletIntoFs, toFiat } from "../utils";
import { TransactionsTab } from "./main.transactions";
import { SendTab } from "./main.send";
import { OtherTab } from "./main.other";
import { MultisigTab } from "./main.multisig";

export function WalletMain({
  wallet,
  onExit,
}: {
  wallet: MoneroWasmWallet;
  onExit: () => void;
}) {
  (window as any).wallet = wallet;

  const walletFileName = React.useMemo(() => {
    return wallet.get_wallet_file();
  }, [wallet]);

  const [refreshing, setRefreshing] = React.useState(false);
  // TODO: If daemon just started then it might be small value
  // and UI can show negative blocks left
  const [daemonHeight, setDaemonHeight] = React.useState<bigint | null>(null);
  const [lastTimeStatusesObtained, setLastTimeStatusesObtained] =
    React.useState<Date | null>(null);
  const [walletBlockchainCurrentHeight, setWalletBlockchainCurrentHeight] =
    React.useState<bigint | null>(null);

  const [downloadInfo, setDownloadInfo] = React.useState<null | {
    url: string;
    progressLoaded: number;
    progressTotal: number;
  }>(null);

  const [refreshError, setRefreshError] = React.useState<string | null>(null);

  const [balance, setBalance] = React.useState<Record<
    "strict" | "nonStrict",
    {
      value: bigint;
      unlocked: {
        balance: bigint;
        blocks_to_unlock: bigint;
        time_to_unlock: bigint;
      };
    }
  > | null>(null);

  const [payments, setPayments] = React.useState<
    null | PaymentDetailsTransformed[]
  >(null);
  const [mempoolPayments, setMempoolPayments] = React.useState<
    null | PaymentDetailsTransformed[]
  >(null);

  const updateSecondaryAddresses = React.useCallback(() => {
    const accounts = [];
    const numAccounts = wallet.get_num_subaddresses(0);
    for (let i = 1; i < numAccounts; i++) {
      // start from 1 because 0 is primary
      const address = wallet.get_subaddress_as_str(0, i);
      const label = wallet.get_subaddress_label(0, i);
      accounts.push({ address, label, indexMinor: i });
    }
    setSecondaryAddresses(accounts);
  }, [wallet]);

  /*
  
1000000000n = 0.001
0765432100n = 0.00076544321

# Confirmed 1000n, in mempool 7654321
nonStrict balance value 1765432100n
nonStrict balance unlocked= 1000000000n   blocks_to_unlock= 0n  time_to_unlock= 0n
strict balance value 1000000000n
strict balance unlocked= 1000000000n   blocks_to_unlock= 0n  time_to_unlock= 0n


# Confirmed both but 7654321 is locked
nonStrict balance value 1765432100n
nonStrict balance unlocked= 1000000000n   blocks_to_unlock= 9n  time_to_unlock= 0n
strict balance value 1765432100n
strict balance unlocked= 1000000000n   blocks_to_unlock= 9n  time_to_unlock= 0n
*/

  const isSynced =
    walletBlockchainCurrentHeight !== null &&
    daemonHeight !== null &&
    walletBlockchainCurrentHeight >= daemonHeight;

  React.useEffect(() => {
    const oldOnFetch = window.globalHttpConfig.onFetch;
    window.globalHttpConfig.onFetch = (
      url,
      reqId,
      state,
      progressLoaded,
      progressTotal,
    ) => {
      console.info(
        `[HTTP] ${url}: ${state} (${progressLoaded}/${progressTotal}), id=${reqId}`,
      );
      if (state === "end") {
        setDownloadInfo(null);
      } else if (state === "error") {
        setDownloadInfo(null);
      } else {
        setDownloadInfo({ url, progressLoaded, progressTotal });
      }
    };

    return () => {
      window.globalHttpConfig.onFetch = oldOnFetch;
    };
  }, [wallet]);

  const stopWaitingRef = React.useRef<null | (() => void) | "no-wait">(null);
  const stopWaitingOrScheduleNoWait = () => {
    if (stopWaitingRef.current === "no-wait") {
      return;
    }
    if (stopWaitingRef.current) {
      stopWaitingRef.current();
    } else {
      stopWaitingRef.current = "no-wait";
    }
  };

  const [multisigStatus, setMultisigStatus] =
    React.useState<null | MultisigAccountStatus>(null);

  React.useEffect(() => {
    let cancelled = false;
    wallet.set_on_new_block_callback((height) =>
      setWalletBlockchainCurrentHeight(height),
    );

    console.info("Address=", wallet.get_address());

    const updateStatuses = async () => {
      const cycleStartingHeight = wallet.get_blockchain_current_height();
      setWalletBlockchainCurrentHeight(cycleStartingHeight);

      const balanceStrict = wallet.balance(0, true);
      const balanceNonStrict = wallet.balance(0, false);
      const unlockedBalanceStrict = wallet.unlocked_balance(0, true);
      const unlockedBalanceNonStrict = wallet.unlocked_balance(0, false);
      setBalance({
        strict: {
          value: balanceStrict,
          unlocked: unlockedBalanceStrict,
        },
        nonStrict: {
          value: balanceNonStrict,
          unlocked: unlockedBalanceNonStrict,
        },
      });

      const newMultisigStatus = await wallet.get_multisig_status();
      if (cancelled) {
        return;
      }
      setMultisigStatus(newMultisigStatus);

      const payments = await wallet.get_payments(0n, max64);
      if (cancelled) {
        return;
      }
      const transformedPayments = transformPayments(payments);
      setPayments(transformedPayments);
      updateSecondaryAddresses();

      const daemonHeight = await wallet.get_daemon_blockchain_height();
      if (cancelled) {
        return;
      }
      setDaemonHeight(daemonHeight);

      setLastTimeStatusesObtained(new Date());

      return {
        multisigStatus: newMultisigStatus,
        payments: transformedPayments,
        daemonHeight,
        cycleStartingHeight,
        balance: {
          strict: {
            value: balanceStrict,
            unlocked: unlockedBalanceStrict,
          },
          nonStrict: {
            value: balanceNonStrict,
            unlocked: unlockedBalanceNonStrict,
          },
        },
      };
    };
    const doRefresh = async () => {
      setRefreshing(true);
      setRefreshError(null);

      try {
        const refreshStatus = await wallet.refresh(
          false,
          0n,
          true,
          true,
          2000n,
        );
        console.info("Refresh status:", refreshStatus);
        if (cancelled) {
          return;
        }
        await saveWalletIntoFs(wallet);
        console.info("Refresh saved");

        if (cancelled) {
          return;
        }
        setRefreshError(null);
        setRefreshing(false);

        const isSynced = await wallet.is_synced();
        if (isSynced) {
          // On non-initial refresh also get mempool payments
          const mempoolPayments = await wallet.get_payments_mempool();
          const transformedMempoolPayments = transformPayments(mempoolPayments);
          console.log("Mempool payments:", transformedMempoolPayments);
          setMempoolPayments(transformedMempoolPayments);
        }

        return refreshStatus;
      } catch (e) {
        console.error("Error during refresh:", e);
        setRefreshError((e as Error).message || "Unknown error");
        setRefreshing(false);
      }
    };

    const interruptableDelay = (ms: number) => async () => {
      if (stopWaitingRef.current === "no-wait") {
        console.info(
          `Waiting for ${ms / 1000} seconds... {no wait mode, skipping wait}`,
        );
        stopWaitingRef.current = null;
        return;
      }
      if (stopWaitingRef.current) {
        console.error("Already waiting, cannot start another wait");
        return;
      }

      stopWaitingRef.current satisfies null;

      console.info(`Waiting for ${ms / 1000} seconds...`);
      const r = await Promise.race([
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }).then(() => "timeout"),
        new Promise<void>((resolve) => {
          stopWaitingRef.current = resolve;
        }).then(() => "stopped"),
      ]);
      stopWaitingRef.current = null;
      console.info(`Wait ended with result: ${r}`);
    };

    (async () => {
      let lastTimeRefreshStartedAt: Date | null = null;
      let lastTimeRefreshedBlocks: bigint | null = null;
      while (!cancelled) {
        console.info(
          `================= Starting refresh cycle =================`,
        );

        setRefreshError(null);

        try {
          const freshStatus = await updateStatuses();
          console.info("Statuses updated:", freshStatus);
          if (cancelled || !freshStatus) {
            return;
          }
          if (
            freshStatus.multisigStatus.multisig_is_active &&
            !freshStatus.multisigStatus.is_ready
          ) {
            console.info(
              `Wallet is multisig but not ready, waiting for manual interrupt`,
            );
            await interruptableDelay(Infinity)();
            continue;
          }
        } catch (e) {
          console.error("Error while updating wallet/daemon status:", e);
          setRefreshError((e as Error).message || "Unknown error");
          await interruptableDelay(30_000)();
          continue;
        }

        if (cancelled) {
          return;
        }

        // The point of having delay here is to allow to get fresh statuses right after refresh
        // If we have refresh in the end of the loop then we will just wait

        const isSynced = await wallet.is_synced();
        if (isSynced) {
          console.info("Wallet is synced, waiting for next refresh cycle...");
          await interruptableDelay(60_000)();
        } else {
          console.info("Wallet is not synced, going into refresh...");
        }

        if (cancelled) {
          return;
        }

        if (!isSynced && lastTimeRefreshStartedAt && lastTimeRefreshedBlocks) {
          const secondsSinceLastRefresh =
            (new Date().getTime() - lastTimeRefreshStartedAt.getTime()) / 1000;
          const secondsPerBlock =
            secondsSinceLastRefresh / Number(lastTimeRefreshedBlocks);
          console.info(
            `Estimated seconds per block on initial sync: ${secondsPerBlock.toFixed(2)}`,
          );
          setSecondsPerBlockOnInitialSync(secondsPerBlock);
        } else {
          setSecondsPerBlockOnInitialSync(null);
        }
        lastTimeRefreshStartedAt = new Date();
        console.info(`Refreshing wallet...`);
        const refreshStatus = await doRefresh();
        lastTimeRefreshedBlocks = refreshStatus?.blocksFetched ?? null;
      }
    })().catch((e) => {
      if (cancelled) {
        return;
      }
      console.error("Refresh worker throw:", e);
      setRefreshError((e as Error).message || "Unknown error");
    });
    return () => {
      cancelled = true;
      wallet.set_on_new_block_callback(null);
    };
  }, [
    wallet,
    setRefreshing,
    setWalletBlockchainCurrentHeight,
    setDaemonHeight,
    updateSecondaryAddresses,
  ]);

  const priceInfo = useXmrPrice();
  const price = priceInfo?.price ?? null;

  const primaryAddress = useMemo(() => wallet.get_address(), [wallet]);
  const [secondaryAddresses, setSecondaryAddresses] = React.useState<
    | {
        address: string;
        label: string;
        indexMinor: number;
      }[]
    | null
  >(null);

  const [secondsPerBlockOnInitialSync, setSecondsPerBlockOnInitialSync] =
    React.useState<number | null>(null);

  const progressBarCompact =
    daemonHeight === null || walletBlockchainCurrentHeight === null ? (
      <ProgressBar
        state={refreshError ? "error" : "loading"}
        size="sm"
        text={refreshError || "Connecting..."}
      />
    ) : refreshing ? (
      <ProgressBar
        size="sm"
        state={downloadInfo ? "progress" : "loading"}
        value={
          downloadInfo
            ? (downloadInfo.progressLoaded / downloadInfo.progressTotal) * 100
            : 0
        }
        text={
          daemonHeight > walletBlockchainCurrentHeight
            ? `${daemonHeight - walletBlockchainCurrentHeight} blocks left` +
              (secondsPerBlockOnInitialSync
                ? showEstimatedTime(
                    secondsPerBlockOnInitialSync,
                    daemonHeight - walletBlockchainCurrentHeight,
                  )
                : "")
            : "Refreshing..."
        }
      />
    ) : isSynced ? (
      <SynchronizedWithTimer
        size="sm"
        lastSyncTimestamp={lastTimeStatusesObtained}
      />
    ) : refreshError ? (
      <ProgressBar size="sm" state="error" text={refreshError} />
    ) : (
      // When not synced but no error and not syncing
      // Should not happen, but might occur between initial refreshes
      <ProgressBar size="sm" state="loading" text="Loading..." />
    );

  const availableAtomic = balance ? balance.nonStrict.unlocked.balance : null;
  const lockedAtomic = balance
    ? balance.nonStrict.value - balance.nonStrict.unlocked.balance
    : null;
  const availableXmrText =
    availableAtomic !== null
      ? `${balanceToString(availableAtomic)} XMR`
      : "Loading...";
  const lockedXmrText =
    lockedAtomic !== null
      ? `${balanceToString(lockedAtomic)} XMR`
      : "Loading...";
  const availableEurText =
    availableAtomic !== null && price
      ? `~${toFiat(availableAtomic, price).toFixed(2)} EUR`
      : "—";
  const lockedEurText =
    lockedAtomic !== null && price
      ? `~${toFiat(lockedAtomic, price).toFixed(2)} EUR`
      : "—";

  const isSyncingNow = refreshing || !isSynced;
  const syncStatusLabel = isSyncingNow ? "Syncing" : "Synced";
  const syncStatusTone = isSyncingNow
    ? "bg-amber-500/10 text-amber-200 ring-amber-400/20"
    : "bg-emerald-500/10 text-emerald-200 ring-emerald-400/20";

  // This way to keep this tab state in tne main component and not lose it when switching tabs
  const sendTabContent = SendTab({
    scheduleRefresh: stopWaitingOrScheduleNoWait,
    wallet,
    price: price,
  });
  const isShouldHideMultisigTab =
    !!payments &&
    !!mempoolPayments &&
    (payments.length > 0 || mempoolPayments.length > 0);

  return (
    <div className="space-y-5 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-4 lg:space-y-0">
      <SectionPanel className="relative overflow-hidden p-4 sm:p-5 lg:sticky lg:top-4">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgba(169,133,255,0.22),transparent_58%)]" />
        <div className="relative space-y-4">
          <div className="flex flex-col gap-3">
            <div className="min-w-0">
              {/*
              // TODO: Show something meaningfull here
              <div className="text-xs tracking-[0.18em] uppercase text-white/45">
                  Monero wallet
              </div>
              */}
              <h1 className="text-glow text-2xl leading-tight font-bold sm:text-3xl">
                Amethyst XMR
              </h1>
              <div className="mt-2 inline-flex max-w-full items-center rounded-lg bg-white/8 px-3 py-1 text-sm text-white/75 ring-1 ring-white/10">
                <span className="truncate">{walletFileName}</span>
              </div>
            </div>

            <div className="space-y-2 lg:pt-1">
              <div className="flex items-center justify-between gap-2">
                <div
                  className={`inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-semibold ring-1 ${syncStatusTone}`}
                >
                  {syncStatusLabel}
                </div>
                {daemonHeight !== null &&
                  walletBlockchainCurrentHeight !== null && (
                    <span className="text-[11px] text-white/45">
                      {walletBlockchainCurrentHeight}/{daemonHeight}
                    </span>
                  )}
              </div>
              {progressBarCompact}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <WalletSplitMetricCard
              title="XMR"
              topValue={availableXmrText}
              topLabel="available"
              bottomValue={lockedXmrText}
              bottomLabel="locked"
            />
            <WalletSplitMetricCard
              title="EUR"
              topValue={availableEurText}
              topLabel="available"
              bottomValue={lockedEurText}
              bottomLabel="locked"
            />
          </div>
        </div>
      </SectionPanel>

      <div className="lg:h-[640px]">
        <NiceTabs
          className="mt-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col"
          tabs={[
            {
              key: "receive",
              label: "Receive",
              content: (
                <ReceiveAddresses
                  primaryAddress={primaryAddress}
                  secondaryAddresses={secondaryAddresses || undefined}
                  payments={payments}
                  mempoolPayments={mempoolPayments}
                  price={price}
                  onAddSubaddressAdd={async (newLabel) => {
                    await wallet.add_subaddress(0, newLabel);
                    await saveWalletIntoFs(wallet);
                    updateSecondaryAddresses();
                  }}
                />
              ),
            },
            {
              key: "send",
              label: "Send",
              content: sendTabContent,
            },
            {
              key: "transactions",
              label: "Transactions",
              content: (
                <TransactionsTab
                  payments={payments}
                  secondaryAddresses={secondaryAddresses}
                  mempoolPayments={mempoolPayments}
                  daemonLastBlockHeight={daemonHeight}
                  price={price}
                />
              ),
            },
            ...(!isShouldHideMultisigTab
              ? [
                  {
                    key: "multisig",
                    label: "Multisig",
                    content: (
                      <MultisigTab
                        wallet={wallet}
                        onRefresh={stopWaitingOrScheduleNoWait}
                        payments={payments}
                        mempoolPayments={mempoolPayments}
                        walletHeight={walletBlockchainCurrentHeight}
                        daemonHeight={daemonHeight}
                      />
                    ),
                  },
                ]
              : []),
            {
              key: "other",
              label: "Other",
              content: (
                <OtherTab
                  onExit={onExit}
                  wallet={wallet}
                  onRefresh={stopWaitingOrScheduleNoWait}
                  lastRefreshTimestamp={lastTimeStatusesObtained}
                  daemonLastBlockHeight={daemonHeight}
                  payments={payments}
                  priceEur={priceInfo?.price ?? null}
                  priceSource={priceInfo?.source ?? null}
                  priceFetchedAt={priceInfo?.fetchedAt ?? null}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}

function WalletSplitMetricCard({
  title,
  topValue,
  topLabel,
  bottomValue,
  bottomLabel,
}: {
  title: string;
  topValue: string;
  topLabel: string;
  bottomValue: string;
  bottomLabel: string;
}) {
  return (
    <SurfaceCard className="min-w-0 space-y-0 bg-white/6 px-3 py-2.5">
      <div className="text-[11px] tracking-wide uppercase text-white/45">
        {title}
      </div>
      <div
        className="min-w-0 text-sm leading-tight font-semibold text-white/90 break-words sm:text-base"
        title={topValue}
      >
        {topValue}
      </div>
      <div className="-mt-0.5 text-[11px] leading-none text-white/45">
        {topLabel}
      </div>
      <div
        className="mt-1.5 min-w-0 text-sm leading-tight font-semibold text-white/75 break-words sm:text-base"
        title={bottomValue}
      >
        {bottomValue}
      </div>
      <div className="-mt-0.5 text-[11px] leading-none text-white/45">
        {bottomLabel}
      </div>
    </SurfaceCard>
  );
}

function SynchronizedWithTimer({
  lastSyncTimestamp,
  size = "md",
}: {
  lastSyncTimestamp: Date | null;
  size?: "md" | "sm";
}) {
  const [isOutdated, setIsOutdated] = React.useState(false);

  React.useEffect(() => {
    setIsOutdated(false);
    if (lastSyncTimestamp === null) {
      setIsOutdated(true);
      return;
    }
    const timerId = setInterval(() => {
      const now = new Date();
      if (now.getTime() - lastSyncTimestamp.getTime() > 5 * 60 * 1000) {
        setIsOutdated(true);
      }
    }, 20 * 1000);
    return () => {
      clearInterval(timerId);
    };
  }, [lastSyncTimestamp]);

  if (!isOutdated) {
    return <ProgressBar size={size} state="ready" text="Synchronized" />;
  } else {
    return <ProgressBar size={size} state="error" text="Refresh needed" />;
  }
}

function showEstimatedTime(
  secondsPerBlock: number,
  blocksLeft: bigint,
): string {
  const secondsLeft = secondsPerBlock * Number(blocksLeft);
  if (secondsLeft < 60) {
    return ` (~${Math.ceil(secondsLeft)}s)`;
  } else if (secondsLeft < 3600) {
    return ` (~${Math.ceil(secondsLeft / 60)}m)`;
  } else if (secondsLeft < 3600 * 24) {
    return ` (~${Math.ceil(secondsLeft / 3600)}h)`;
  } else {
    return ` (~${Math.ceil(secondsLeft / (3600 * 24))}d)`;
  }
}
