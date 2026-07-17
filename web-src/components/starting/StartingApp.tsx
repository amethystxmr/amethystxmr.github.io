import { AlertProvider, MultisigDataOverlayProvider } from "../ui";
import { WalletsList } from "./WalletsList";

/**
 * Root of the lazily-loaded wallet UI. The app-wide providers live here (rather
 * than in the bootstrap shell) so their code loads with the UI chunk.
 */
export function StartingApp() {
  return (
    <AlertProvider>
      <MultisigDataOverlayProvider>
        <WalletsList />
      </MultisigDataOverlayProvider>
    </AlertProvider>
  );
}
