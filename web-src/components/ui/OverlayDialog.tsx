import React from "react";
import { CenteredOverlayBackdrop } from "./OverlayPrimitives";

export function OverlayDialog({
  children,
  onClose,
}: React.PropsWithChildren<{ onClose: () => void }>) {
  return (
    <CenteredOverlayBackdrop onBackdropClick={onClose}>
      <div
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-[#211239] p-4 ring-1 ring-white/15 shadow-[0_16px_40px_rgba(0,0,0,0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </CenteredOverlayBackdrop>
  );
}
