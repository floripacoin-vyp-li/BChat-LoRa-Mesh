export const BCB_DM_PREFIX = "BCB-DM:";

// ── IndexedDB helpers ──────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("bcb-crypto", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keys");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeKey(name: string, key: CryptoKey): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readwrite");
    tx.objectStore("keys").put(key, name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadKey(name: string): Promise<CryptoKey | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readonly");
    const req = tx.objectStore("keys").get(name);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

// ── Key pair management ────────────────────────────────────────────────────────

let _publicKeyBase64: string | null = null;
let _privateKey: CryptoKey | null = null;

export async function initKeyPair(): Promise<string> {
  // Try to load existing keys
  const storedPrivate = await loadKey("ecdh-private");
  const storedPublic = await loadKey("ecdh-public");

  if (storedPrivate && storedPublic) {
    _privateKey = storedPrivate;
    const spki = await crypto.subtle.exportKey("spki", storedPublic);
    _publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
    return _publicKeyBase64;
  }

  // Generate new key pair
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );

  _privateKey = keyPair.privateKey;

  await storeKey("ecdh-private", keyPair.privateKey);
  await storeKey("ecdh-public", keyPair.publicKey);

  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  _publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
  return _publicKeyBase64;
}

export function getMyPublicKeyBase64(): string | null {
  return _publicKeyBase64;
}

export function getMyPrivateKey(): CryptoKey | null {
  return _privateKey;
}

// ── Contact key operations ─────────────────────────────────────────────────────

export async function importContactPublicKey(base64: string): Promise<CryptoKey> {
  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "spki",
    binary,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
}

export async function deriveSharedKey(
  myPrivateKey: CryptoKey,
  theirPublicKey: CryptoKey
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: theirPublicKey },
    myPrivateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ── Encrypt / Decrypt ──────────────────────────────────────────────────────────

export async function encrypt(sharedKey: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, encoded);

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decrypt(sharedKey: CryptoKey, base64payload: string): Promise<string | null> {
  try {
    const combined = Uint8Array.from(atob(base64payload), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, sharedKey, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

// ── DM message format ──────────────────────────────────────────────────────────

export function formatDmPayload(senderAlias: string, encrypted: string): string {
  return `${BCB_DM_PREFIX}${senderAlias}:${encrypted}`;
}

export function parseDmPayload(content: string): { senderAlias: string; encrypted: string } | null {
  if (!content.startsWith(BCB_DM_PREFIX)) return null;
  const rest = content.slice(BCB_DM_PREFIX.length);
  const colonIdx = rest.indexOf(":");
  if (colonIdx === -1) return null;
  return {
    senderAlias: rest.slice(0, colonIdx),
    encrypted: rest.slice(colonIdx + 1),
  };
}
