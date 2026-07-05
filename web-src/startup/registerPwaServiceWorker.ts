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
        | "service-worker-control-timeout";
      message: string;
      cause: unknown;
      sharedArrayBufferAvailable: false;
    };

const SERVICE_WORKER_CONTROL_TIMEOUT_MS = 10_000;

function isSharedArrayBufferAvailable() {
  return typeof SharedArrayBuffer === "function";
}

function createReloadRequest() {
  let requested = false;
  return {
    isRequested() {
      return requested;
    },
    request() {
      if (requested) {
        return;
      }
      requested = true;
      window.location.reload();
    },
  };
}

async function waitForServiceWorkerControl(
  registration: ServiceWorkerRegistration,
  reloadRequest: ReturnType<typeof createReloadRequest>,
) {
  return new Promise<"reload-requested" | "timed-out">((resolve) => {
    if (reloadRequest.isRequested()) {
      resolve("reload-requested");
      return;
    }

    let settled = false;
    let watchedWorker: ServiceWorker | null = null;

    const timeoutId = window.setTimeout(() => {
      finish("timed-out");
    }, SERVICE_WORKER_CONTROL_TIMEOUT_MS);

    const finish = (result: "reload-requested" | "timed-out") => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
      registration.removeEventListener("updatefound", onUpdateFound);
      watchedWorker?.removeEventListener("statechange", onStateChange);
      if (result === "reload-requested") {
        reloadRequest.request();
      }
      resolve(result);
    };

    const onControllerChange = () => {
      finish("reload-requested");
    };

    const onStateChange = () => {
      if (watchedWorker?.state === "activated") {
        finish("reload-requested");
      }
    };

    const watchWorker = (worker: ServiceWorker | null) => {
      if (!worker) {
        return;
      }

      watchedWorker?.removeEventListener("statechange", onStateChange);
      watchedWorker = worker;

      if (worker.state === "activated") {
        finish("reload-requested");
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

    if (reloadRequest.isRequested()) {
      finish("reload-requested");
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
    let removeControlChangeListener = () => {};
    try {
      const reloadRequest = createReloadRequest();
      const onControlChange = () => {
        reloadRequest.request();
      };
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        onControlChange,
        { once: true },
      );
      removeControlChangeListener = () => {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          onControlChange,
        );
      };

      const registration = await navigator.serviceWorker.register(swUrl, {
        updateViaCache: "none",
      });

      if (!navigator.serviceWorker.controller) {
        const controlResult = await waitForServiceWorkerControl(
          registration,
          reloadRequest,
        );
        if (controlResult === "timed-out") {
          removeControlChangeListener();
          return {
            type: "error",
            reason: "service-worker-control-timeout",
            message: `Timed out waiting for service worker control at ${swUrl}. Falling back to the asyncify WASM build.`,
            cause: new Error("Timed out waiting for service worker control"),
            sharedArrayBufferAvailable: false,
          } as const;
        }
        return {
          type: "waiting-for-service-worker-control",
          swUrl,
        } as const;
      }

      return {
        type: "ready",
        sharedArrayBufferAvailable: isSharedArrayBufferAvailable(),
      } as const;
    } catch (cause) {
      removeControlChangeListener();
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
