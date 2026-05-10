function scriptIsLegacyCoi(scriptUrl: string): boolean {
  try {
    const { pathname } = new URL(scriptUrl);
    return (
      pathname.endsWith("/coi-serviceworker.js") ||
      pathname === "/coi-serviceworker.js"
    );
  } catch {
    return false;
  }
}

function registrationIsLegacyCoi(registration: ServiceWorkerRegistration) {
  for (const worker of [
    registration.active,
    registration.waiting,
    registration.installing,
  ]) {
    if (worker && scriptIsLegacyCoi(worker.scriptURL)) {
      return true;
    }
  }
  return false;
}

/** Drops the old GitHub Pages COI worker from earlier builds (no longer shipped). */
export function unregisterLegacyCoiServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      if (registrationIsLegacyCoi(registration)) {
        void registration.unregister();
      }
    }
  });
}
