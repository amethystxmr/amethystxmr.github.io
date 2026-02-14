import { clsx } from "clsx";
import React from "react";
import type { DivProps } from "./types";

export function SurfaceCard({ children, className, ...props }: DivProps) {
  return (
    <div className={clsx("rounded-xl bg-white/5 p-3 ring-1 ring-white/10", className)} {...props}>
      {children}
    </div>
  );
}
