import * as React from "react";
import { createRoot } from "react-dom/client";
import { initModule } from "../monero-wasm-module/walletApi";
import { WalletsList } from "./components/starting";
import { AlertProvider } from "./components/ui";

registerCrossOriginIsolationWorkaround();

const rootDiv =
  document.getElementById("root") ??
  document.body.appendChild(document.createElement("div"));

const root = createRoot(rootDiv);
root.render(<MyApp />);

function MyApp() {
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    initModule().then(() => setLoading(false));
  }, []);

  return (
    <div className="scrollbar-hidden-mobile mx-auto h-dvh w-full max-w-[1200px] overflow-y-auto overflow-x-hidden p-0 sm:h-auto sm:overflow-visible sm:p-6">
      <div className="card relative min-h-full overflow-hidden sm:h-auto">
        <div className="ambient-pane-overlay" />
        <div className="relative z-10">
          <AlertProvider>
            {loading ? (
              <div className="text-center">Loading...</div>
            ) : (
              <WalletsList />
            )}
          </AlertProvider>
        </div>
      </div>
    </div>
  );
}

function registerCrossOriginIsolationWorkaround() {
  if (!import.meta.env.PROD) {
    return;
  }
  if (!window.isSecureContext || window.crossOriginIsolated) {
    return;
  }
  if (!("serviceWorker" in navigator)) {
    console.warn("Service worker is unavailable; SharedArrayBuffer will fail.");
    return;
  }

  const path = window.location.pathname;
  const dirPath = path.endsWith("/") ? path : path.replace(/\/[^/]*$/, "/");
  const swUrl = `${window.location.origin}${dirPath}coi-serviceworker.js`;
  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      if (registration.active && !navigator.serviceWorker.controller) {
        window.location.reload();
        return;
      }
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.location.reload();
      });
    })
    .catch((err) => {
      console.error(
        "Failed to register cross-origin isolation workaround:",
        err,
      );
    });
}
