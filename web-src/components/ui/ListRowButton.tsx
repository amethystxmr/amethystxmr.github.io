import { clsx } from "clsx";
import React from "react";

export function ListRowButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & React.PropsWithChildren) {
  return (
    <button
      className={clsx(
        "w-full flex items-center gap-2 px-4 py-3 my-2 rounded-xl border border-white/14 bg-white/8 text-white font-semibold cursor-pointer hover:bg-white/12",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
