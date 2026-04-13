import { getPublicKey, utils as secp256k1Utils } from "@noble/secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { z } from "zod";

const BCH_ADDR_CACHE_KEY = "bcb-bch-address";

// ── IndexedDB helpers (separate DB from crypto.ts to avoid version conflicts) ─

function openBchDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("bcb-bch", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("bch-keys")) db.createObjectStore("bch-keys");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeRaw(store: string, name: string, value: Uint8Array): Promise<void> {
  const db = await openBchDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadRaw(store: string, name: string): Promise<Uint8Array | null> {
  const db = await openBchDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(name);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function clearStore(store: string): Promise<void> {
  const db = await openBchDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Base58Check ───────────────────────────────────────────────────────────────

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [0];
  for (let bi = 0; bi < bytes.length; bi++) {
    let carry = bytes[bi];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let result = "";
  for (let bi = 0; bi < bytes.length; bi++) {
    if (bytes[bi] !== 0) break;
    result += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

function hash160(pubKey: Uint8Array): Uint8Array {
  return ripemd160(sha256(pubKey));
}

function publicKeyToLegacyAddress(pubKeyBytes: Uint8Array): string {
  const pubKeyHash = hash160(pubKeyBytes);

  // BCH mainnet P2PKH version byte = 0x00
  const payload = new Uint8Array(25);
  payload[0] = 0x00;
  payload.set(pubKeyHash, 1);

  // Checksum: SHA256(SHA256(version + hash))
  const check = sha256(sha256(payload.slice(0, 21)));
  payload.set(check.slice(0, 4), 21);

  return base58Encode(payload);
}

// ── Public API ────────────────────────────────────────────────────────────────

let _cachedAddress: string | null = null;

export async function getOrCreateBchAddress(): Promise<string> {
  // Return cached address first (localStorage used only for caching the address string)
  const stored = localStorage.getItem(BCH_ADDR_CACHE_KEY);
  if (stored) {
    _cachedAddress = stored;
    return stored;
  }

  // Load or generate secp256k1 private key from IndexedDB
  let privKey = await loadRaw("bch-keys", "bch-privkey");
  if (!privKey) {
    privKey = secp256k1Utils.randomSecretKey();
    await storeRaw("bch-keys", "bch-privkey", privKey);
  }

  // Derive compressed public key (secp256k1)
  const pubKey = getPublicKey(privKey as Uint8Array, true);

  // Derive legacy P2PKH address (compatible with all BCH wallets)
  const address = publicKeyToLegacyAddress(pubKey);

  // Cache address string in localStorage (not a secret)
  localStorage.setItem(BCH_ADDR_CACHE_KEY, address);
  _cachedAddress = address;
  return address;
}

export function getCachedBchAddress(): string | null {
  return _cachedAddress ?? localStorage.getItem(BCH_ADDR_CACHE_KEY);
}

export function storeBchAddressLocally(address: string): void {
  localStorage.setItem(BCH_ADDR_CACHE_KEY, address);
  _cachedAddress = address;
}

export async function clearBchAddress(): Promise<void> {
  localStorage.removeItem(BCH_ADDR_CACHE_KEY);
  _cachedAddress = null;
  try {
    await clearStore("bch-keys");
  } catch {
    // Ignore — key store may not exist yet
  }
}

export async function exportBchPrivKey(): Promise<string | null> {
  try {
    const raw = await loadRaw("bch-keys", "bch-privkey");
    if (!raw) return null;
    return Array.from(raw).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

export async function importBchPrivKey(hex: string): Promise<void> {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  await storeRaw("bch-keys", "bch-privkey", bytes);
  const pubKey = getPublicKey(bytes, true);
  const address = publicKeyToLegacyAddress(pubKey);
  localStorage.setItem(BCH_ADDR_CACHE_KEY, address);
  _cachedAddress = address;
}

// ── BCH Address Validation ────────────────────────────────────────────────────

const BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(str: string): Uint8Array | null {
  const bytes: number[] = [0];
  for (let i = 0; i < str.length; i++) {
    const ch = BASE58_CHARS.indexOf(str[i]);
    if (ch < 0) return null;
    let carry = ch;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Add leading zeros for each leading '1'
  for (let i = 0; i < str.length && str[i] === "1"; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

function verifyBase58CheckChecksum(decoded: Uint8Array): boolean {
  if (decoded.length < 5) return false;
  const payload = decoded.slice(0, decoded.length - 4);
  const checksum = decoded.slice(decoded.length - 4);
  const hash = sha256(sha256(payload));
  return hash[0] === checksum[0] && hash[1] === checksum[1] &&
         hash[2] === checksum[2] && hash[3] === checksum[3];
}

function validateLegacyBase58WithChecksum(address: string): boolean {
  if (!/^[13][1-9A-HJ-NP-Za-km-z]{24,33}$/.test(address)) return false;
  const decoded = base58Decode(address);
  if (!decoded || decoded.length < 25) return false;
  return verifyBase58CheckChecksum(decoded);
}

function isCashAddrPayload(str: string): boolean {
  return /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{26,45}$/.test(str);
}

export function validateBchAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower.startsWith("bitcoincash:")) {
    const bare = lower.slice(12).split("?")[0];
    return isCashAddrPayload(bare);
  }
  if (isCashAddrPayload(lower)) {
    return true;
  }
  return validateLegacyBase58WithChecksum(address);
}

export function extractAddressFromUri(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.startsWith("bitcoincash:")) {
    return uri.slice(12).split("?")[0];
  }
  return uri.split("?")[0].trim();
}


// ── BCH URI Format ────────────────────────────────────────────────────────────

export function formatBchUri(address: string, amountBCH?: number, memo?: string): string {
  const bare = address.replace(/^bitcoincash:/i, "");
  let uri = `bitcoincash:${bare}`;
  const params: string[] = [];
  if (amountBCH !== undefined && amountBCH > 0) {
    params.push(`amount=${amountBCH.toFixed(8).replace(/\.?0+$/, "")}`);
  }
  if (memo) {
    params.push(`message=${encodeURIComponent(memo)}`);
  }
  if (params.length > 0) {
    uri += `?${params.join("&")}`;
  }
  return uri;
}

// ── Multi-currency wallet ─────────────────────────────────────────────────────

export type PaymentCurrency = "bch" | "btc" | "lightning" | "liquid";

const CURRENCY_ADDR_KEYS: Record<PaymentCurrency, string> = {
  bch: "bcb-bch-address",
  btc: "bcb-btc-address",
  lightning: "bcb-lightning-address",
  liquid: "bcb-liquid-address",
};

const ACTIVE_CURRENCY_KEY = "bcb-payment-currency";

export function getActiveCurrency(): PaymentCurrency {
  const v = localStorage.getItem(ACTIVE_CURRENCY_KEY);
  if (v === "bch" || v === "btc" || v === "lightning" || v === "liquid") return v;
  return "bch";
}

export function setActiveCurrency(c: PaymentCurrency): void {
  localStorage.setItem(ACTIVE_CURRENCY_KEY, c);
}

export function getStoredAddress(currency: PaymentCurrency): string | null {
  if (currency === "bch") return getCachedBchAddress();
  return localStorage.getItem(CURRENCY_ADDR_KEYS[currency]);
}

export function storeAddress(currency: PaymentCurrency, address: string): void {
  if (currency === "bch") {
    storeBchAddressLocally(address);
  } else {
    localStorage.setItem(CURRENCY_ADDR_KEYS[currency], address);
  }
}

export function clearStoredAddress(currency: PaymentCurrency): void {
  localStorage.removeItem(CURRENCY_ADDR_KEYS[currency]);
}

export function getActivePaymentAddress(): string | null {
  return getStoredAddress(getActiveCurrency());
}

// ── Multi-currency address validation ─────────────────────────────────────────

export function validateBtcAddress(address: string): boolean {
  if (/^1[1-9A-HJ-NP-Za-km-z]{24,33}$/.test(address)) {
    const decoded = base58Decode(address);
    return !!(decoded && decoded.length >= 25 && verifyBase58CheckChecksum(decoded));
  }
  if (/^3[1-9A-HJ-NP-Za-km-z]{24,33}$/.test(address)) return true;
  if (/^bc1[02-9ac-hj-np-z]{6,87}$/i.test(address)) return true;
  return false;
}

export function validateLightningAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower.startsWith("lnbc") || lower.startsWith("lntb") || lower.startsWith("lnbcrt")) return address.length > 20;
  if (lower.startsWith("lno") || lower.startsWith("lni")) return address.length > 20;
  if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(address)) return true;
  return false;
}

/** Returns true for BOLT11/BOLT12 invoices, false for Lightning addresses (user@domain) */
export function isLightningInvoice(address: string): boolean {
  const lower = address.toLowerCase();
  return (
    lower.startsWith("lnbc") ||
    lower.startsWith("lntb") ||
    lower.startsWith("lnbcrt") ||
    lower.startsWith("lno") ||
    lower.startsWith("lni")
  );
}

export function validateLiquidAddress(address: string): boolean {
  if (address.length < 26 || address.length > 160) return false;
  // Blech32 confidential segwit (mainnet lq1, testnet ex1) — typically 90-160 chars
  if (/^(lq1|ex1)[a-z0-9]+$/i.test(address)) return true;
  // Base58 confidential P2PKH/P2SH (mainnet VJL/VT, testnet AzZ/XR)
  if (/^(VJL|VT|Az|XR)[1-9A-HJ-NP-Za-km-z]{30,80}$/.test(address)) return true;
  // Unconfidential P2PKH (starts Q on mainnet, G on testnet)
  if (/^[QG][1-9A-HJ-NP-Za-km-z]{25,50}$/.test(address)) return true;
  // Unconfidential P2SH (starts H or G on mainnet)
  if (/^[HGF][1-9A-HJ-NP-Za-km-z]{25,50}$/.test(address)) return true;
  return false;
}

export function validateAddress(currency: PaymentCurrency, address: string): boolean {
  switch (currency) {
    case "bch": return validateBchAddress(address);
    case "btc": return validateBtcAddress(address);
    case "lightning": return validateLightningAddress(address);
    case "liquid": return validateLiquidAddress(address);
  }
}

export function extractAddressForCurrency(currency: PaymentCurrency, raw: string): string {
  const trimmed = raw.trim();
  if (currency === "bch") return extractAddressFromUri(trimmed);
  if (currency === "btc") {
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("bitcoin:")) return trimmed.slice(8).split("?")[0];
  }
  if (currency === "lightning") {
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("lightning:")) return trimmed.slice(10).split("?")[0];
  }
  if (currency === "liquid") {
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("liquidnetwork:")) return trimmed.slice(14).split("?")[0];
  }
  return trimmed.split("?")[0];
}

// ── Multi-currency URI formatter ──────────────────────────────────────────────

export function formatPayUri(
  currency: PaymentCurrency,
  address: string,
  amount?: number,
  memo?: string,
  liquidAsset?: LiquidAsset,
): string {
  switch (currency) {
    case "bch":
      return formatBchUri(address, amount, memo);
    case "btc": {
      let uri = `bitcoin:${address}`;
      const p: string[] = [];
      if (amount && amount > 0) p.push(`amount=${amount.toFixed(8).replace(/\.?0+$/, "")}`);
      if (memo) p.push(`label=${encodeURIComponent(memo)}`);
      if (p.length) uri += `?${p.join("&")}`;
      return uri;
    }
    case "lightning": {
      // BOLT11/BOLT12 invoices already embed the amount — no params needed
      if (isLightningInvoice(address)) return `lightning:${address}`;
      // Lightning address (user@domain): append amount in msats if provided
      const p: string[] = [];
      if (amount && amount > 0) p.push(`amount=${Math.round(amount * 1000)}`);
      if (memo) p.push(`label=${encodeURIComponent(memo)}`);
      return p.length ? `lightning:${address}?${p.join("&")}` : `lightning:${address}`;
    }
    case "liquid": {
      let uri = `liquidnetwork:${address}`;
      const p: string[] = [];
      const la = liquidAsset ?? "lbtc";
      // Non-L-BTC assets require explicit assetid so the wallet knows which token
      if (la !== "lbtc") p.push(`assetid=${LIQUID_ASSET_IDS[la]}`);
      if (amount && amount > 0) p.push(`amount=${amount.toFixed(8).replace(/\.?0+$/, "")}`);
      if (memo) p.push(`message=${encodeURIComponent(memo)}`);
      if (p.length) uri += `?${p.join("&")}`;
      return uri;
    }
  }
}

export const CURRENCY_LABELS: Record<PaymentCurrency, string> = {
  bch: "BCH",
  btc: "BTC",
  lightning: "Lightning",
  liquid: "Liquid",
};

export const CURRENCY_AMOUNT_UNIT: Record<PaymentCurrency, string> = {
  bch: "BCH",
  btc: "BTC",
  lightning: "sats",
  liquid: "L-BTC",
};

// ── Liquid Network assets ─────────────────────────────────────────────────────

export type LiquidAsset = "lbtc" | "usdt" | "depix" | "eurx";

export const ALL_LIQUID_ASSETS: LiquidAsset[] = ["lbtc", "usdt", "depix", "eurx"];

export const LIQUID_ASSET_LABELS: Record<LiquidAsset, string> = {
  lbtc:  "L-BTC",
  usdt:  "USDt",
  depix: "DePix",
  eurx:  "EURx",
};

export const LIQUID_ASSET_UNITS: Record<LiquidAsset, string> = {
  lbtc:  "L-BTC",
  usdt:  "USDt",
  depix: "BRL",
  eurx:  "EUR",
};

// Liquid mainnet asset IDs — used in the liquidnetwork: URI ?assetid= param
export const LIQUID_ASSET_IDS: Record<LiquidAsset, string> = {
  lbtc:  "6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d",
  usdt:  "ce091c998b83c78bb71a632313ba3760f1763d9cfcffae02258ffa9865a37bd2",
  depix: "02f22f8d9c76ab41661a2729e4752e2c5d1a263012141b86ea98af5472df67c0",
  eurx:  "18729918ab4bca843656f08d4dd877bed6641fbd596ad07c678f2f6f3e224e1",
};

// ── BCH Payment Message Format ────────────────────────────────────────────────

export const BCH_PAY_PREFIX = "BCB-PAY:v1:";
export const BCH_PAY_SENT_PREFIX = "BCB-PAY-SENT:";

const BchPayRequestSchema = z.object({
  to: z.string().min(1),
  from: z.string().min(1),
  address: z.string().min(1),
  amountBCH: z.number().nonnegative(),
  memo: z.string(),
  requestId: z.string().min(1),
  currency: z.enum(["bch", "btc", "lightning", "liquid"]).optional().default("bch"),
  liquidAsset: z.enum(["lbtc", "usdt", "depix", "eurx"]).optional().default("lbtc"),
});

export type BchPayRequest = z.infer<typeof BchPayRequestSchema>;

export function formatBchPayMessage(payload: BchPayRequest): string {
  return `${BCH_PAY_PREFIX}${JSON.stringify(payload)}`;
}

export function parseBchPayMessage(content: string): BchPayRequest | null {
  if (!content.startsWith(BCH_PAY_PREFIX)) return null;
  try {
    const raw = JSON.parse(content.slice(BCH_PAY_PREFIX.length));
    const result = BchPayRequestSchema.safeParse(raw);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function formatBchPaySent(requestId: string): string {
  return `${BCH_PAY_SENT_PREFIX}${requestId}`;
}

export function parseBchPaySent(content: string): string | null {
  if (!content.startsWith(BCH_PAY_SENT_PREFIX)) return null;
  return content.slice(BCH_PAY_SENT_PREFIX.length);
}
