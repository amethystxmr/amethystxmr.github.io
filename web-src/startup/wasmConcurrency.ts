import { wasmPthreadPoolSizeOverrideStorageKey } from "./wasmConcurrencyOverride";

function parsePthreadPoolSizeOverride(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readPthreadPoolSizeOverride(): number | null {
  try {
    const sessionOverride = parsePthreadPoolSizeOverride(
      sessionStorage.getItem(wasmPthreadPoolSizeOverrideStorageKey),
    );
    if (sessionOverride !== null) {
      return sessionOverride;
    }
  } catch {
    // Storage may be unavailable in hardened or embedded browser contexts.
  }

  try {
    return parsePthreadPoolSizeOverride(
      localStorage.getItem(wasmPthreadPoolSizeOverrideStorageKey),
    );
  } catch {
    return null;
  }
}

export function getDefaultWasmPthreadPoolSize(): number {
  const override = readPthreadPoolSizeOverride();
  if (override !== null) {
    return override;
  }
  if (import.meta.env.DEV) {
    return 2;
  }
  return navigator.hardwareConcurrency;
}
