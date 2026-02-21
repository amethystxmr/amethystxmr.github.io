import React from "react";

export type AlertFn = (message: string, title?: string) => Promise<void>;

export const AlertContext = React.createContext<AlertFn | null>(null);
