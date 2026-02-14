import { clsx } from "clsx";
import React from "react";
import type { DivProps } from "./types";

export function MonoScrollPanel({ children, className, ...props }: DivProps) {
  return (
    <div
      className={clsx(
        "scrollbar-glass whitespace-pre h-auto border-white/20 rounded-xl p-2 bg-white/5 border overflow-visible font-mono text-sm lg:h-full lg:min-h-0 lg:overflow-auto",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
