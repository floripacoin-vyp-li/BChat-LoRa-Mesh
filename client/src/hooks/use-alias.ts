import { useState, useCallback } from "react";

const STORAGE_KEY = "bcb-alias";

function randomHandle(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `User_${suffix}`;
}

export function useAlias() {
  const [alias, setAliasState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) || "";
  });

  const isSet = alias.trim().length > 0;

  const setAlias = useCallback((value: string) => {
    const trimmed = value.trim().slice(0, 24);
    localStorage.setItem(STORAGE_KEY, trimmed);
    setAliasState(trimmed);
  }, []);

  const assignRandom = useCallback(() => {
    const handle = randomHandle();
    localStorage.setItem(STORAGE_KEY, handle);
    setAliasState(handle);
    return handle;
  }, []);

  return { alias, setAlias, assignRandom, isSet };
}
