import { useState, useEffect, useCallback } from "react";

// Module-level flag — updated by the hook, readable anywhere without React context
export let serverReachable = navigator.onLine;

async function probeServer(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("/api/health", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export function useConnectivity(): boolean {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const check = useCallback(async () => {
    const reachable = await probeServer();
    serverReachable = reachable;
    setIsOnline(reachable);
  }, []);

  useEffect(() => {
    check();

    const handleOffline = () => { serverReachable = false; setIsOnline(false); };
    const handleOnline = () => check();

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    const interval = setInterval(check, 15000);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      clearInterval(interval);
    };
  }, [check]);

  return isOnline;
}
