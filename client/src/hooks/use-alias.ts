import { useState, useCallback, useEffect } from "react";
import { getMyPublicKeyBase64, initKeyPair } from "@/lib/crypto";

const STORAGE_KEY = "bcb-alias";

function randomHandle(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `User_${suffix}`;
}

async function serverClaimAlias(alias: string): Promise<"ok" | "taken" | "offline"> {
  try {
    const publicKey = getMyPublicKeyBase64() ?? await initKeyPair();
    const res = await fetch("/api/users/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias, publicKey }),
    });
    if (res.ok) return "ok";
    // 409 = taken by someone else; 400 = rejected (e.g. email alias)
    if (res.status === 409 || res.status === 400) return "taken";
    // 5xx or other unexpected → server issue, treat as offline so user can still operate
    return "offline";
  } catch {
    return "offline";
  }
}

export function useAlias() {
  const [alias, setAliasState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) || "";
  });
  const [isReady, setIsReady] = useState<boolean>(() => {
    return (localStorage.getItem(STORAGE_KEY) || "").trim().length >= 2;
  });

  useEffect(() => {
    let cancelled = false;

    async function assignAlias() {
      const stored = localStorage.getItem(STORAGE_KEY);

      if (stored && stored.trim().length >= 2) {
        const result = await serverClaimAlias(stored.trim());
        if (cancelled) return;

        if (result !== "taken") {
          // "ok" or "offline" — keep the stored alias
          setIsReady(true);
          return;
        }

        // Alias was taken by someone else — clear it and fall through to auto-assign
        localStorage.removeItem(STORAGE_KEY);
        setAliasState("");
      }

      // Auto-assign a fresh random handle
      for (let attempt = 0; attempt < 10; attempt++) {
        if (cancelled) return;
        const handle = randomHandle();
        const result = await serverClaimAlias(handle);
        if (cancelled) return;
        if (result === "ok" || result === "offline") {
          localStorage.setItem(STORAGE_KEY, handle);
          setAliasState(handle);
          setIsReady(true);
          return;
        }
      }
      // Last resort fallback (e.g. all 10 randoms were taken — extremely unlikely)
      const fallback = randomHandle();
      localStorage.setItem(STORAGE_KEY, fallback);
      setAliasState(fallback);
      setIsReady(true);
    }

    assignAlias();
    return () => { cancelled = true; };
  }, []);

  const claimAlias = useCallback(async (value: string): Promise<"ok" | "taken"> => {
    const trimmed = value.trim().slice(0, 254);
    const result = await serverClaimAlias(trimmed);
    if (result === "taken") return "taken";
    localStorage.setItem(STORAGE_KEY, trimmed);
    setAliasState(trimmed);
    return "ok";
  }, []);

  const setAlias = useCallback((value: string) => {
    const trimmed = value.trim().slice(0, 254);
    localStorage.setItem(STORAGE_KEY, trimmed);
    setAliasState(trimmed);
    serverClaimAlias(trimmed);
  }, []);

  const assignRandom = useCallback(() => {
    const handle = randomHandle();
    localStorage.setItem(STORAGE_KEY, handle);
    setAliasState(handle);
    serverClaimAlias(handle);
    return handle;
  }, []);

  return { alias, setAlias, claimAlias, assignRandom, isReady };
}
