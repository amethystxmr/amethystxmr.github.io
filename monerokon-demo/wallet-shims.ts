import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

class FileXmlHttpRequest {
  responseType = "";
  response: ArrayBuffer | null = null;
  responseURL = "";
  status = 0;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  onprogress: ((event: ProgressEvent) => void) | null = null;
  ontimeout: (() => void) | null = null;

  private url = "";

  open(_method: string, url: string): void {
    this.url = url;
    this.responseURL = url;
  }

  send(): void {
    void readFile(new URL(this.url))
      .then((data) => {
        this.status = 200;
        this.response = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        );
        this.onprogress?.({
          lengthComputable: true,
          loaded: data.byteLength,
          total: data.byteLength,
        } as ProgressEvent);
        this.onload?.();
      })
      .catch(() => {
        this.status = 404;
        this.onerror?.();
      });
  }
}

export function installWalletDemoShims(): void {
  if (!globalThis.crypto) {
    Object.defineProperty(globalThis, "crypto", {
      value: webcrypto,
      configurable: true,
    });
  }
  if (!("self" in globalThis)) {
    Object.defineProperty(globalThis, "self", {
      value: globalThis,
      configurable: true,
    });
  }
  if (!("WorkerGlobalScope" in globalThis)) {
    Object.defineProperty(globalThis, "WorkerGlobalScope", {
      value: function WorkerGlobalScope() {},
      configurable: true,
    });
  }
  if (!("XMLHttpRequest" in globalThis)) {
    Object.defineProperty(globalThis, "XMLHttpRequest", {
      value: FileXmlHttpRequest,
      configurable: true,
    });
  }
}

export async function loadWalletApi() {
  installWalletDemoShims();

  // @ts-ignore TS5097
  const walletApi = await import("../monero-wasm-module/walletApi.ts");
  await walletApi.initModule();
  return walletApi;
}
