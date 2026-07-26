import { clsx } from "clsx";
import React from "react";
import { createPortal } from "react-dom";
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
  contentRef: React.RefObject<HTMLDivElement | null>;
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
  onOpenChange,
}: React.PropsWithChildren<{
  value: string;
  onValueChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  onOpenChange?: (open: boolean) => void;
}>) {
  const [open, setOpenState] = React.useState(false);
  const contentId = React.useId();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const onOpenChangeRef = React.useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const setOpen = React.useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >((update) => {
    setOpenState((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      if (next !== prev) {
        onOpenChangeRef.current?.(next);
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !contentRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, setOpen]);

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
        contentRef,
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

const DESKTOP_SCROLL_OPTION_THRESHOLD = 7;
/** Fits 7 Option rows (py-2 + text-sm) plus Content p-1 padding. */
const DESKTOP_SEVEN_ITEMS_MAX_HEIGHT_PX = Math.round(7 * 36 + 8);
const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

function Content({ className, children, ...props }: DivProps) {
  const ctx = useSelectContext();
  const optionCount = React.Children.count(children);
  const [contentStyle, setContentStyle] = React.useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number | null;
    placeAbove: boolean;
  } | null>(null);

  const updatePosition = React.useCallback(() => {
    const root = ctx.rootRef.current;
    if (!root) {
      return;
    }

    const rect = root.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 8;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const placeAbove = availableBelow < 180 && availableAbove > availableBelow;
    const availableSpace = placeAbove ? availableAbove : availableBelow;
    const isDesktop = window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
    const scrollOnDesktop =
      isDesktop && optionCount > DESKTOP_SCROLL_OPTION_THRESHOLD;
    const maxHeight = isDesktop
      ? scrollOnDesktop
        ? Math.max(
            120,
            Math.min(DESKTOP_SEVEN_ITEMS_MAX_HEIGHT_PX, availableSpace - gap),
          )
        : null
      : Math.max(120, Math.min(224, availableSpace - gap));

    setContentStyle({
      top: placeAbove ? rect.top - gap : rect.bottom + gap,
      left: rect.left,
      width: rect.width,
      maxHeight,
      placeAbove,
    });
  }, [ctx.rootRef, optionCount]);

  React.useLayoutEffect(() => {
    if (!ctx.open) {
      return;
    }

    updatePosition();
    const onViewportChange = () => updatePosition();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, {
      capture: true,
      passive: true,
    });
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, {
        capture: true,
      });
    };
  }, [ctx.open, updatePosition]);

  if (!ctx.open) {
    return null;
  }
  if (!contentStyle) {
    return null;
  }
  const shouldScroll = contentStyle.maxHeight !== null;
  return createPortal(
    <div
      ref={ctx.contentRef}
      id={ctx.contentId}
      role="listbox"
      className={clsx(
        "fixed z-[200] rounded-xl bg-[#22133f] p-1 ring-1 ring-white/15 shadow-[0_10px_30px_rgba(0,0,0,0.45)]",
        shouldScroll ? "overflow-auto lg:scrollbar-glass" : "overflow-visible",
        className,
      )}
      style={{
        top: contentStyle.top,
        left: contentStyle.left,
        width: contentStyle.width,
        maxHeight: contentStyle.maxHeight ?? undefined,
        transform: contentStyle.placeAbove ? "translateY(-100%)" : undefined,
      }}
      {...props}
    >
      {children}
    </div>,
    document.body,
  );
}

function Option({
  value,
  className,
  children,
  onClick,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const ctx = useSelectContext();
  const selected = ctx.value === value;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      className={clsx(
        "w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition",
        disabled
          ? "cursor-not-allowed text-white/35"
          : selected
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
