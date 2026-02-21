import React from "react";
import { createPortal } from "react-dom";

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
  const [root, setRoot] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!mounted) {
      return;
    }

    const resolveRoot = () => {
      setRoot(document.querySelector<HTMLElement>(APP_OVERLAY_ROOT_SELECTOR));
    };

    resolveRoot();
    const id = window.setTimeout(resolveRoot, 0);
    return () => window.clearTimeout(id);
  }, [mounted]);

  return root;
}

export function CenteredOverlayBackdrop({
  children,
  onBackdropClick,
}: React.PropsWithChildren<{ onBackdropClick?: () => void }>) {
  const mounted = useMounted();
  const appOverlayRoot = useAppOverlayRoot(mounted);

  if (!mounted) {
    return null;
  }

  const desktopRoot = appOverlayRoot ?? document.body;
  const desktopPositionClass = appOverlayRoot ? "absolute" : "fixed";

  return (
    <>
      {createPortal(
        <div
          className={`${desktopPositionClass} inset-0 z-[70] hidden items-center justify-center bg-black/60 p-4 backdrop-blur-[1px] sm:flex`}
          onClick={onBackdropClick}
        >
          {children}
        </div>,
        desktopRoot,
      )}
      {createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[1px] sm:hidden"
          onClick={onBackdropClick}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}

export function AppFullscreenOverlay({ children }: React.PropsWithChildren) {
  const mounted = useMounted();
  const appOverlayRoot = useAppOverlayRoot(mounted);

  if (!mounted) {
    return null;
  }

  const desktopRoot = appOverlayRoot ?? document.body;
  const desktopPositionClass = appOverlayRoot ? "absolute" : "fixed";

  return (
    <>
      {createPortal(
        <div
          className={`${desktopPositionClass} inset-0 z-[60] hidden sm:block`}
        >
          {children}
        </div>,
        desktopRoot,
      )}
      {createPortal(
        <div className="fixed inset-0 z-[70] sm:hidden">{children}</div>,
        document.body,
      )}
    </>
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
