import { useState, useEffect } from "react";

export function useScreenshotGuard() {
  const [obscured, setObscured] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const show = () => {
      setObscured(true);
      clearTimeout(timer);
      timer = setTimeout(() => setObscured(false), 2000);
    };

    // Desktop: intercept PrintScreen / Snapshot key
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "PrintScreen" ||
        e.code === "PrintScreen" ||
        // macOS screenshot shortcuts
        (e.metaKey && e.shiftKey && (e.key === "3" || e.key === "4" || e.key === "5"))
      ) {
        e.preventDefault();
        show();
        // Attempt to overwrite clipboard with a blank image (best-effort, requires permission)
        try {
          navigator.clipboard.writeText("").catch(() => {});
        } catch {}
      }
    };

    // Some browsers fire a visibilitychange when OS screenshot tools activate
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") show();
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return { obscured };
}
