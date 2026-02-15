import React from "react";
import { Button } from "./Button";
import { OverlayDialog } from "./OverlayDialog";

export function AlertDialog({
  open,
  title = "Notice",
  message,
  onClose,
}: {
  open: boolean;
  title?: string;
  message: string;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }
  return (
    <OverlayDialog onClose={onClose}>
      <div className="space-y-3">
        <div className="text-base font-semibold text-white">{title}</div>
        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-white/5 p-2 text-sm text-white/75">
          {message}
        </div>
        <Button variant="soft" className="w-full" onClick={onClose}>
          OK
        </Button>
      </div>
    </OverlayDialog>
  );
}
