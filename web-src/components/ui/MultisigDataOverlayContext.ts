import React from "react";

export type MultisigDataOverlayExportOptions = {
  data: Uint8Array;
  header: string;
  fileName: string;
  action?: {
    onAction: () => void | Promise<void>;
    label: string;
  };
};

export type MultisigDataOverlayImportOptions = {
  header: string;
  subheader?: string;
  allowMultifiles?: boolean;
};

export type ImportPromiseFn = {
  (
    options: MultisigDataOverlayImportOptions & { allowMultifiles: true },
  ): Promise<Uint8Array[] | null>;
  (
    options: MultisigDataOverlayImportOptions & {
      allowMultifiles?: false | undefined;
    },
  ): Promise<Uint8Array | null>;
};

type MultisigDataOverlayContextValue = {
  openExport: (options: MultisigDataOverlayExportOptions) => Promise<void>;
  openImport: ImportPromiseFn;
};

export const MultisigDataOverlayContext =
  React.createContext<MultisigDataOverlayContextValue | null>(null);
