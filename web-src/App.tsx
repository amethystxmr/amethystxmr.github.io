import * as React from "react";
import { initModule } from "../monero-wasm-module/walletApi";
import { WalletsList } from "./components/starting";
import {
  APP_OVERLAY_ROOT_ATTRIBUTE,
  AlertProvider,
  MultisigDataOverlayProvider,
} from "./components/ui";

export function App() {
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    initModule().then(() => setLoading(false));
  }, []);

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
              {loading ? (
                <div className="text-center">Loading...</div>
              ) : (
                <WalletsList />
              )}
            </MultisigDataOverlayProvider>
          </AlertProvider>
        </div>
      </div>
    </div>
  );
}
