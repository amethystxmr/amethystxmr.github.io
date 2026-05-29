import React from "react";

export function ButtonsHolder({ children }: React.PropsWithChildren) {
  return (
    <div className="flex flex-row justify-center items-stretch gap-2">
      {children}
    </div>
  );
}
