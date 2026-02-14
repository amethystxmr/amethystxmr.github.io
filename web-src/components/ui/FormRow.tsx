import { clsx } from "clsx";
import React from "react";
import type { DivProps } from "./types";

export function FormRow({ children, className, ...props }: DivProps) {
  return (
    <div className={clsx("mb-4", className)} {...props}>
      {children}
    </div>
  );
}
