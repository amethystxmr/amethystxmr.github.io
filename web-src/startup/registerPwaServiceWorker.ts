function getServiceWorkerUrl() {
  const path = window.location.pathname;
  const dirPath = path.endsWith("/") ? path : path.replace(/\/[^/]*$/, "/");
  return `${window.location.origin}${dirPath}service-worker`;
}

function isNativeAppRuntime() {
  return window.amethystRuntime?.isNativeApp === true;
}

/** Registers a minimal service worker so installability checks can pass. */
export function registerPwaServiceWorker(): void {
  if (!import.meta.env.PROD) {
    return;
  }

  if (isNativeAppRuntime()) {
    return;
  }

  if (!window.isSecureContext || !("serviceWorker" in navigator)) {
    return;
  }

  void navigator.serviceWorker.register(getServiceWorkerUrl(), {
    updateViaCache: "none",
  });
}
