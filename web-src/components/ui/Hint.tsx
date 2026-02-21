import React from "react";

export function Hint({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const rootRef = React.useRef<HTMLSpanElement | null>(null);
  const tooltipId = React.useId();

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) {
        return;
      }
      const target = event.target as Node | null;
      if (target && !root.contains(target)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const visible = open || hovered;

  return (
    <span
      ref={rootRef}
      className={`relative inline-flex ${className ?? ""}`.trim()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label="Show hint"
        aria-expanded={visible}
        aria-controls={tooltipId}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/35 bg-white/10 text-[11px] font-bold text-white/90 transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/70"
        onClick={() => setOpen((prev) => !prev)}
      >
        i
      </button>

      {visible && (
        <div
          id={tooltipId}
          role="tooltip"
          className="absolute left-1/2 top-[calc(100%+8px)] z-40 w-[min(320px,calc(100vw-32px))] -translate-x-1/2 rounded-xl border border-white/20 bg-[#21113d]/95 px-3 py-2 text-xs leading-relaxed text-white/90 shadow-[0_14px_34px_rgba(0,0,0,0.45)] backdrop-blur-sm"
        >
          {children}
        </div>
      )}
    </span>
  );
}
