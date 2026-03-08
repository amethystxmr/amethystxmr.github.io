export type CrossOriginIsolationBootstrapResult =
  | {
      type: "ready";
    }
  | {
      type: "skipped";
      reason: "non-production-build" | "already-isolated" | "native-app";
    }
  | {
      type: "waiting-for-service-worker-control";
      swUrl: string;
    }
  | {
      type: "error";
      reason:
        | "insecure-context"
        | "service-worker-unavailable"
        | "service-worker-registration-failed";
      message: string;
      cause?: unknown;
    };

let bootstrapPromise: Promise<CrossOriginIsolationBootstrapResult> | null = null;

export function isNativeAppRuntime() {
  return window.amethystRuntime?.isNativeApp === true;
}

function getSwUrl() {
  const path = window.location.pathname;
  const dirPath = path.endsWith("/") ? path : path.replace(/\/[^/]*$/, "/");
  return `${window.location.origin}${dirPath}coi-serviceworker.js`;
}

export function ensureCrossOriginIsolationWorkaround() {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    if (!import.meta.env.PROD) {
      return {
        type: "skipped",
        reason: "non-production-build",
      } as const;
    }

    if (isNativeAppRuntime()) {
      return {
        type: "skipped",
        reason: "native-app",
      } as const;
    }

    if (window.crossOriginIsolated) {
      return {
        type: "skipped",
        reason: "already-isolated",
      } as const;
    }

    if (!window.isSecureContext) {
      return {
        type: "error",
        reason: "insecure-context",
        message:
          "This page is not running in a secure context (HTTPS), so SharedArrayBuffer is unavailable. Use HTTPS and enable cross-origin isolation with COOP/COEP headers or service-worker fallback.",
      } as const;
    }

    if (!("serviceWorker" in navigator)) {
      return {
        type: "error",
        reason: "service-worker-unavailable",
        message:
          "This browser does not support service workers, so fallback isolation cannot be enabled. Configure COOP/COEP headers on the server to use SharedArrayBuffer.",
      } as const;
    }

    const swUrl = getSwUrl();
    try {
      const registration = await navigator.serviceWorker.register(swUrl);
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          window.location.reload();
        },
        { once: true },
      );

      if (!navigator.serviceWorker.controller) {
        if (registration.active) {
          window.location.reload();
        }
        return {
          type: "waiting-for-service-worker-control",
          swUrl,
        } as const;
      }

      return { type: "ready" } as const;
    } catch (cause) {
      return {
        type: "error",
        reason: "service-worker-registration-failed",
        message: `Failed to register cross-origin isolation service worker at ${swUrl}. Configure COOP/COEP headers on the server or fix service worker delivery.`,
        cause,
      } as const;
    }
  })();

  return bootstrapPromise;
}
