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
    if (res.status === 409) return "taken";
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
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored && stored.trim().length >= 2) {
      serverClaimAlias(stored.trim());
      setIsReady(true);
      return;
    }

    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        if (cancelled) return;
        const handle = randomHandle();
        const result = await serverClaimAlias(handle);
        if (cancelled) return;
        if (result === "ok") {
          localStorage.setItem(STORAGE_KEY, handle);
          setAliasState(handle);
          setIsReady(true);
          return;
        }
        if (result === "offline") {
          localStorage.setItem(STORAGE_KEY, handle);
          setAliasState(handle);
          setIsReady(true);
          return;
        }
      }
      const fallback = randomHandle();
      localStorage.setItem(STORAGE_KEY, fallback);
      setAliasState(fallback);
      setIsReady(true);
    })();

    return () => { cancelled = true; };
  }, []);

  const claimAlias = useCallback(async (value: string): Promise<"ok" | "taken"> => {
    const trimmed = value.trim().slice(0, 24);
    const result = await serverClaimAlias(trimmed);
    if (result === "taken") return "taken";
    localStorage.setItem(STORAGE_KEY, trimmed);
    setAliasState(trimmed);
    return "ok";
  }, []);

  const setAlias = useCallback((value: string) => {
    const trimmed = value.trim().slice(0, 24);
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
