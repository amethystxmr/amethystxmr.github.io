import React from "react";

export type DivProps = React.HTMLAttributes<HTMLDivElement>;

export type BaseProps = {
  error?: boolean;
  className?: string;
};
