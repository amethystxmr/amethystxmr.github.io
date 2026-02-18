import React from "react";
import { Button } from "./Button";
import { ButtonsHolder } from "./ButtonsHolder";
import { OverlayDialog } from "./OverlayDialog";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "Yes",
  cancelText = "No",
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <OverlayDialog onClose={() => !busy && onCancel()}>
      <div className="space-y-3">
        <div className="text-base font-semibold text-white">{title}</div>
        <div className="text-sm text-white/75">{message}</div>
        <ButtonsHolder>
          <Button type="button" variant="soft" disabled={busy} onClick={onCancel}>
            {cancelText}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working..." : confirmText}
          </Button>
        </ButtonsHolder>
      </div>
    </OverlayDialog>
  );
}
