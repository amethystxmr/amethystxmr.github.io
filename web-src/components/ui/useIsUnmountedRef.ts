import React from "react";

export function useIsUnmountedRef(): React.MutableRefObject<boolean> {
  const isUnmountedRef = React.useRef(false);

  React.useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
    };
  }, []);

  return isUnmountedRef;
}
