import React from "react";

export function Label({ children }: React.PropsWithChildren) {
  return (
    <div className="text-sm text-gray-300 mb-1 font-semibold">{children}</div>
  );
}
