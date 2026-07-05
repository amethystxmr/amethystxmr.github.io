import * as React from "react";
import type { ModuleLoadProgress } from "../monero-wasm-module/walletApi.workerClient";
import {
  APP_OVERLAY_ROOT_ATTRIBUTE,
  AlertProvider,
  MultisigDataOverlayProvider,
  ProgressBar,
} from "./components/ui";
import { registerPwaServiceWorker } from "./startup/registerPwaServiceWorker";

/** App-only phase after the worker module is ready (dynamic import of wallet UI). */
type WalletUiBootProgress =
  | { phase: "loadingWalletUi" }
  | { phase: "waitingForServiceWorker" };

type BootPhaseProgress = ModuleLoadProgress | WalletUiBootProgress;

type BootState =
  | { type: "booting"; progress: BootPhaseProgress }
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

function getBootPhaseUiText(progress: BootPhaseProgress): {
  title: string;
  barLabel: string;
} {
  const title = "Initializing AmethystXMR";

  switch (progress.phase) {
    case "preparingModule":
      return {
        title,
        barLabel: "Preparing wallet module...",
      };
    case "downloadingWasm":
      return {
        title,
        barLabel: "Loading wallet engine...",
      };
    case "decodingWasm":
      return {
        title,
        barLabel: "Decoding wallet engine...",
      };
    case "linkingNativeModule":
      return {
        title,
        barLabel: "Starting wallet engine...",
      };
    case "initializingWalletStorage":
      return {
        title,
        barLabel: "Preparing wallet storage...",
      };
    case "moduleReady":
      return {
        title,
        barLabel: "Wallet module ready",
      };
    case "loadingWalletUi":
      return {
        title,
        barLabel: "Loading wallet UI...",
      };
    case "waitingForServiceWorker":
      return {
        title,
        barLabel: "Waiting for browser isolation setup...",
      };
    default: {
      const _exhaustive: never = progress;
      return _exhaustive;
    }
  }
}

function bootProgressPercent(progress: BootPhaseProgress): number | undefined {
  if (progress.phase === "downloadingWasm") {
    const { bytesLoaded, bytesTotal } = progress;
    if (bytesTotal === null || bytesTotal <= 0) {
      return undefined;
    }
    return Math.min(100, Math.max(0, (bytesLoaded / bytesTotal) * 100));
  }
  if (progress.phase === "linkingNativeModule") {
    const { resolvedDependencies, totalDependencies } = progress;
    if (totalDependencies <= 0) {
      return undefined;
    }
    return Math.min(
      100,
      Math.max(0, (resolvedDependencies / totalDependencies) * 100),
    );
  }
  return undefined;
}

function BootStatusView({
  state,
}: {
  state: Exclude<BootState, { type: "ready" }>;
}) {
  if (state.type === "error") {
    return (
      <div className="mx-auto max-w-xl space-y-3 px-4 py-12 text-center">
        <h2 className="text-base font-semibold text-white/90">{state.title}</h2>
        <ProgressBar state="error" value={100} text="Initialization failed" />
        <p className="text-sm text-red-200/90">{state.details}</p>
      </div>
    );
  }

  const uiText = getBootPhaseUiText(state.progress);

  const progressPercent = bootProgressPercent(state.progress);

  const barState =
    progressPercent !== undefined
      ? ("progress" as const)
      : ("loading" as const);
  const barValue = progressPercent ?? 0;
  const barText = uiText.barLabel;

  return (
    <div className="mx-auto max-w-xl space-y-3 px-4 py-12 text-center">
      <h2 className="text-base font-semibold text-white/90">{uiText.title}</h2>
      <ProgressBar state={barState} value={barValue} text={barText} />
    </div>
  );
}

export function App() {
  const [bootState, setBootState] = React.useState<BootState>({
    type: "booting",
    progress: { phase: "preparingModule" },
  });
  const [WalletsListComponent, setWalletsListComponent] =
    React.useState<React.ComponentType | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setBootState({
        type: "booting",
        progress: { phase: "preparingModule" },
      });
      try {
        const serviceWorkerBootstrap = await registerPwaServiceWorker();
        if (cancelled) {
          return;
        }
        if (
          serviceWorkerBootstrap.type === "waiting-for-service-worker-control"
        ) {
          setBootState({
            type: "booting",
            progress: { phase: "waitingForServiceWorker" },
          });
          return;
        }
        if (serviceWorkerBootstrap.type === "error") {
          console.warn(
            serviceWorkerBootstrap.message,
            serviceWorkerBootstrap.cause,
          );
        }

        const { initModule } =
          await import("../monero-wasm-module/walletApi.workerClient");
        await initModule((progress) => {
          if (cancelled) {
            return;
          }
          setBootState({ type: "booting", progress });
        });
        if (cancelled) {
          return;
        }
        setBootState({
          type: "booting",
          progress: { phase: "loadingWalletUi" },
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
        console.error("error", error);
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
  }, []);

  const statusViewState: Exclude<BootState, { type: "ready" }> =
    bootState.type === "ready"
      ? { type: "booting", progress: { phase: "loadingWalletUi" } }
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
