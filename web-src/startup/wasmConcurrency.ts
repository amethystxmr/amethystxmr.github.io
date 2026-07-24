export function getDefaultWasmPthreadPoolSize(): number {
  return navigator.hardwareConcurrency;
}
