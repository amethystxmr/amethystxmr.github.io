const THREADING_MODE_STORAGE_KEY = "amethystxmr:threads-mode";
const THREADING_MODE_VALUES = ["none", "1", "2", "4", "all"] as const;

export type WasmThreadingMode = (typeof THREADING_MODE_VALUES)[number];

function isWasmThreadingMode(value: string): value is WasmThreadingMode {
  return THREADING_MODE_VALUES.some((mode) => mode === value);
}

export function getHardwareConcurrency(): number {
  const cores = navigator.hardwareConcurrency;
  if (!Number.isInteger(cores) || cores <= 0) {
    return 1;
  }
  return cores;
}

export function getDefaultWasmThreadingMode(): WasmThreadingMode {
  if (import.meta.env.DEV) {
    return "1";
  }

  const cores = getHardwareConcurrency();
  if (cores >= 4) {
    return "4";
  }
  if (cores >= 2) {
    return "2";
  }
  return "1";
}

export function getStoredWasmThreadingMode(): WasmThreadingMode | null {
  try {
    const stored = localStorage.getItem(THREADING_MODE_STORAGE_KEY);
    if (stored && isWasmThreadingMode(stored)) {
      return stored;
    }
  } catch {
    // Best effort only; startup can continue with the detected default.
  }
  return null;
}

export function getSelectedWasmThreadingMode(): WasmThreadingMode {
  return getStoredWasmThreadingMode() ?? getDefaultWasmThreadingMode();
}

export function setSelectedWasmThreadingMode(mode: WasmThreadingMode): void {
  try {
    if (mode === getDefaultWasmThreadingMode()) {
      localStorage.removeItem(THREADING_MODE_STORAGE_KEY);
    } else {
      localStorage.setItem(THREADING_MODE_STORAGE_KEY, mode);
    }
  } catch {
    // Best effort only; a failed write just keeps the current startup mode.
  }
}

export function isWasmThreadingDisabledByUser(): boolean {
  return getSelectedWasmThreadingMode() === "none";
}

export function getWasmPthreadPoolSize(): number {
  const mode = getSelectedWasmThreadingMode();
  switch (mode) {
    case "all":
      return getHardwareConcurrency();
    case "4":
      return 4;
    case "2":
      return 2;
    case "1":
    case "none":
      return 1;
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function isWasmThreadingAvailableForCurrentPage(): boolean {
  return (
    globalThis.crossOriginIsolated && typeof SharedArrayBuffer === "function"
  );
}

export function canWasmThreadingBeEnabledAfterReload(): boolean {
  return (
    isWasmThreadingAvailableForCurrentPage() ||
    (import.meta.env.PROD &&
      window.amethystRuntime?.isNativeApp !== true &&
      window.isSecureContext &&
      "serviceWorker" in navigator)
  );
}
