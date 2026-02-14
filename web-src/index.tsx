import * as React from "react";
import { createRoot } from "react-dom/client";
import {
  createWallet,
  initModule,
  listWalletNames,
  MoneroWasmWallet,
  saveFilesystem,
} from "../monero-wasm-module/walletApi";
import { WalletMain } from "./components/main";
import { WalletsList } from "./components/starting";
import { AlertProvider } from "./components/ui";

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
      <div className="card min-h-full sm:h-auto">
        <AlertProvider>
          {loading ? (
            <div className="text-center">Loading...</div>
          ) : (
            <WalletsList />
          )}
        </AlertProvider>
      </div>
    </div>
  );
}
