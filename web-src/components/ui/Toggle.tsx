import { clsx } from "clsx";
import React from "react";

export function Toggle({
  checked,
  onChange,
  label,
  description,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx(
        "w-full cursor-pointer rounded-xl bg-white/5 p-3 text-left ring-1 ring-white/10 transition hover:bg-white/8",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white/90">{label}</div>
          {description && <div className="mt-0.5 text-[11px] text-white/50">{description}</div>}
        </div>
        <span
          className={clsx(
            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
            checked ? "bg-[#3a256a]" : "bg-white/20",
          )}
        >
          <span
            className={clsx(
              "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
              checked ? "translate-x-5" : "translate-x-0.5",
            )}
          />
        </span>
      </div>
    </button>
  );
}
