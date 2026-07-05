function getServiceWorkerUrl() {
  const path = window.location.pathname;
  const dirPath = path.endsWith("/") ? path : path.replace(/\/[^/]*$/, "/");
  return `${window.location.origin}${dirPath}service-worker.js`;
}

export type PwaServiceWorkerBootstrapResult =
  | { type: "ready"; sharedArrayBufferAvailable: boolean }
  | {
      type: "skipped";
      reason:
        | "non-production-build"
        | "native-app"
        | "shared-array-buffer-available"
        | "insecure-context"
        | "service-worker-unavailable";
      sharedArrayBufferAvailable: boolean;
    }
  | {
      type: "error";
      reason: "service-worker-registration-failed";
      message: string;
      cause: unknown;
      sharedArrayBufferAvailable: false;
    };

function isSharedArrayBufferAvailable() {
  return typeof SharedArrayBuffer === "function";
}

export function isNativeAppRuntime() {
  return window.amethystRuntime?.isNativeApp === true;
}

let bootstrapPromise: Promise<PwaServiceWorkerBootstrapResult> | null = null;

/** Registers the production COI service worker when needed for pthread WASM. */
export function registerPwaServiceWorker(): Promise<PwaServiceWorkerBootstrapResult> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    if (isSharedArrayBufferAvailable()) {
      return {
        type: "skipped",
        reason: "shared-array-buffer-available",
        sharedArrayBufferAvailable: true,
      } as const;
    }

    if (!import.meta.env.PROD) {
      return {
        type: "skipped",
        reason: "non-production-build",
        sharedArrayBufferAvailable: false,
      } as const;
    }

    if (isNativeAppRuntime()) {
      return {
        type: "skipped",
        reason: "native-app",
        sharedArrayBufferAvailable: false,
      } as const;
    }

    if (!window.isSecureContext) {
      return {
        type: "skipped",
        reason: "insecure-context",
        sharedArrayBufferAvailable: false,
      } as const;
    }

    if (!("serviceWorker" in navigator)) {
      return {
        type: "skipped",
        reason: "service-worker-unavailable",
        sharedArrayBufferAvailable: false,
      } as const;
    }

    const swUrl = getServiceWorkerUrl();
    try {
      await navigator.serviceWorker.register(swUrl, {
        updateViaCache: "none",
      });

      return {
        type: "ready",
        sharedArrayBufferAvailable: isSharedArrayBufferAvailable(),
      } as const;
    } catch (cause) {
      return {
        type: "error",
        reason: "service-worker-registration-failed",
        message: `Failed to register service worker at ${swUrl}. Falling back to the asyncify WASM build.`,
        cause,
        sharedArrayBufferAvailable: false,
      } as const;
    }
  })();

  return bootstrapPromise;
}
