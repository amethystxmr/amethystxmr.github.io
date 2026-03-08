import React from "react";
import { Button } from "./Button";

export function ButtonRadioRow({
  label,
  options,
  value,
  onChange,
  disabled = false,
  compact = false,
  ariaLabelPrefix,
}: {
  label: React.ReactNode;
  options: number[];
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  compact?: boolean;
  ariaLabelPrefix?: string;
}) {
  return (
    <div
      className={
        compact
          ? "space-y-1 lg:grid lg:grid-cols-[190px_minmax(0,1fr)] lg:items-start lg:gap-2 lg:space-y-0"
          : "space-y-2"
      }
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-white/85">
        {label}
      </div>
      <div
        className={
          compact
            ? "grid grid-cols-5 gap-1.5 sm:grid-cols-6 lg:grid-cols-8 lg:gap-1"
            : "flex flex-wrap gap-2"
        }
      >
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            aria-label={
              ariaLabelPrefix ? `${ariaLabelPrefix} ${option}` : undefined
            }
            className={
              compact
                ? "w-full px-2.5 py-1.5 text-xs"
                : "!flex-none px-3 py-2 text-xs"
            }
            variant={option === value ? "primary" : "soft"}
            disabled={disabled}
            onClick={() => onChange(option)}
          >
            {option}
          </Button>
        ))}
      </div>
    </div>
  );
}
