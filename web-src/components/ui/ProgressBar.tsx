import React from "react";
import clsx from "clsx";

type ProgressState = "ready" | "loading" | "progress" | "error";

interface ProgressBarProps {
  value?: number;
  state: ProgressState;
  text: string;
  size?: "md" | "sm";
}

export function ProgressBar({ value = 0, state, text, size = "md" }: ProgressBarProps) {
  const isLoading = state === "loading";
  const isProgress = state === "progress";
  const isError = state === "error";

  return (
    <div className="w-full">
      <div
        className={clsx(
          "relative overflow-hidden rounded-lg bg-[#3a256a]",
          size === "sm" ? "h-7" : "h-10",
        )}
      >
        {isLoading && <div className="absolute inset-0 animate-pulse bg-[#4b2f8a]/60" />}

        {/* Progress / Error fill */}
        {(isProgress || isError) && (
          <div
            className={clsx(
              "absolute left-0 top-0 h-full transition-all duration-500 ease-out",
              state === "error" ? "bg-[#a24b5c]" : "bg-[#462d80]",
            )}
            style={{ width: `${value}%` }}
          />
        )}

        {/* Center text */}
        <div className="relative z-10 flex h-full items-center justify-center">
          <span
            className={clsx(
              size === "sm" ? "text-xs font-semibold" : "text-sm font-semibold",
              isError ? "text-[#ff7289]" : "text-white/90",
            )}
          >
            {text}
          </span>
        </div>
      </div>
    </div>
  );
}
