export function getDefaultWasmPthreadPoolSize(): number {
  if (import.meta.env.DEV) {
    return 2;
  }
  return navigator.hardwareConcurrency;
}
