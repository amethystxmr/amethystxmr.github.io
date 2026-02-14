import { clsx } from "clsx";
import React from "react";

export function ShimmerStatus({ text, className }: { text: string; className?: string }) {
  return (
    <div className={clsx("relative h-14 overflow-hidden rounded-lg bg-[#3a256a]", className)}>
      <div className="absolute inset-0 animate-pulse bg-[#4b2f8a]/60" />
      <div className="relative z-10 flex h-full items-center justify-center text-sm font-semibold text-white/90">
        {text}
      </div>
    </div>
  );
}
