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
  | { type: "waiting-for-service-worker-control"; swUrl: string }
  | {
      type: "error";
      reason:
        | "service-worker-registration-failed"
        | "service-worker-isolation-unavailable";
      message: string;
      cause: unknown;
      sharedArrayBufferAvailable: false;
    };

const SERVICE_WORKER_CONTROL_TIMEOUT_MS = 5_000;
const SERVICE_WORKER_RELOAD_SESSION_KEY =
  "amethystxmr:service-worker-reload-for-control";

function isSharedArrayBufferAvailable() {
  return typeof SharedArrayBuffer === "function";
}

function serviceWorkerReloadWasAttempted(swUrl: string) {
  try {
    return sessionStorage.getItem(SERVICE_WORKER_RELOAD_SESSION_KEY) === swUrl;
  } catch {
    return false;
  }
}

function markServiceWorkerReloadAttempt(swUrl: string) {
  try {
    sessionStorage.setItem(SERVICE_WORKER_RELOAD_SESSION_KEY, swUrl);
  } catch {
    // Best effort only; reload still needs to happen.
  }
}

function clearServiceWorkerReloadAttempt() {
  try {
    sessionStorage.removeItem(SERVICE_WORKER_RELOAD_SESSION_KEY);
  } catch {
    // Best effort only.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitForServiceWorkerControl(
  registration: ServiceWorkerRegistration,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let watchedWorker: ServiceWorker | null = null;

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      registration.removeEventListener("updatefound", onUpdateFound);
      watchedWorker?.removeEventListener("statechange", onStateChange);
      resolve();
    };

    const onControllerChange = () => {
      finish();
    };

    const onStateChange = () => {
      if (watchedWorker?.state === "activated") {
        finish();
      }
    };

    const watchWorker = (worker: ServiceWorker | null) => {
      if (!worker) {
        return;
      }

      watchedWorker?.removeEventListener("statechange", onStateChange);
      watchedWorker = worker;

      if (worker.state === "activated") {
        finish();
        return;
      }

      worker.addEventListener("statechange", onStateChange);
    };

    const onUpdateFound = () => {
      watchWorker(registration.installing);
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
      { once: true },
    );
    registration.addEventListener("updatefound", onUpdateFound);
    watchWorker(
      registration.active ?? registration.waiting ?? registration.installing,
    );

    if (navigator.serviceWorker.controller || registration.active) {
      finish();
    }
  });
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
      clearServiceWorkerReloadAttempt();
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
      const registration = await navigator.serviceWorker.register(swUrl, {
        updateViaCache: "none",
      });

      if (!serviceWorkerReloadWasAttempted(swUrl)) {
        await Promise.race([
          waitForServiceWorkerControl(registration),
          delay(SERVICE_WORKER_CONTROL_TIMEOUT_MS),
        ]);
        markServiceWorkerReloadAttempt(swUrl);
        window.location.reload();
        return {
          type: "waiting-for-service-worker-control",
          swUrl,
        } as const;
      }

      if (!isSharedArrayBufferAvailable()) {
        return {
          type: "error",
          reason: "service-worker-isolation-unavailable",
          message: `Service worker at ${swUrl} did not enable browser isolation after reload. Falling back to the asyncify WASM build.`,
          cause: new Error(
            "Service worker did not enable browser isolation after reload",
          ),
          sharedArrayBufferAvailable: false,
        } as const;
      }

      return {
        type: "ready",
        sharedArrayBufferAvailable: true,
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
