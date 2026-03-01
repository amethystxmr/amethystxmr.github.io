import React from "react";
import { createPortal } from "react-dom";
import { useIsMobileView } from "./useIsMobileView";

export const APP_OVERLAY_ROOT_ATTRIBUTE = "data-app-overlay-root";
export const APP_OVERLAY_ROOT_SELECTOR = `[${APP_OVERLAY_ROOT_ATTRIBUTE}]`;

function useMounted() {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}

function useAppOverlayRoot(mounted: boolean) {
  const [root, setRoot] = React.useState<HTMLElement | null>(() => {
    if (typeof document === "undefined") {
      return null;
    }
    return document.querySelector<HTMLElement>(APP_OVERLAY_ROOT_SELECTOR);
  });

  React.useEffect(() => {
    if (!mounted) {
      return;
    }
    setRoot(document.querySelector<HTMLElement>(APP_OVERLAY_ROOT_SELECTOR));
  }, [mounted]);

  return root;
}

export function CenteredOverlayBackdrop({
  children,
  onBackdropClick,
}: React.PropsWithChildren<{ onBackdropClick?: () => void }>) {
  const mounted = useMounted();
  const appOverlayRoot = useAppOverlayRoot(mounted);
  const isMobileView = useIsMobileView();

  if (!mounted) {
    return null;
  }

  const portalRoot = isMobileView
    ? document.body
    : appOverlayRoot ?? document.body;
  const positionClass = !isMobileView && appOverlayRoot ? "absolute" : "fixed";

  return createPortal(
    <div
      className={`${positionClass} inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[1px]`}
      onClick={onBackdropClick}
    >
      {children}
    </div>,
    portalRoot,
  );
}

export function AppFullscreenOverlay({ children }: React.PropsWithChildren) {
  const mounted = useMounted();
  const appOverlayRoot = useAppOverlayRoot(mounted);
  const isMobileView = useIsMobileView();

  if (!mounted) {
    return null;
  }

  const portalRoot = isMobileView
    ? document.body
    : appOverlayRoot ?? document.body;
  const positionClass = !isMobileView && appOverlayRoot ? "absolute" : "fixed";
  const zIndexClass = isMobileView ? "z-[70]" : "z-[60]";

  return createPortal(
    <div className={`${positionClass} inset-0 ${zIndexClass}`}>{children}</div>,
    portalRoot,
  );
}

export function FullscreenOverlayPanel({ children }: React.PropsWithChildren) {
  return (
    <AppFullscreenOverlay>
      <div className="h-full w-full bg-black/60 backdrop-blur-[1px]">
        <div className="flex h-full w-full flex-col bg-[#211239] p-3 ring-1 ring-white/15 sm:p-4">
          {children}
        </div>
      </div>
    </AppFullscreenOverlay>
  );
}
