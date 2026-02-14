import React from "react";
import { Button } from "./Button";
import { ButtonsHolder } from "./ButtonsHolder";
import { Input } from "./Input";
import { OverlayDialog } from "./OverlayDialog";

export function ConfirmByTextDialog({
  open,
  title,
  description,
  expectedText,
  confirmText = "Confirm",
  cancelText = "Cancel",
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  expectedText: string;
  confirmText?: string;
  cancelText?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [value, setValue] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setValue("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  const canConfirm = value.trim() === expectedText;

  return (
    <OverlayDialog onClose={() => !busy && onCancel()}>
      <div className="space-y-3">
        <div className="text-base font-semibold text-white">{title}</div>
        <div className="text-sm text-white/75">{description}</div>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={expectedText}
          autoComplete="off"
          disabled={busy}
        />
        <ButtonsHolder>
          <Button variant="soft" disabled={busy} onClick={onCancel}>
            {cancelText}
          </Button>
          <Button variant="primary" disabled={!canConfirm || busy} onClick={onConfirm}>
            {busy ? "Working..." : confirmText}
          </Button>
        </ButtonsHolder>
      </div>
    </OverlayDialog>
  );
}
