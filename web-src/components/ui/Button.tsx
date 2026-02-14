import { clsx } from "clsx";
import React from "react";

export function Button({
  children,
  variant = "neutral",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  React.PropsWithChildren<{
    variant?: "neutral" | "primary" | "soft";
  }>) {
  return (
    <button
      {...props}
      className={clsx(
        "cursor-pointer p-3 flex-1 rounded-xl transition",
        variant === "primary" &&
          "bg-[#3a256a] text-white/90 ring-1 ring-white/10 hover:text-white hover:shadow-[0_0_20px_rgba(170,130,255,0.25)] disabled:opacity-40 disabled:cursor-not-allowed",
        variant === "neutral" &&
          "bg-white/8 hover:bg-white/12 disabled:opacity-40 disabled:cursor-not-allowed",
        variant === "soft" &&
          "bg-white/10 text-white/80 hover:bg-white/20 disabled:opacity-40 disabled:cursor-not-allowed",
        className,
      )}
    >
      {children}
    </button>
  );
}
