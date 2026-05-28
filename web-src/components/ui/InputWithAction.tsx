import { clsx } from "clsx";
import React from "react";
import { Input } from "./Input";
import type { BaseProps } from "./types";

export function InputWithAction({
  actionLabel,
  onAction,
  actionDisabled = false,
  actionButtonClassName,
  inputClassName,
  wrapperClassName,
  ...inputProps
}: React.InputHTMLAttributes<HTMLInputElement> &
  BaseProps & {
    actionLabel: React.ReactNode;
    onAction: () => void | Promise<void>;
    actionDisabled?: boolean;
    actionButtonClassName?: string;
    inputClassName?: string;
    wrapperClassName?: string;
  }) {
  return (
    <div className={clsx("relative", wrapperClassName)}>
      <Input
        {...inputProps}
        className={clsx("pr-32", inputClassName, inputProps.className)}
      />
      <button
        type="button"
        className={clsx(
          "absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold text-white/80 ring-1 ring-white/15 transition hover:bg-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40",
          actionButtonClassName,
        )}
        onClick={onAction}
        disabled={inputProps.disabled || actionDisabled}
      >
        {actionLabel}
      </button>
    </div>
  );
}
