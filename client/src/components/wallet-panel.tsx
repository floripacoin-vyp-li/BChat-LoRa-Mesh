import { useState, useEffect } from "react";
import { X, Copy, Check, Wallet, ExternalLink, Loader2, ScanLine, Zap, Droplets, Bitcoin } from "lucide-react";
import { QRCodeDisplay } from "@/components/qr-code";
import { BchQrScanner } from "@/components/bch-qr-scanner";
import {
  getOrCreateBchAddress,
  getStoredAddress,
  storeAddress,
  validateAddress,
  extractAddressForCurrency,
  getActiveCurrency,
  setActiveCurrency,
  formatPayUri,
  type PaymentCurrency,
  CURRENCY_LABELS,
} from "@/lib/bch";
import { getMyPublicKeyBase64, initKeyPair } from "@/lib/crypto";
import { useToast } from "@/hooks/use-toast";

interface WalletPanelProps {
  myAlias: string;
  myPublicKeyBase64: string | null;
  onClose: () => void;
}

const CURRENCIES: PaymentCurrency[] = ["bch", "btc", "lightning", "liquid"];

const CURRENCY_COLORS: Record<PaymentCurrency, string> = {
  bch:       "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  btc:       "text-orange-400 bg-orange-400/10 border-orange-400/30",
  lightning: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  liquid:    "text-sky-400 bg-sky-400/10 border-sky-400/30",
};

const CURRENCY_ACTIVE_BORDER: Record<PaymentCurrency, string> = {
  bch:       "border-emerald-400/60 text-emerald-400",
  btc:       "border-orange-400/60 text-orange-400",
  lightning: "border-amber-400/60 text-amber-400",
  liquid:    "border-sky-400/60 text-sky-400",
};

function CurrencyIcon({ currency, size = 13 }: { currency: PaymentCurrency; size?: number }) {
  if (currency === "lightning") return <Zap size={size} />;
  if (currency === "liquid")    return <Droplets size={size} />;
  return <Bitcoin size={size} />;
}

function explorerUrl(currency: PaymentCurrency, address: string): string | null {
  if (!address) return null;
  switch (currency) {
    case "bch":    return `https://blockchair.com/bitcoin-cash/address/${address.replace(/^bitcoincash:/i, "")}`;
    case "btc":    return `https://blockchair.com/bitcoin/address/${address}`;
    case "liquid": return `https://blockchair.com/liquid/address/${address}`;
    default:       return null;
  }
}

function qrValue(currency: PaymentCurrency, address: string): string {
  return formatPayUri(currency, address);
}

function placeholderFor(currency: PaymentCurrency): string {
  switch (currency) {
    case "bch":       return "bitcoincash:qp3w… or 1A1z…";
    case "btc":       return "bc1q… or 1A1z… or 3J98…";
    case "lightning": return "lnbc… or user@domain.com";
    case "liquid":    return "VJL… or ex1…";
  }
}

export function WalletPanel({ myAlias, myPublicKeyBase64, onClose }: WalletPanelProps) {
  const [currency, setCurrency] = useState<PaymentCurrency>(getActiveCurrency());
  const [addresses, setAddresses] = useState<Record<PaymentCurrency, string | null>>({
    bch:       getStoredAddress("bch"),
    btc:       getStoredAddress("btc"),
    lightning: getStoredAddress("lightning"),
    liquid:    getStoredAddress("liquid"),
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [importMode, setImportMode] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const { toast } = useToast();

  const address = addresses[currency];

  useEffect(() => {
    setActiveCurrency(currency);
    setImportMode(false);
    setImportValue("");
    setImportError(null);
    setCopied(false);
  }, [currency]);

  useEffect(() => {
    if (currency === "bch" && !addresses.bch) {
      setIsGenerating(true);
      getOrCreateBchAddress()
        .then((addr) => {
          setAddresses((prev) => ({ ...prev, bch: addr }));
          syncBchToServer(addr);
        })
        .catch((e) => console.error("[BCH] Address generation failed:", e))
        .finally(() => setIsGenerating(false));
    }
  }, [currency]);

  const syncBchToServer = async (addr: string) => {
    const pubKey = myPublicKeyBase64 ?? getMyPublicKeyBase64() ?? (await initKeyPair().catch(() => null));
    if (!pubKey || !myAlias) return;
    setIsSyncing(true);
    try {
      await fetch("/api/users/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: myAlias, publicKey: pubKey, bchAddress: addr }),
      });
    } catch { /* ignore */ } finally {
      setIsSyncing(false);
    }
  };

  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleImport = () => {
    const raw = importValue.trim();
    if (!raw) { setImportError("Please enter an address"); return; }
    const extracted = extractAddressForCurrency(currency, raw);
    if (!validateAddress(currency, extracted)) {
      setImportError(`Invalid ${CURRENCY_LABELS[currency]} address format`);
      return;
    }
    storeAddress(currency, extracted);
    setAddresses((prev) => ({ ...prev, [currency]: extracted }));
    if (currency === "bch") syncBchToServer(extracted);
    setImportMode(false);
    setImportValue("");
    setImportError(null);
    toast({ title: `${CURRENCY_LABELS[currency]} address saved`, description: extracted.slice(0, 24) + "…" });
  };

  const handleScanned = (rawValue: string) => {
    setScanMode(false);
    const extracted = extractAddressForCurrency(currency, rawValue.trim());
    if (!validateAddress(currency, extracted)) {
      toast({ title: "Invalid QR code", description: `Not a valid ${CURRENCY_LABELS[currency]} address`, variant: "destructive" });
      return;
    }
    storeAddress(currency, extracted);
    setAddresses((prev) => ({ ...prev, [currency]: extracted }));
    if (currency === "bch") syncBchToServer(extracted);
    toast({ title: `${CURRENCY_LABELS[currency]} address scanned`, description: extracted.slice(0, 24) + "…" });
  };

  const explorer = address ? explorerUrl(currency, address) : null;

  return (
    <>
      {scanMode && (
        <BchQrScanner onScanned={handleScanned} onClose={() => setScanMode(false)} />
      )}
      <div className="absolute inset-0 z-20 glass-panel rounded-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Wallet size={16} className="text-primary" />
            <span className="text-sm font-mono font-semibold tracking-wide uppercase text-foreground">
              Wallet
            </span>
            {isSyncing && <Loader2 size={11} className="text-muted-foreground/40 animate-spin" />}
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-close-wallet"
          >
            <X size={16} />
          </button>
        </div>

        {/* Currency tabs */}
        <div className="flex gap-1 px-4 pt-3 pb-1">
          {CURRENCIES.map((c) => {
            const isActive = c === currency;
            const hasAddr = !!addresses[c];
            return (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-[10px] font-mono uppercase tracking-wider transition-colors ${
                  isActive
                    ? `${CURRENCY_ACTIVE_BORDER[c]} bg-white/5`
                    : "border-white/10 text-muted-foreground/50 hover:border-white/20 hover:text-muted-foreground"
                }`}
                data-testid={`tab-currency-${c}`}
              >
                <CurrencyIcon currency={c} size={11} />
                <span className="hidden sm:inline">{CURRENCY_LABELS[c]}</span>
                {hasAddr && (
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? CURRENCY_COLORS[c].split(" ")[0] : "bg-primary/40"}`} />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
          {/* Address display */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
              Your {CURRENCY_LABELS[currency]} Address
            </p>
            <div className="bg-background/50 border border-white/10 rounded-xl p-4 space-y-4">
              {isGenerating && currency === "bch" ? (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 size={24} className="text-primary/50 animate-spin" />
                  <p className="text-xs font-mono text-muted-foreground/40 animate-pulse">Generating address…</p>
                </div>
              ) : address ? (
                <>
                  <div className="flex flex-col items-center gap-3">
                    <QRCodeDisplay value={qrValue(currency, address)} size={170} />
                    <div
                      className="w-full font-mono text-[11px] text-foreground/80 break-all leading-relaxed bg-black/20 rounded-lg p-3 text-center"
                      data-testid={`text-${currency}-address`}
                    >
                      {address}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCopy}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-mono transition-colors ${CURRENCY_COLORS[currency]} border`}
                      data-testid={`button-copy-${currency}-address`}
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? "Copied!" : "Copy Address"}
                    </button>
                    {explorer && (
                      <a
                        href={explorer}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-2 bg-background/50 border border-white/10 hover:bg-primary/10 hover:border-primary/30 text-muted-foreground hover:text-primary rounded-lg text-xs font-mono transition-colors"
                        data-testid={`link-${currency}-explorer`}
                      >
                        <ExternalLink size={12} />
                        Explorer
                      </a>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs font-mono text-muted-foreground/40 text-center py-4">
                  No {CURRENCY_LABELS[currency]} address — paste or scan one below
                </p>
              )}
            </div>
          </div>

          {/* Import */}
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
              {address ? "Replace Address" : "Import Address"}
            </p>
            {importMode ? (
              <div className="bg-background/50 border border-white/10 rounded-xl p-3 space-y-2">
                <p className="text-[10px] font-mono text-muted-foreground/50">
                  Paste your {CURRENCY_LABELS[currency]} address
                </p>
                <textarea
                  autoFocus
                  value={importValue}
                  onChange={(e) => { setImportValue(e.target.value); setImportError(null); }}
                  placeholder={placeholderFor(currency)}
                  rows={2}
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 resize-none"
                  data-testid="input-import-address"
                />
                {importError && (
                  <p className="text-[10px] font-mono text-destructive" data-testid="text-import-error">
                    {importError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleImport}
                    disabled={!importValue.trim()}
                    className="flex-1 bg-primary/20 hover:bg-primary/30 text-primary text-xs font-mono py-1.5 rounded-lg transition-colors disabled:opacity-40"
                    data-testid="button-confirm-import"
                  >
                    Use This Address
                  </button>
                  <button
                    onClick={() => { setImportMode(false); setImportError(null); setImportValue(""); }}
                    className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors px-3"
                    data-testid="button-cancel-import"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setImportMode(true)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-background/50 border border-white/10 hover:bg-primary/10 hover:border-primary/30 text-muted-foreground hover:text-primary rounded-lg text-xs font-mono transition-colors"
                  data-testid="button-paste-address"
                >
                  Paste Address
                </button>
                <button
                  onClick={() => setScanMode(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-background/50 border border-white/10 hover:bg-primary/10 hover:border-primary/30 text-muted-foreground hover:text-primary rounded-lg text-xs font-mono transition-colors"
                  title="Scan QR code"
                  data-testid="button-scan-qr"
                >
                  <ScanLine size={12} />
                  Scan
                </button>
              </div>
            )}
          </div>

          {/* Note */}
          <div className="bg-yellow-400/5 border border-yellow-400/20 rounded-xl p-3">
            <p className="text-[10px] font-mono text-yellow-400/60 leading-relaxed">
              {currency === "bch"
                ? "BCH payments open your Android wallet app (Electron Cash, Bitcoin.com, Paytaca). Keys are never held by this app. Addresses shared via private chat are encrypted end-to-end."
                : currency === "btc"
                ? "BTC payments open a compatible wallet app. Only the address is stored — keys are never held by this app."
                : currency === "lightning"
                ? "Paste a BOLT11 invoice, BOLT12 offer, or a Lightning Address (user@domain). The recipient taps Pay Now to open their Lightning wallet."
                : "Liquid (L-BTC) payments open a compatible wallet app (e.g. Aqua, Green). Only the address is stored here."}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
