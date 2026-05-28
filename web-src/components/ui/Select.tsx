import { clsx } from "clsx";
import React from "react";
import { baseClasses } from "./fieldStyles";
import type { DivProps } from "./types";

type SelectContextValue = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  value: string;
  onValueChange: (next: string) => void;
  disabled: boolean;
  contentId: string;
  rootRef: React.RefObject<HTMLDivElement | null>;
};

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelectContext() {
  const ctx = React.useContext(SelectContext);
  if (!ctx) {
    throw new Error("Select components must be used inside Select.Root");
  }
  return ctx;
}

function Root({
  value,
  onValueChange,
  disabled = false,
  className,
  children,
}: React.PropsWithChildren<{
  value: string;
  onValueChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
}>) {
  const [open, setOpen] = React.useState(false);
  const contentId = React.useId();
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <SelectContext.Provider
      value={{
        open,
        setOpen,
        value,
        onValueChange,
        disabled,
        contentId,
        rootRef,
      }}
    >
      <div ref={rootRef} className={clsx("relative", className)}>
        {children}
      </div>
    </SelectContext.Provider>
  );
}

function Trigger({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ctx = useSelectContext();
  return (
    <button
      type="button"
      aria-haspopup="listbox"
      aria-expanded={ctx.open}
      aria-controls={ctx.contentId}
      disabled={ctx.disabled || props.disabled}
      onClick={(e) => {
        props.onClick?.(e);
        if (e.defaultPrevented) return;
        ctx.setOpen((prev) => !prev);
      }}
      className={clsx(
        baseClasses,
        "flex items-center justify-between gap-3 text-left cursor-pointer border-white/20 focus-visible:border-white/40 focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      <span
        aria-hidden
        className={clsx(
          "text-white/55 transition-transform",
          ctx.open && "rotate-180",
        )}
      >
        ▼
      </span>
    </button>
  );
}

function Value({
  children,
  className,
}: React.PropsWithChildren<{ className?: string }>) {
  return <span className={clsx("text-white/90", className)}>{children}</span>;
}

function Content({ className, children, ...props }: DivProps) {
  const ctx = useSelectContext();
  if (!ctx.open) {
    return null;
  }
  return (
    <div
      id={ctx.contentId}
      role="listbox"
      className={clsx(
        "absolute z-30 mt-2 w-full rounded-xl bg-[#22133f] p-1 ring-1 ring-white/15 shadow-[0_10px_30px_rgba(0,0,0,0.45)] max-h-56 overflow-auto",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function Option({
  value,
  className,
  children,
  onClick,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const ctx = useSelectContext();
  const selected = ctx.value === value;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={clsx(
        "w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition",
        selected
          ? "bg-[#3a256a] text-white ring-1 ring-white/15"
          : "text-white/80 hover:bg-white/8 hover:text-white",
        className,
      )}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        ctx.onValueChange(value);
        ctx.setOpen(false);
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export const Select = {
  Root,
  Trigger,
  Value,
  Content,
  Option,
} as const;
