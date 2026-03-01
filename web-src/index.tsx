import * as React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ensureCrossOriginIsolationWorkaround } from "./startup/crossOriginIsolation";

const crossOriginIsolationBootstrap = ensureCrossOriginIsolationWorkaround();

const rootDiv =
  document.getElementById("root") ??
  document.body.appendChild(document.createElement("div"));

const root = createRoot(rootDiv);
root.render(
  <App crossOriginIsolationBootstrap={crossOriginIsolationBootstrap} />,
);
