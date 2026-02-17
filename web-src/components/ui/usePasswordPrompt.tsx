import React from "react";
import { PasswordPromptDialog } from "./PasswordPromptDialog";

type PasswordPromptRequest = {
  message: string;
  resolve: (password: string | null) => void;
};

export function usePasswordPrompt() {
  const [request, setRequest] = React.useState<PasswordPromptRequest | null>(
    null,
  );
  const requestRef = React.useRef<PasswordPromptRequest | null>(null);

  React.useEffect(() => {
    requestRef.current = request;
  }, [request]);

  React.useEffect(() => {
    return () => {
      if (requestRef.current) {
        requestRef.current.resolve(null);
        requestRef.current = null;
      }
    };
  }, []);

  const closePrompt = React.useCallback((password: string | null) => {
    setRequest((current) => {
      if (current) {
        current.resolve(password);
      }
      return null;
    });
  }, []);

  const promptForWalletPassword = React.useCallback(
    (message = "Enter wallet password") => {
      return new Promise<string | null>((resolve) => {
        setRequest({ message, resolve });
      });
    },
    [],
  );

  const passwordPromptDialog = (
    <PasswordPromptDialog
      open={request !== null}
      title="Wallet password"
      message={request?.message ?? ""}
      confirmText="Continue"
      onCancel={() => closePrompt(null)}
      onConfirm={(value) => closePrompt(value)}
    />
  );

  return { promptForWalletPassword, passwordPromptDialog };
}
