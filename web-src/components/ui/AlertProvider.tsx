import React from "react";
import { AlertDialog } from "./AlertDialog";

type AlertRequest = {
  title?: string;
  message: string;
};

const AlertContext = React.createContext<((message: string, title?: string) => Promise<void>) | null>(
  null,
);

export function AlertProvider({ children }: React.PropsWithChildren) {
  const [queue, setQueue] = React.useState<Array<AlertRequest & { resolve: () => void }>>([]);

  const showAlert = React.useCallback((message: string, title?: string) => {
    return new Promise<void>((resolve) => {
      setQueue((prev) => [...prev, { message, title, resolve }]);
    });
  }, []);

  const current = queue[0] || null;
  const closeCurrent = React.useCallback(() => {
    setQueue((prev) => {
      const head = prev[0];
      if (head) {
        head.resolve();
      }
      return prev.slice(1);
    });
  }, []);

  return (
    <AlertContext.Provider value={showAlert}>
      {children}
      <AlertDialog
        open={!!current}
        title={current?.title}
        message={current?.message || ""}
        onClose={closeCurrent}
      />
    </AlertContext.Provider>
  );
}

export function useAlert() {
  const ctx = React.useContext(AlertContext);
  if (!ctx) {
    throw new Error("useAlert must be used inside AlertProvider");
  }
  return ctx;
}
