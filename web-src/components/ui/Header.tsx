import React from "react";

export function Header({ children }: React.PropsWithChildren) {
  return <h1 className="text-glow mt-2 mb-4 text-center text-3xl font-bold">{children}</h1>;
}
