import React from "react";
import { downloadBlob } from "../utils";
import { Button } from "./Button";
import { TextArea } from "./TextArea";

type EncodingMode = "hex" | "base64";

const TEXT_PREVIEW_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_MULTIFILES_SUBHEADER = "Split different messages by newline";

export type MultisigDataOverlayExportOptions = {
  data: Uint8Array;
  header: string;
  fileName: string;
};

export type MultisigDataOverlayImportOptions = {
  header: string;
  subheader?: string;
  allowMultifiles?: boolean;
};

type ImportPromiseFn = {
  (
    options: MultisigDataOverlayImportOptions & { allowMultifiles: true },
  ): Promise<Uint8Array[] | null>;
  (
    options: MultisigDataOverlayImportOptions & {
      allowMultifiles?: false | undefined;
    },
  ): Promise<Uint8Array | null>;
};

type OverlayRequest =
  | {
      type: "export";
      options: MultisigDataOverlayExportOptions;
      resolve: () => void;
    }
  | {
      type: "import";
      options: MultisigDataOverlayImportOptions;
      resolve: (value: Uint8Array | Uint8Array[] | null) => void;
    };

const MultisigDataOverlayContext = React.createContext<{
  openExport: (options: MultisigDataOverlayExportOptions) => Promise<void>;
  openImport: ImportPromiseFn;
} | null>(null);

export function MultisigDataOverlayProvider({
  children,
}: React.PropsWithChildren) {
  const [request, setRequest] = React.useState<OverlayRequest | null>(null);
  const requestRef = React.useRef<OverlayRequest | null>(null);

  React.useEffect(() => {
    requestRef.current = request;
  }, [request]);

  React.useEffect(() => {
    return () => {
      const pending = requestRef.current;
      if (!pending) {
        return;
      }
      if (pending.type === "export") {
        pending.resolve();
      } else {
        pending.resolve(null);
      }
      requestRef.current = null;
    };
  }, []);

  const openExport = React.useCallback(
    (options: MultisigDataOverlayExportOptions) => {
      if (requestRef.current !== null) {
        throw new Error(
          "Cannot open multisig export overlay while another multisig overlay is active",
        );
      }
      return new Promise<void>((resolve) => {
        setRequest({ type: "export", options, resolve });
      });
    },
    [],
  );

  function openImport(
    options: MultisigDataOverlayImportOptions & { allowMultifiles: true },
  ): Promise<Uint8Array[] | null>;
  function openImport(
    options: MultisigDataOverlayImportOptions & {
      allowMultifiles?: false | undefined;
    },
  ): Promise<Uint8Array | null>;
  function openImport(options: MultisigDataOverlayImportOptions) {
    if (requestRef.current !== null) {
      throw new Error(
        "Cannot open multisig import overlay while another multisig overlay is active",
      );
    }
    return new Promise<Uint8Array | Uint8Array[] | null>((resolve) => {
      setRequest({ type: "import", options, resolve });
    });
  }

  const closeCurrent = React.useCallback(() => {
    setRequest((current) => {
      if (!current) {
        return null;
      }
      if (current.type === "export") {
        current.resolve();
      } else {
        current.resolve(null);
      }
      return null;
    });
  }, []);

  const resolveImportCurrent = React.useCallback(
    (value: Uint8Array | Uint8Array[]) => {
      setRequest((current) => {
        if (!current) {
          return null;
        }
        if (current.type === "import") {
          current.resolve(value);
        } else {
          current.resolve();
        }
        return null;
      });
    },
    [],
  );

  const resolveExportCurrent = React.useCallback(() => {
    setRequest((current) => {
      if (!current) {
        return null;
      }
      if (current.type === "export") {
        current.resolve();
      } else {
        current.resolve(null);
      }
      return null;
    });
  }, []);

  return (
    <MultisigDataOverlayContext.Provider
      value={{
        openExport,
        openImport,
      }}
    >
      {children}
      <MultisigDataOverlayDialog
        request={request}
        onClose={closeCurrent}
        onResolveImport={resolveImportCurrent}
        onResolveExport={resolveExportCurrent}
      />
    </MultisigDataOverlayContext.Provider>
  );
}

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

function MultisigDataOverlayDialog({
  request,
  onClose,
  onResolveImport,
  onResolveExport,
}: {
  request: OverlayRequest | null;
  onClose: () => void;
  onResolveImport: (value: Uint8Array | Uint8Array[]) => void;
  onResolveExport: () => void;
}) {
  const [mode, setMode] = React.useState<EncodingMode>("hex");
  const [inputText, setInputText] = React.useState("");
  const [errorText, setErrorText] = React.useState("");
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!request) {
      return;
    }
    setMode("hex");
    setInputText("");
    setErrorText("");
  }, [request]);

  React.useEffect(() => {
    if (!request) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, request]);

  if (!request) {
    return null;
  }

  const isExport = request.type === "export";
  const subheader =
    request.type === "import"
      ? (request.options.subheader ??
        (request.options.allowMultifiles ? DEFAULT_MULTIFILES_SUBHEADER : ""))
      : "";
  const hasInput = inputText.trim().length > 0;

  const exportData = request.type === "export" ? request.options.data : null;
  const isTooBigForPreview =
    exportData !== null && exportData.length > TEXT_PREVIEW_LIMIT_BYTES;

  const exportPreview = !exportData
    ? ""
    : isTooBigForPreview
      ? `<data is too big, size=${exportData.length}, only download is possible>`
      : mode === "hex"
        ? encodeHex(exportData)
        : encodeBase64(exportData);

  const rightButtonText = isExport ? "Close" : hasInput ? "Import" : "Close";
  const leftFileButtonText = isExport ? "Save to file" : "Import from file";

  const handleFileButtonClick = () => {
    if (isExport) {
      const options = request.options;
      if (request.type !== "export") {
        return;
      }
      const dataCopy = new Uint8Array(options.data.length);
      dataCopy.set(options.data);
      downloadBlob(
        new Blob([dataCopy], { type: "application/octet-stream" }),
        options.fileName,
      );
      onResolveExport();
      return;
    }
    fileInputRef.current?.click();
  };

  const handleImportFromTextarea = () => {
    if (request.type !== "import") {
      return;
    }
    if (!hasInput) {
      onClose();
      return;
    }
    try {
      const allowMultifiles = request.options.allowMultifiles === true;
      if (!allowMultifiles) {
        const parsed = decodeByMode(inputText.trim(), mode);
        onResolveImport(parsed);
        return;
      }

      const lines = inputText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const parsed = lines.map((line, index) => {
        try {
          return decodeByMode(line, mode);
        } catch (error) {
          throw new Error(`Line ${index + 1}: ${(error as Error).message}`);
        }
      });
      onResolveImport(parsed);
    } catch (error) {
      setErrorText((error as Error).message || "Failed to decode data");
    }
  };

  const handleImportFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (request.type !== "import") {
      return;
    }

    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = "";
    if (files.length === 0) {
      return;
    }

    try {
      const parsed = await Promise.all(
        files.map(async (file) => new Uint8Array(await file.arrayBuffer())),
      );
      if (request.options.allowMultifiles === true) {
        onResolveImport(parsed);
      } else {
        onResolveImport(parsed[0]);
      }
    } catch {
      setErrorText("Failed to read selected file");
    }
  };

  return (
    <div className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-[1px]">
      <div className="flex h-full w-full flex-col bg-[#211239] p-3 ring-1 ring-white/15 sm:p-4">
        <div className="space-y-1 border-b border-white/10 pb-3">
          <div className="text-base font-semibold text-white/90">
            {request.options.header}
          </div>
          {subheader ? (
            <div className="text-sm text-white/70">{subheader}</div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 py-3">
          <TextArea
            readOnly={isExport}
            value={isExport ? exportPreview : inputText}
            onChange={(event) => {
              setInputText(event.target.value);
              setErrorText("");
            }}
            className="scrollbar-glass h-full resize-none overflow-x-hidden overflow-y-scroll whitespace-pre-wrap break-all font-mono text-xs leading-relaxed sm:text-sm"
            spellCheck={false}
            wrap="soft"
            placeholder={
              isExport
                ? ""
                : mode === "hex"
                  ? "Paste hex data here"
                  : "Paste base64 data here"
            }
          />
        </div>

        <div className="space-y-2 border-t border-white/10 pt-3">
          {errorText ? (
            <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-100 ring-1 ring-red-300/30">
              {errorText}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg bg-white/5 p-1 ring-1 ring-white/15">
                <Button
                  type="button"
                  variant={mode === "hex" ? "primary" : "soft"}
                  className="!flex-none px-3 py-1.5 text-xs"
                  onClick={() => {
                    setMode("hex");
                    setErrorText("");
                  }}
                >
                  hex
                </Button>
                <Button
                  type="button"
                  variant={mode === "base64" ? "primary" : "soft"}
                  className="!flex-none px-3 py-1.5 text-xs"
                  onClick={() => {
                    setMode("base64");
                    setErrorText("");
                  }}
                >
                  base64
                </Button>
              </div>

              <Button
                type="button"
                variant="soft"
                className="!flex-none px-3 py-1.5 text-xs"
                onClick={handleFileButtonClick}
              >
                {leftFileButtonText}
              </Button>

              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple={
                  request.type === "import" &&
                  request.options.allowMultifiles === true
                }
                onChange={(event) => {
                  void handleImportFileChange(event);
                }}
              />
            </div>

            <Button
              type="button"
              variant={isExport || !hasInput ? "soft" : "primary"}
              className="!flex-none px-4 py-1.5 text-xs"
              onClick={() => {
                if (isExport) {
                  onClose();
                } else {
                  handleImportFromTextarea();
                }
              }}
            >
              {rightButtonText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function decodeByMode(value: string, mode: EncodingMode): Uint8Array {
  return mode === "hex" ? decodeHex(value) : decodeBase64(value);
}

function encodeHex(data: Uint8Array): string {
  let out = "";
  for (let i = 0; i < data.length; i += 1) {
    out += data[i].toString(16).padStart(2, "0");
  }
  return out;
}

function decodeHex(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, "");
  if (normalized.length === 0) {
    throw new Error("Input is empty");
  }
  if (normalized.length % 2 !== 0) {
    throw new Error("Hex data length must be even");
  }
  if (!/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error("Hex data contains invalid characters");
  }

  const out = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    out[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
  }
  return out;
}

function encodeBase64(data: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, "");
  if (normalized.length === 0) {
    throw new Error("Input is empty");
  }

  try {
    const binary = atob(normalized);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    throw new Error("Base64 data is invalid");
  }
}
