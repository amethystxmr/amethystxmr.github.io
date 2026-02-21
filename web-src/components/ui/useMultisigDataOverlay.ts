import React from "react";
import {
  ImportPromiseFn,
  MultisigDataOverlayContext,
} from "./MultisigDataOverlayContext";

export function useMultisigDataOverlayExport() {
  const ctx = React.useContext(MultisigDataOverlayContext);
  if (!ctx) {
    throw new Error(
      "useMultisigDataOverlayExport must be used inside MultisigDataOverlayProvider",
    );
  }
  return ctx.openExport;
}

export function useMultisigDataOverlayImport(): ImportPromiseFn {
  const ctx = React.useContext(MultisigDataOverlayContext);
  if (!ctx) {
    throw new Error(
      "useMultisigDataOverlayImport must be used inside MultisigDataOverlayProvider",
    );
  }
  return ctx.openImport;
}
