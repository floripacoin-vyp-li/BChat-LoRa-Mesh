import { useState, useEffect, useCallback } from "react";

// Module-level flag — updated by the hook, readable anywhere without React context
export let serverReachable = navigator.onLine;

// Listeners that want to be notified when serverReachable changes
type ConnectivityListener = (reachable: boolean) => void;
const listeners = new Set<ConnectivityListener>();

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

function setReachable(value: boolean) {
  if (serverReachable !== value) {
    serverReachable = value;
    listeners.forEach((fn) => fn(value));
  }
}

// Call this from anywhere to immediately re-probe the server (e.g. after a failed fetch)
export async function recheckConnectivity(): Promise<void> {
  const reachable = await probeServer();
  setReachable(reachable);
}

export function useConnectivity(): boolean {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const check = useCallback(async () => {
    const reachable = await probeServer();
    setReachable(reachable);
    setIsOnline(reachable);
  }, []);

  useEffect(() => {
    // Subscribe to module-level changes so the hook state stays in sync
    const listener: ConnectivityListener = (reachable) => setIsOnline(reachable);
    listeners.add(listener);

    check();

    const handleOffline = () => { setReachable(false); setIsOnline(false); };
    const handleOnline = () => check();

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    const interval = setInterval(check, 15000);

    return () => {
      listeners.delete(listener);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      clearInterval(interval);
    };
  }, [check]);

  return isOnline;
}
