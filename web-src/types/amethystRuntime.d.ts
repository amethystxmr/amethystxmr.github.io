export {};

declare global {
  interface Window {
    amethystRuntime?: {
      isNativeApp?: boolean;
    };
  }
}
