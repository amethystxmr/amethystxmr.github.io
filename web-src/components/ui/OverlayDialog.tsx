import React from "react";

export function OverlayDialog({
  children,
  onClose,
}: React.PropsWithChildren<{ onClose: () => void }>) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#211239] p-4 ring-1 ring-white/15 shadow-[0_16px_40px_rgba(0,0,0,0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
