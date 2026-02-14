import React from "react";

export function ErrorMessage({ children }: React.PropsWithChildren) {
  return <div className="text-red-700 text-sm mt-1">{children}</div>;
}
