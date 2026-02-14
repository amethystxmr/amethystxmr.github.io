import { clsx } from "clsx";
import React from "react";
import type { DivProps } from "./types";

export function MutedText({ children, className, ...props }: DivProps) {
  return (
    <div className={clsx("text-white/60", className)} {...props}>
      {children}
    </div>
  );
}
