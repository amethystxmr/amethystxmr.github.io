import React, { useCallback } from "react";
import NoSleep from "nosleep.js";
import {
  max64,
  MoneroWasmWallet,
  MultisigAccountStatus,
  PaymentDetails,
  setHttpFetchCallback,
  WalletAddress,
  setWalletNewBlockCallback,
} from "../../../monero-wasm-module/walletApi.workerClient";
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

const SYNC_NO_SLEEP_HINT_DELAY_MS = 60_000;

export function WalletMain({
  wallet,
  onExit,
}: {
  wallet: MoneroWasmWallet;
  onExit: () => void;
}) {
  (window as Window & { wallet?: MoneroWasmWallet }).wallet = wallet;

  const [walletFileName, setWalletFileName] = React.useState<string | null>(
    null,
  );

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
    isSynced: boolean;
    isViewOnly: boolean;
    multisigStatus: MultisigAccountStatus;
    hasMultisigPartialKeyImages: boolean;
    hasUnknownKeyImages: boolean;
    payments: PaymentDetails[];
  } | null>(null);
  const [downloadInfo, setDownloadInfo] = React.useState<null | {
    url: string;
    progressLoaded: number;
    progressTotal: number;
  }>(null);

  const [refreshError, setRefreshError] = React.useState<string | null>(null);

  const [mempoolPayments, setMempoolPayments] = React.useState<
    null | PaymentDetails[]
  >(null);

  const [addresses, setAddresses] = React.useState<WalletAddress[] | null>(
    null,
  );
  const [unsyncedSince, setUnsyncedSince] = React.useState<Date | null>(null);
  const [isNoSleepEnabled, setIsNoSleepEnabled] = React.useState(false);
  const noSleepRef = React.useRef<NoSleep | null>(null);

  const updateWalletAddresses = React.useCallback(async () => {
    const nextAddresses = await wallet.get_wallet_addresses(0);
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

  React.useEffect(() => {
    const appName = "AmethystXMR";
    const defaultTitle = "Amethyst XMR";
    const walletName = walletFileName
      ? walletFileName.split(/[\\/]/).pop() || walletFileName
      : null;

    document.title =
      walletName && walletName !== "Unknown wallet"
        ? `${walletName} [${appName}]`
        : defaultTitle;

    return () => {
      document.title = defaultTitle;
    };
  }, [walletFileName]);

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
    void setHttpFetchCallback(
      (url, reqId, state, progressLoaded, progressTotal) => {
        console.info(
          `[HTTP] ${url}: ${state} (${progressLoaded}/${progressTotal}), id=${reqId}`,
        );
        if (
          state === "end" ||
          state === "error" ||
          state === "timeout" ||
          state === "abort"
        ) {
          setDownloadInfo(null);
        } else if (state === "start" || state === "progress") {
          setDownloadInfo({ url, progressLoaded, progressTotal });
        } else {
          state satisfies never;
        }
      },
    );

    return () => {
      void setHttpFetchCallback(null);
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
      const isViewOnly = await wallet.watch_only();
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
        isViewOnly,
        obtainedAt: new Date(),
        multisigStatus: newMultisigStatus,
        hasMultisigPartialKeyImages,
        hasUnknownKeyImages,
        payments,
      };

      return newStatus;
    };
    const doRefresh = async () => {
      if (cancelled) {
        return;
      }
      setRefreshing(true);
      setRefreshError(null);

      try {
        if (cancelled) {
          return;
        }
        const refreshStatus = await withFsLock(async () => {
          // Refresh probably does not need the same lock as store for FS/IDB; only store
          // writes. Keep both under withFsLock anyway to serialize with other tab activity.
          const r = await wallet.refresh(false, 0, true, true, 2000);
          await wallet.store();
          return r;
        });
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
        if (cancelled) {
          return;
        }
        console.error("Error during refresh:", e);
        const message =
          e instanceof Error
            ? e.message
            : typeof e === "number"
              ? "WASM error (raw exception pointer; worker should decode — see walletApi.worker ensureSequential)."
              : typeof e === "string"
                ? e
                : String(e);
        setRefreshError(message || "Unknown error");
        setRefreshing(false);
      }
    };

    const interruptableDelay = async (ms: number) => {
      if (cancelled) {
        return;
      }
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
      if (cancelled) {
        return;
      }
      await setWalletNewBlockCallback(wallet, (height, timestamp) => {
        if (cancelled) {
          return;
        }
        void timestamp;
        // const t = new Date(Number(timestamp) * 1000);
        // console.log(
        //   `on_new_block height=${height} timestamp=${t.toISOString()}`,
        // );
        setStatus((prev) =>
          prev === null ? null : { ...prev, walletHeight: height },
        );
      });

      /** Only used for estimations during initial sync.
       *  And it measures whole cycle time, not only refresh time,
       *   so it also includes time for getting statuses and payments
       */
      let lastTimeRefreshStartedAt: Date | null = null;
      /** Only used for estimations during initial sync */
      let lastTimeRefreshedBlocks: number | null = null;

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
          if (cancelled) {
            return;
          }
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
        const isSynced = await Promise.resolve(wallet.is_synced()).catch(
          () => null,
        );
        if (cancelled) {
          return;
        }
        if (isSynced) {
          lastTimeRefreshStartedAt = null;
          lastTimeRefreshedBlocks = null;

          console.info("Wallet is synced, fetching mempool...");
          {
            // On non-initial refresh also get mempool payments
            const mempoolPayments = await Promise.resolve(
              wallet.get_payments_mempool(),
            ).catch(() => null);
            if (cancelled) {
              return;
            }
            if (mempoolPayments) {
              console.log("Mempool payments:", mempoolPayments);
              setMempoolPayments(mempoolPayments);
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
      if (stopWaitingRef.current && stopWaitingRef.current !== "no-wait") {
        stopWaitingRef.current();
      }
      stopWaitingRef.current = null;
      void setWalletNewBlockCallback(wallet, null);
    };
  }, [wallet, setRefreshing, setStatus, updateWalletAddresses]);

  const priceInfo = useXmrPrice();
  const price = priceInfo?.price ?? null;

  const [secondsPerBlockOnInitialSync, setSecondsPerBlockOnInitialSync] =
    React.useState<number | null>(null);
  const [showSyncNoSleepHint, setShowSyncNoSleepHint] = React.useState(false);

  const isInMultisigSetupProcess =
    status &&
    status.multisigStatus.multisig_is_active &&
    !status.multisigStatus.is_ready;
  const isFullySynced = status !== null && status.isSynced;
  const hasSyncStatus = status !== null;
  const downloadingProgressValue =
    downloadInfo && downloadInfo.progressTotal > 0
      ? Math.min(
          100,
          Math.max(
            0,
            (downloadInfo.progressLoaded / downloadInfo.progressTotal) * 100,
          ),
        )
      : undefined;

  React.useEffect(() => {
    if (!hasSyncStatus || isFullySynced) {
      setUnsyncedSince(null);
      setShowSyncNoSleepHint(false);
      if (isNoSleepEnabled) {
        noSleepRef.current?.disable();
        setIsNoSleepEnabled(false);
      }
      return;
    }

    setUnsyncedSince((prev) => prev ?? new Date());
  }, [hasSyncStatus, isFullySynced, isNoSleepEnabled]);

  React.useEffect(() => {
    if (!hasSyncStatus || !unsyncedSince || isFullySynced) {
      setShowSyncNoSleepHint(false);
      return;
    }

    const updateVisibility = () => {
      setShowSyncNoSleepHint(
        Date.now() - unsyncedSince.getTime() >= SYNC_NO_SLEEP_HINT_DELAY_MS,
      );
    };

    updateVisibility();
    const timeoutId = window.setTimeout(
      updateVisibility,
      Math.max(
        0,
        SYNC_NO_SLEEP_HINT_DELAY_MS - (Date.now() - unsyncedSince.getTime()),
      ),
    );

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hasSyncStatus, isFullySynced, unsyncedSince]);

  React.useEffect(() => {
    return () => {
      noSleepRef.current?.disable();
    };
  }, []);

  const handleEnableNoSleep = useCallback(() => {
    if (!noSleepRef.current) {
      noSleepRef.current = new NoSleep();
    }
    setIsNoSleepEnabled(true);
    void noSleepRef.current.enable().catch((e) => {
      setIsNoSleepEnabled(false);
      console.error("Failed to enable no-sleep during sync:", e);
    });
  }, []);

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
      state={
        downloadInfo && downloadInfo.progressTotal > 0 ? "progress" : "loading"
      }
      value={downloadingProgressValue}
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
    <SynchronizedWithTimer
      size="sm"
      lastSyncTimestamp={status.obtainedAt}
      value={downloadingProgressValue}
    />
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
      ? `${balanceToString(availableBalance)}`
      : "Loading...";
  const lockedXmrText =
    lockedBalance !== null ? `${balanceToString(lockedBalance)}` : "Loading...";
  const availableEurText =
    availableBalance !== null && price
      ? `~${toFiat(availableBalance, price).toFixed(2)}`
      : "—";
  const lockedEurText =
    lockedBalance !== null && price
      ? `~${toFiat(lockedBalance, price).toFixed(2)}`
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

  const isMultisigTabVisible =
    !status ||
    status.multisigStatus.multisig_is_active ||
    (status.payments.length === 0 &&
      (!mempoolPayments || mempoolPayments.length === 0));
  const isMainTabsLockedByMultisig =
    !!status &&
    status.multisigStatus.multisig_is_active &&
    !status.multisigStatus.is_ready;

  // This way to keep this tab state in tne main component and not lose it when switching tabs
  const sendTabContent = SendTab({
    scheduleRefresh: stopWaitingOrScheduleNoWait,
    wallet,
    price: price,
    currentTotalNonStrictBalance: status?.balance.nonStrict.value ?? null,
    currentUnlockedNonStrictBalance:
      status?.balance.nonStrict.unlocked.balance ?? null,
    showMultisigActions: isMultisigTabVisible,
    isViewOnly: status?.isViewOnly,
  });

  const blinkingMessageText = !status
    ? null
    : status.multisigStatus.multisig_is_active &&
        status.hasMultisigPartialKeyImages
      ? "User action required in multisig tab to import multisig data"
      : status.hasUnknownKeyImages
        ? "We are missing key images for some transactions, import key images on Other tab"
        : "";
  const syncNoSleepMessage =
    hasSyncStatus && showSyncNoSleepHint && !isFullySynced
      ? isNoSleepEnabled
        ? "Screen stays awake until sync finishes"
        : "Tap to keep screen awake during sync"
      : null;

  return (
    <div className="space-y-5 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-4 lg:space-y-0">
      <SectionPanel className="relative overflow-hidden p-4 sm:p-5 lg:sticky lg:top-0">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_100%_0%,rgba(169,133,255,0.22),transparent_58%)]" />
        <div className="relative space-y-4">
          <div className="flex flex-col gap-3">
            <div className="min-w-0">
              {
                <div className="text-xs tracking-[0.18em] uppercase text-white/45">
                  {status?.multisigStatus.multisig_is_active
                    ? status.multisigStatus.is_ready
                      ? "Multisig"
                      : "Multisig in progress"
                    : status?.isViewOnly
                      ? "View-only"
                      : ""}
                </div>
              }
              <h1 className="text-glow text-2xl leading-tight font-bold sm:text-3xl">
                Amethyst XMR
              </h1>
              <div className="mt-2 inline-flex max-w-full items-center rounded-lg bg-white/8 px-3 py-1 text-sm text-white/75 ring-1 ring-white/10">
                <span className="truncate">
                  {walletFileName ?? "Loading..."}
                </span>
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
                    <span aria-label="Wallet current height">
                      {status.walletHeight.toString()}
                    </span>
                    <span aria-hidden="true">/</span>
                    <span aria-label="Daemon current height">
                      {status.daemonHeight.toString()}
                    </span>
                  </span>
                )}
              </div>
              {progressBarCompact}
              {syncNoSleepMessage &&
                (isNoSleepEnabled ? (
                  <div className="text-center text-[11px] whitespace-nowrap text-amber-200/95">
                    {syncNoSleepMessage}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="slow-blink mx-auto block cursor-pointer text-center text-[11px] whitespace-nowrap text-amber-200/95 transition hover:text-amber-100"
                    onClick={handleEnableNoSleep}
                  >
                    {syncNoSleepMessage}
                  </button>
                ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            <WalletSplitMetricCard
              title="XMR"
              topValue={availableXmrText}
              topLabel="available"
              bottomValue={lockedXmrText}
              bottomLabel="locked"
              hideBottom={lockedBalance === 0n}
            />
            <WalletSplitMetricCard
              title={price ? `EUR (1 XMR = ${price.toFixed(2)} EUR)` : "EUR"}
              topValue={availableEurText}
              topLabel="available"
              bottomValue={lockedEurText}
              bottomLabel="locked"
              hideBottom={lockedBalance === 0n}
            />
          </div>
          {blinkingMessageText && (
            <div className="slow-blink text-center text-xs text-amber-200/95">
              {blinkingMessageText}
            </div>
          )}
        </div>
      </SectionPanel>

      <div className="lg:h-[640px]">
        <NiceTabs
          key={
            isMainTabsLockedByMultisig ? "tabs-multisig-locked" : "tabs-normal"
          }
          initialKey={isMainTabsLockedByMultisig ? "multisig" : undefined}
          className="mt-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col"
          tabs={[
            {
              key: "receive",
              label: (
                <>
                  <span aria-hidden="true">↓</span> Receive
                </>
              ),
              disabled: isMainTabsLockedByMultisig,
              content: (
                <ReceiveAddresses
                  addresses={addresses}
                  payments={status?.payments || null}
                  mempoolPayments={mempoolPayments}
                  price={price}
                  onAddSubaddressAdd={async (newLabel) => {
                    await withFsLock(async () => {
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
              label: (
                <>
                  <span aria-hidden="true">↑</span> Send
                </>
              ),
              disabled: isMainTabsLockedByMultisig,
              content: sendTabContent,
            },
            {
              key: "transactions",
              label: (
                <>
                  <span aria-hidden="true">☰</span> Transactions
                </>
              ),
              disabled: isMainTabsLockedByMultisig,
              content: (
                <TransactionsTab
                  wallet={wallet}
                  payments={status?.payments || null}
                  addresses={addresses}
                  mempoolPayments={mempoolPayments}
                  daemonLastBlockHeight={status?.daemonHeight ?? null}
                  price={price}
                  hasUnknownKeyImages={status?.hasUnknownKeyImages}
                  isMultisigWallet={
                    status?.multisigStatus.multisig_is_active ?? false
                  }
                />
              ),
            },
            ...(isMultisigTabVisible
              ? [
                  {
                    key: "multisig",
                    label: (
                      <>
                        <span aria-hidden="true">✎</span> Multisig
                      </>
                    ),
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
              label: (
                <>
                  <span aria-hidden="true">⚙</span> Other
                </>
              ),
              content: (
                <OtherTab
                  onExit={onExit}
                  wallet={wallet}
                  onRefresh={stopWaitingOrScheduleNoWait}
                  lastRefreshTimestamp={status?.obtainedAt ?? null}
                  daemonLastBlockHeight={status?.daemonHeight ?? null}
                  multisigStatus={status?.multisigStatus ?? null}
                  hasUnknownKeyImages={status?.hasUnknownKeyImages}
                  isViewOnly={status?.isViewOnly}
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
  hideBottom = false,
}: {
  title: string;
  topValue: string;
  topLabel: string;
  bottomValue: string;
  bottomLabel: string;
  hideBottom?: boolean;
}) {
  return (
    <SurfaceCard className="min-w-0 space-y-0 bg-white/6 px-3 py-2.5">
      <div className="text-[11px] tracking-wide uppercase text-white/45">
        {title}
      </div>
      <div
        aria-label={`${title} ${topLabel} value`}
        className="min-w-0 text-sm leading-tight font-semibold text-white/90 break-words sm:text-base"
        title={topValue}
      >
        {topValue}
      </div>
      <div className="-mt-0.5 text-[11px] leading-none text-white/45">
        {topLabel}
      </div>
      {!hideBottom && (
        <>
          <div
            aria-label={`${title} ${bottomLabel} value`}
            className="mt-1.5 min-w-0 text-sm leading-tight font-semibold text-white/75 break-words sm:text-base"
            title={bottomValue}
          >
            {bottomValue}
          </div>
          <div className="-mt-0.5 text-[11px] leading-none text-white/45">
            {bottomLabel}
          </div>
        </>
      )}
    </SurfaceCard>
  );
}

function SynchronizedWithTimer({
  lastSyncTimestamp,
  value,
  size = "md",
}: {
  lastSyncTimestamp: Date | null;
  value?: number;
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

  if (isOutdated) {
    return <ProgressBar size={size} state="error" text="Refresh needed" />;
  }
  return (
    <ProgressBar
      size={size}
      state={value !== undefined ? "progress" : "ready"}
      value={value}
      text="Synchronized"
    />
  );
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
