import { useState, useEffect, useRef, useCallback } from "react";
import {
  initKeyPair,
  importContactPublicKey,
  deriveSharedKey,
  getMyPrivateKey,
} from "@/lib/crypto";

export interface Contact {
  alias: string;
  publicKeyBase64: string;
}

const STORAGE_KEY = "bcb-contacts";

function loadContacts(): Contact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveContacts(contacts: Contact[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

export function useMyCryptoKey() {
  const [myPublicKeyBase64, setMyPublicKeyBase64] = useState<string | null>(null);

  useEffect(() => {
    initKeyPair()
      .then(setMyPublicKeyBase64)
      .catch((e) => console.error("[Crypto] Key init failed:", e));
  }, []);

  return { myPublicKeyBase64 };
}

export function useContacts() {
  const [contacts, setContacts] = useState<Contact[]>(loadContacts);
  const keyCache = useRef<Map<string, CryptoKey>>(new Map());

  const addContact = async (alias: string, publicKeyBase64: string): Promise<void> => {
    // Validate the key can be imported — throws if invalid
    await importContactPublicKey(publicKeyBase64);

    const trimmedAlias = alias.trim();
    if (!trimmedAlias) throw new Error("Alias cannot be empty");
    if (contacts.some((c) => c.alias === trimmedAlias)) {
      throw new Error(`Contact "${trimmedAlias}" already exists`);
    }

    const updated = [...contacts, { alias: trimmedAlias, publicKeyBase64 }];
    saveContacts(updated);
    setContacts(updated);
  };

  const removeContact = (alias: string) => {
    keyCache.current.delete(alias);
    const updated = contacts.filter((c) => c.alias !== alias);
    saveContacts(updated);
    setContacts(updated);
  };

  const getSharedKey = useCallback(async (alias: string): Promise<CryptoKey | null> => {
    if (keyCache.current.has(alias)) return keyCache.current.get(alias)!;

    const contact = contacts.find((c) => c.alias === alias);
    if (!contact) return null;

    const myPrivateKey = getMyPrivateKey();
    if (!myPrivateKey) return null;

    try {
      const theirPublicKey = await importContactPublicKey(contact.publicKeyBase64);
      const sharedKey = await deriveSharedKey(myPrivateKey, theirPublicKey);
      keyCache.current.set(alias, sharedKey);
      return sharedKey;
    } catch (e) {
      console.error("[Crypto] Failed to derive shared key for", alias, e);
      return null;
    }
  }, [contacts]);

  return { contacts, addContact, removeContact, getSharedKey };
}
