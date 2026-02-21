import React from "react";
import { AlertContext } from "./AlertContext";

export function useAlert() {
  const ctx = React.useContext(AlertContext);
  if (!ctx) {
    throw new Error("useAlert must be used inside AlertProvider");
  }
  return ctx;
}
