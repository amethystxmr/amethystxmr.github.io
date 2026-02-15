import React from "react";
import { Button } from "./Button";

export function ButtonRadioRow({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: number[];
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-white/85">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            className="!flex-none px-3 py-2 text-xs"
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
