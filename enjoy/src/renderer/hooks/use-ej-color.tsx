import { useEffect, useState } from "react";

/**
 * Resolves an `--ej-*` design token to a concrete color string.
 *
 * Canvas based renderers (wavesurfer, audio visualizers, chart.js) cannot
 * consume CSS variables, so they need the computed value. The token is read
 * again whenever the theme class on <html> flips.
 */
export const useEjColor = (token: string, fallback: string) => {
  const [color, setColor] = useState<string>(fallback);

  useEffect(() => {
    const read = () => {
      const value = getComputedStyle(document.documentElement)
        .getPropertyValue(token)
        .trim();
      if (value) setColor(value);
    };
    read();

    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [token]);

  return color;
};
