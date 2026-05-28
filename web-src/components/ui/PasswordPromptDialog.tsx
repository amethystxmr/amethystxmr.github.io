import React from "react";
import { Button } from "./Button";
import { ButtonsHolder } from "./ButtonsHolder";
import { Input } from "./Input";
import { OverlayDialog } from "./OverlayDialog";

export function PasswordPromptDialog({
  open,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
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
  onConfirm: (value: string) => void;
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

  return (
    <OverlayDialog onClose={() => !busy && onCancel()}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) {
            onConfirm(value);
          }
        }}
      >
        <div className="text-base font-semibold text-white">{title}</div>
        <div className="text-sm text-white/75">{message}</div>
        <Input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Wallet password"
          autoComplete="current-password"
          autoFocus
          disabled={busy}
        />
        <ButtonsHolder>
          <Button
            type="button"
            variant="soft"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelText}
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Working..." : confirmText}
          </Button>
        </ButtonsHolder>
      </form>
    </OverlayDialog>
  );
}
