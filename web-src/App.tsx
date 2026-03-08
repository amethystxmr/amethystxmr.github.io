import * as React from "react";
import {
  APP_OVERLAY_ROOT_ATTRIBUTE,
  AlertProvider,
  MultisigDataOverlayProvider,
} from "./components/ui";
import {
  CrossOriginIsolationBootstrapResult,
  isNativeAppRuntime,
} from "./startup/crossOriginIsolation";

type AppProps = {
  crossOriginIsolationBootstrap: Promise<CrossOriginIsolationBootstrapResult>;
};

type BootState =
  | {
      type: "booting";
      title: string;
      hint?: string;
    }
  | {
      type: "error";
      title: string;
      details: string;
    }
  | {
      type: "ready";
    };

function stringifyError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function BootStatusView({ state }: { state: Exclude<BootState, { type: "ready" }> }) {
  return (
    <div className="mx-auto max-w-xl space-y-3 px-4 py-12 text-center">
      <h2 className="text-base font-semibold text-white/90">{state.title}</h2>
      {"hint" in state && state.hint ? (
        <p className="text-sm text-white/70">{state.hint}</p>
      ) : null}
      {"details" in state ? (
        <p className="text-sm text-red-200/90">{state.details}</p>
      ) : null}
    </div>
  );
}

export function App({ crossOriginIsolationBootstrap }: AppProps) {
  const [bootState, setBootState] = React.useState<BootState>({
    type: "booting",
    title: "Initializing Monero",
    hint: "Preparing wallet module...",
  });
  const [WalletsListComponent, setWalletsListComponent] = React.useState<
    React.ComponentType | null
  >(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const isolationResult = await crossOriginIsolationBootstrap;
      if (cancelled) {
        return;
      }

      const hasSharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
      const isNativeApp = isNativeAppRuntime();
      const canUseThreads =
        hasSharedArrayBuffer && (window.crossOriginIsolated || isNativeApp);

      if (!canUseThreads) {
        if (isolationResult.type === "error") {
          const reasonText =
            isolationResult.reason === "service-worker-registration-failed" &&
            isolationResult.cause
              ? ` ${stringifyError(isolationResult.cause)}`
              : "";
          setBootState({
            type: "error",
            title: "Monero initialization failed",
            details: `${isolationResult.message}${reasonText}`,
          });
          return;
        }

        if (isNativeApp && !hasSharedArrayBuffer) {
          setBootState({
            type: "error",
            title: "Monero initialization failed",
            details:
              "SharedArrayBuffer is unavailable in this native runtime. Cross-origin isolation and worker threads are required for wallet startup.",
          });
          return;
        }

        const waitingHint =
          isolationResult.type === "waiting-for-service-worker-control"
            ? "Waiting for service worker activation. The page should reload automatically."
            : "Waiting for SharedArrayBuffer support.";
        setBootState({
          type: "booting",
          title: "Initializing Monero",
          hint: waitingHint,
        });
        return;
      }

      setBootState({
        type: "booting",
        title: "Initializing Monero",
        hint: "Loading wallet module...",
      });
      try {
        const { initModule } = await import("../monero-wasm-module/walletApi");
        await initModule();
        if (cancelled) {
          return;
        }
        setBootState({
          type: "booting",
          title: "Initializing Monero",
          hint: "Loading wallet UI...",
        });
        const { WalletsList } = await import("./components/starting");
        if (cancelled) {
          return;
        }
        if (!cancelled) {
          setWalletsListComponent(() => WalletsList);
          setBootState({ type: "ready" });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setBootState({
          type: "error",
          title: "Monero initialization failed",
          details: `Wallet module failed to initialize: ${stringifyError(error)}`,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [crossOriginIsolationBootstrap]);

  const statusViewState: Exclude<BootState, { type: "ready" }> =
    bootState.type === "ready"
      ? {
          type: "booting",
          title: "Initializing Monero",
          hint: "Loading wallet UI...",
        }
      : bootState;

  return (
    <div className="scrollbar-hidden-mobile mx-auto h-dvh w-full max-w-[1200px] overflow-y-auto overflow-x-hidden p-0 sm:h-auto sm:overflow-visible sm:p-6">
      <div
        className="card relative min-h-full overflow-hidden sm:h-auto"
        {...{ [APP_OVERLAY_ROOT_ATTRIBUTE]: "" }}
      >
        <div className="ambient-pane-overlay" />
        <div className="relative z-10">
          <AlertProvider>
            <MultisigDataOverlayProvider>
              {bootState.type === "ready" && WalletsListComponent ? (
                <WalletsListComponent />
              ) : (
                <BootStatusView state={statusViewState} />
              )}
            </MultisigDataOverlayProvider>
          </AlertProvider>
        </div>
      </div>
    </div>
  );
}
