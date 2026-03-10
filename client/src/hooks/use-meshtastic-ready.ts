import { useState, useEffect } from "react";

export function useMeshtasticReady(): boolean {
  const [ready, setReady] = useState<boolean>(() => !!(window as any).meshtasticSend);

  useEffect(() => {
    const handler = (e: Event) => {
      setReady((e as CustomEvent<boolean>).detail);
    };
    window.addEventListener("meshtastic-ready", handler);
    return () => window.removeEventListener("meshtastic-ready", handler);
  }, []);

  return ready;
}
