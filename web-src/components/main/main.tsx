import React, { useCallback } from "react";
import {
  max64,
  MoneroWasmWallet,
  MultisigAccountStatus,
  PaymentDetailsTransformed,
  WalletAddress,
  transformPayments,
  transformWalletAddresses,
} from "../../../monero-wasm-module/walletApi";
import { ProgressBar } from "../ui";
import { SectionPanel, SurfaceCard } from "../ui";
import { useXmrPrice } from "./useXmrPrice";
import { NiceTabs } from "./tabs";
import { ReceiveAddresses } from "./main.receive";
import { balanceToString, toFiat, withFsLock } from "../utils";
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

  const [walletFileName, setWalletFileName] = React.useState("Loading...");

  const [refreshing, setRefreshing] = React.useState(false);

  const [status, setStatus] = React.useState<{
    // TODO: If daemon just started then it might be small value
    // and UI can show negative blocks left

    daemonHeight: bigint;
    obtainedAt: Date;
    walletHeight: bigint;
    balance: Record<
      "strict" | "nonStrict",
      {
        value: bigint;
        unlocked: {
          balance: bigint;
          blocks_to_unlock: bigint;
          time_to_unlock: bigint;
        };
      }
    >;
    isSynced: Boolean;
    multisigStatus: MultisigAccountStatus;
    hasMultisigPartialKeyImages: boolean;
    hasUnknownKeyImages: boolean;
    payments: PaymentDetailsTransformed[];
  } | null>(null);
  const [downloadInfo, setDownloadInfo] = React.useState<null | {
    url: string;
    progressLoaded: number;
    progressTotal: number;
  }>(null);

  const [refreshError, setRefreshError] = React.useState<string | null>(null);

  const [mempoolPayments, setMempoolPayments] = React.useState<
    null | PaymentDetailsTransformed[]
  >(null);

  const [addresses, setAddresses] = React.useState<WalletAddress[] | null>(
    null,
  );

  const updateWalletAddresses = React.useCallback(async () => {
    const addressesVector = await wallet.get_wallet_addresses(0);
    const nextAddresses = transformWalletAddresses(addressesVector);
    setAddresses(nextAddresses);
  }, [wallet]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const file = await wallet.get_wallet_file();
        if (!cancelled) {
          setWalletFileName(file);
        }
      } catch (e) {
        console.error("Failed to get wallet file name:", e);
        if (!cancelled) {
          setWalletFileName("Unknown wallet");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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
  const stopWaitingOrScheduleNoWait = useCallback(() => {
    if (stopWaitingRef.current === "no-wait") {
      return;
    }
    if (stopWaitingRef.current) {
      stopWaitingRef.current();
    } else {
      stopWaitingRef.current = "no-wait";
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    wallet.set_on_new_block_callback((height) =>
      setStatus((prev) =>
        prev === null ? null : { ...prev, walletHeight: height },
      ),
    );

    const getStatus = async () => {
      const walletHeight = await wallet.get_blockchain_current_height();

      const balanceStrict = await wallet.balance(0, true);
      const balanceNonStrict = await wallet.balance(0, false);
      const unlockedBalanceStrict = await wallet.unlocked_balance(0, true);
      const unlockedBalanceNonStrict = await wallet.unlocked_balance(0, false);
      const balance = {
        strict: {
          value: balanceStrict,
          unlocked: unlockedBalanceStrict,
        },
        nonStrict: {
          value: balanceNonStrict,
          unlocked: unlockedBalanceNonStrict,
        },
      };

      const newMultisigStatus = await wallet.get_multisig_status();
      const hasMultisigPartialKeyImages =
        await wallet.has_multisig_partial_key_images();
      const hasUnknownKeyImages = await wallet.has_unknown_key_images();
      if (cancelled) {
        return;
      }

      const payments = await wallet.get_payments(0n, max64);
      if (cancelled) {
        return;
      }
      const transformedPayments = transformPayments(payments);

      const daemonHeight = await wallet.get_daemon_blockchain_height();
      if (cancelled) {
        return;
      }
      const isSynced = await wallet.is_synced();

      const newStatus: typeof status = {
        daemonHeight,
        walletHeight,
        balance,
        isSynced,
        obtainedAt: new Date(),
        multisigStatus: newMultisigStatus,
        hasMultisigPartialKeyImages,
        hasUnknownKeyImages,
        payments: transformedPayments,
      };

      return newStatus;
    };
    const doRefresh = async () => {
      setRefreshing(true);
      setRefreshError(null);

      try {
        const refreshStatus = await withFsLock(async () => {
          if (cancelled) {
            return;
          }
          const refreshStatusLocal = await wallet.refresh(
            false,
            0n,
            true,
            true,
            2000n,
          );
          await wallet.store();
          return refreshStatusLocal;
        });
        if (!refreshStatus) {
          return;
        }
        console.info("Refresh status:", refreshStatus);
        if (cancelled) {
          return;
        }

        if (cancelled) {
          return;
        }
        setRefreshError(null);
        setRefreshing(false);

        return refreshStatus;
      } catch (e) {
        console.error("Error during refresh:", e);
        setRefreshError((e as Error).message || "Unknown error");
        setRefreshing(false);
      }
    };

    const interruptableDelay = async (ms: number) => {
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
      /** Only used for estimations during initial sync.
       *  And it measures whole cycle time, not only refresh time,
       *   so it also includes time for getting statuses and payments
       */
      let lastTimeRefreshStartedAt: Date | null = null;
      /** Only used for estimations during initial sync */
      let lastTimeRefreshedBlocks: bigint | null = null;

      while (!cancelled) {
        console.info(
          `================= Starting refresh cycle =================`,
        );

        setRefreshError(null);

        try {
          await updateWalletAddresses();

          const freshStatus = await getStatus();
          if (!freshStatus) {
            return;
          }
          setStatus(freshStatus);
          console.info("Statuses updated:", freshStatus);

          if (
            freshStatus.multisigStatus.multisig_is_active &&
            !freshStatus.multisigStatus.is_ready
          ) {
            console.info(
              `Wallet is multisig but not ready, basically waiting for manual interrupt`,
            );
            await interruptableDelay(60_000 * 20);
            continue;
          }
        } catch (e) {
          console.error("Error while updating wallet/daemon status:", e);
          setRefreshError((e as Error).message || "Unknown error");
          await interruptableDelay(30_000);
          continue;
        }

        if (cancelled) {
          return;
        }

        // The point of having delay here is to allow to get fresh statuses right after refresh
        // If we have refresh in the end of the loop then we will just wait
        const isSynced = await wallet.is_synced().catch(() => null);
        if (isSynced) {
          lastTimeRefreshStartedAt = null;
          lastTimeRefreshedBlocks = null;

          console.info("Wallet is synced, fetching mempool...");
          {
            // On non-initial refresh also get mempool payments
            const mempoolPayments = await wallet
              .get_payments_mempool()
              .catch(() => null);
            if (mempoolPayments) {
              const transformedMempoolPayments =
                transformPayments(mempoolPayments);
              console.log("Mempool payments:", transformedMempoolPayments);
              setMempoolPayments(transformedMempoolPayments);
            } else {
              console.warn("Failed to fetch mempool payments");
              setMempoolPayments(null);
              setRefreshError("Failed to fetch mempool payments");
              await interruptableDelay(30_000);
              continue;
            }
          }
          await interruptableDelay(60_000);
          continue;
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
  }, [wallet, setRefreshing, setStatus, updateWalletAddresses]);

  const priceInfo = useXmrPrice();
  const price = priceInfo?.price ?? null;

  const [secondsPerBlockOnInitialSync, setSecondsPerBlockOnInitialSync] =
    React.useState<number | null>(null);

  const isInMultisigSetupProcess =
    status &&
    status.multisigStatus.multisig_is_active &&
    !status.multisigStatus.is_ready;

  const progressBarCompact = !status ? (
    <ProgressBar
      state={refreshError ? "error" : "loading"}
      size="sm"
      text={refreshError || "Connecting..."}
    />
  ) : isInMultisigSetupProcess ? (
    <ProgressBar
      size="sm"
      state={"loading"}
      text={"(kex exchange in progress)"}
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
        !status.isSynced && status.daemonHeight > status.walletHeight
          ? `${status.daemonHeight - status.walletHeight} blocks left` +
            (secondsPerBlockOnInitialSync
              ? showEstimatedTime(
                  secondsPerBlockOnInitialSync,
                  status.daemonHeight - status.walletHeight,
                )
              : "")
          : "Refreshing..."
      }
    />
  ) : status.isSynced ? (
    <SynchronizedWithTimer size="sm" lastSyncTimestamp={status.obtainedAt} />
  ) : refreshError ? (
    <ProgressBar size="sm" state="error" text={refreshError} />
  ) : (
    // When not synced but no error and not syncing
    // Should not happen, but might occur between initial refreshes
    <ProgressBar size="sm" state="loading" text="Loading..." />
  );

  const availableBalance = status
    ? status.balance.nonStrict.unlocked.balance
    : null;
  const lockedBalance = status
    ? status.balance.nonStrict.value - status.balance.nonStrict.unlocked.balance
    : null;
  const availableXmrText =
    availableBalance !== null
      ? `${balanceToString(availableBalance)} XMR`
      : "Loading...";
  const lockedXmrText =
    lockedBalance !== null
      ? `${balanceToString(lockedBalance)} XMR`
      : "Loading...";
  const availableEurText =
    availableBalance !== null && price
      ? `~${toFiat(availableBalance, price).toFixed(2)} EUR`
      : "—";
  const lockedEurText =
    lockedBalance !== null && price
      ? `~${toFiat(lockedBalance, price).toFixed(2)} EUR`
      : "—";

  const isSyncingNow = refreshing || (status && !status.isSynced);
  const syncStatusLabel = isInMultisigSetupProcess
    ? "Waiting"
    : isSyncingNow
      ? "Syncing"
      : "Synced";
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
    !!status &&
    !!mempoolPayments &&
    !status.multisigStatus.multisig_is_active &&
    (status.payments.length > 0 || mempoolPayments.length > 0);

  return (
    <div className="space-y-5 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-4 lg:space-y-0">
      <SectionPanel className="relative overflow-hidden p-4 sm:p-5 lg:sticky lg:top-4">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgba(169,133,255,0.22),transparent_58%)]" />
        <div className="relative space-y-4">
          <div className="flex flex-col gap-3">
            <div className="min-w-0">
              {
                <div className="text-xs tracking-[0.18em] uppercase text-white/45">
                  {status?.multisigStatus.multisig_is_active ? "Multisig" : ""}
                </div>
              }
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
                {status && (
                  <span className="text-[11px] text-white/45">
                    {status.walletHeight}/{status.daemonHeight}
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
          {status?.hasMultisigPartialKeyImages && (
            <div className="text-xs text-amber-200/95">
              User action required in multisig tab
            </div>
          )}
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
                  addresses={addresses}
                  payments={status?.payments || null}
                  mempoolPayments={mempoolPayments}
                  price={price}
                  onAddSubaddressAdd={async (newLabel) => {
                    withFsLock(async () => {
                      await wallet.add_subaddress(0, newLabel);
                      await wallet.store();
                    });
                    await updateWalletAddresses();
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
                  payments={status?.payments || null}
                  addresses={addresses}
                  mempoolPayments={mempoolPayments}
                  daemonLastBlockHeight={status?.daemonHeight ?? null}
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
                        multisigStatus={status?.multisigStatus ?? null}
                        hasMultisigPartialKeyImages={
                          status?.hasMultisigPartialKeyImages ?? false
                        }
                        onRefresh={stopWaitingOrScheduleNoWait}
                        payments={status?.payments || null}
                        mempoolPayments={mempoolPayments}
                        walletHeight={status?.walletHeight ?? null}
                        daemonHeight={status?.daemonHeight ?? null}
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
                  lastRefreshTimestamp={status?.obtainedAt ?? null}
                  daemonLastBlockHeight={status?.daemonHeight ?? null}
                  payments={status?.payments || null}
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
