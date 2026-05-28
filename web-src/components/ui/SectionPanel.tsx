import { clsx } from "clsx";
import React from "react";
import type { DivProps } from "./types";

export function SectionPanel({ children, className, ...props }: DivProps) {
  return (
    <div
      className={clsx(
        "rounded-2xl bg-white/5 p-4 ring-1 ring-white/10",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
