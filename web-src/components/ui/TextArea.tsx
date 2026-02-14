import { clsx } from "clsx";
import React from "react";
import { baseClasses } from "./fieldStyles";
import type { BaseProps } from "./types";

export function TextArea({
  error,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & BaseProps) {
  return (
    <textarea
      className={clsx(
        baseClasses,
        error
          ? "border-red-400 focus-visible:border-red-400 focus-visible:ring-4 focus-visible:ring-red-400/30"
          : "border-white/20 focus-visible:border-white/40 focus-visible:ring-2 focus-visible:ring-white/20",
        className,
      )}
      {...props}
    />
  );
}
