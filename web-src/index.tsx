import * as React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

registerCrossOriginIsolationWorkaround();

const rootDiv =
  document.getElementById("root") ??
  document.body.appendChild(document.createElement("div"));

const root = createRoot(rootDiv);
root.render(<App />);

function registerCrossOriginIsolationWorkaround() {
  if (!import.meta.env.PROD) {
    return;
  }
  if (!window.isSecureContext || window.crossOriginIsolated) {
    return;
  }
  if (!("serviceWorker" in navigator)) {
    console.warn("Service worker is unavailable; SharedArrayBuffer will fail.");
    return;
  }

  const path = window.location.pathname;
  const dirPath = path.endsWith("/") ? path : path.replace(/\/[^/]*$/, "/");
  const swUrl = `${window.location.origin}${dirPath}coi-serviceworker.js`;
  navigator.serviceWorker
    .register(swUrl)
    .then((registration) => {
      if (registration.active && !navigator.serviceWorker.controller) {
        window.location.reload();
        return;
      }
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.location.reload();
      });
    })
    .catch((err) => {
      console.error(
        "Failed to register cross-origin isolation workaround:",
        err,
      );
    });
}
