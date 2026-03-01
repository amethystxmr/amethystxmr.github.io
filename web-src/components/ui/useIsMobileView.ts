import React from "react";

const MOBILE_MEDIA_QUERY = "(max-width: 639px)";

export function useIsMobileView(): boolean {
  const [isMobileView, setIsMobileView] = React.useState(false);

  React.useEffect(() => {
    const media = window.matchMedia(MOBILE_MEDIA_QUERY);
    const onChange = () => {
      setIsMobileView(media.matches);
    };

    onChange();
    media.addEventListener("change", onChange);
    window.addEventListener("resize", onChange);
    window.visualViewport?.addEventListener("resize", onChange);
    return () => {
      media.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
      window.visualViewport?.removeEventListener("resize", onChange);
    };
  }, []);

  return isMobileView;
}
