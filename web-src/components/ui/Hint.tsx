import React from "react";
import { createPortal } from "react-dom";

export function Hint({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const [tooltipStyle, setTooltipStyle] = React.useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [placeAbove, setPlaceAbove] = React.useState(false);
  const rootRef = React.useRef<HTMLSpanElement | null>(null);
  const tooltipRef = React.useRef<HTMLDivElement | null>(null);
  const tooltipId = React.useId();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root) {
        return;
      }
      const tooltip = tooltipRef.current;
      const target = event.target as Node | null;
      if (
        target &&
        !root.contains(target) &&
        !(tooltip && tooltip.contains(target))
      ) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const visible = open || hovered;
  const updateTooltipPosition = React.useCallback(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const rect = root.getBoundingClientRect();
    const horizontalPadding = 8;
    const maxWidth = Math.min(340, window.innerWidth - horizontalPadding * 2);
    const centeredLeft = rect.left + rect.width / 2;
    const clampedLeft = Math.max(
      horizontalPadding + maxWidth / 2,
      Math.min(centeredLeft, window.innerWidth - horizontalPadding - maxWidth / 2),
    );
    const estimatedTooltipHeight = 120;
    const shouldPlaceAbove =
      rect.bottom + 12 + estimatedTooltipHeight > window.innerHeight && rect.top > 160;
    setPlaceAbove(shouldPlaceAbove);
    setTooltipStyle({
      top: shouldPlaceAbove ? rect.top - 8 : rect.bottom + 8,
      left: clampedLeft,
      width: maxWidth,
    });
  }, []);

  React.useEffect(() => {
    if (!visible) {
      return;
    }
    updateTooltipPosition();
    const onViewportChange = () => updateTooltipPosition();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, { passive: true });
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange);
    };
  }, [updateTooltipPosition, visible]);

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

      {visible &&
        mounted &&
        tooltipStyle &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            className={`fixed z-[200] rounded-xl border border-white/20 bg-[#21113d]/95 px-3 py-2 text-xs leading-relaxed text-white/90 shadow-[0_14px_34px_rgba(0,0,0,0.45)] backdrop-blur-sm ${placeAbove ? "-translate-y-full" : ""}`}
            style={{
              top: tooltipStyle.top,
              left: tooltipStyle.left,
              width: tooltipStyle.width,
              transform: placeAbove ? "translate(-50%, -100%)" : "translateX(-50%)",
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  );
}
