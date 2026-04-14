import { useState, useRef } from "react";
import { X, Trash2, MessageSquareLock, ChevronRight, QrCode, ScanLine, KeyRound, Search, Loader2, Wallet, Download, Upload, ShieldAlert, CheckCircle2, BadgeCheck, Star, Mail, Zap, Copy, Check } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QRCodeDisplay } from "@/components/qr-code";
import { QRScanner, buildQRKeyPayload, type ScannedKey } from "@/components/qr-scanner";
import type { Contact } from "@/hooks/use-contacts";
import { exportKeyPair, importKeyPairFromBackup } from "@/lib/crypto";
import { exportBchPrivKey, importBchPrivKey } from "@/lib/bch";
import { apiRequest } from "@/lib/queryClient";

interface ContactsPanelProps {
  contacts: Contact[];
  myPublicKeyBase64: string | null;
  myAlias: string;
  unreadCounts: Record<string, number>;
  onAddContact: (alias: string, publicKeyBase64: string) => Promise<void>;
  onRemoveContact: (alias: string) => void;
  onOpenChat: (contactAlias: string) => void;
  onOpenWallet: () => void;
  onClose: () => void;
}

type AddMode = "idle" | "scanning" | "confirm" | "paste" | "lookup" | "lookup-confirm";

export function ContactsPanel({
  contacts,
  myPublicKeyBase64,
  myAlias,
  unreadCounts,
  onAddContact,
  onRemoveContact,
  onOpenChat,
  onOpenWallet,
  onClose,
}: ContactsPanelProps) {
  const [showMyQR, setShowMyQR] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("idle");
  const [scannedAlias, setScannedAlias] = useState("");
  const [scannedKey, setScannedKey] = useState("");
  const [pasteAlias, setPasteAlias] = useState("");
  const [pasteKey, setPasteKey] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const [lookupAlias, setLookupAlias] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<{ alias: string; publicKey: string } | null>(null);
  const [isLooking, setIsLooking] = useState(false);

  type BackupState = "idle" | "busy" | "success" | "error";
  const [backupState, setBackupState] = useState<BackupState>("idle");
  const [backupError, setBackupError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Premium ────────────────────────────────────────────────────────────────
  const qc = useQueryClient();
  // step: "form" → enter email + optional note; "verify" → enter OTP; "done" → success
  type PremiumStep = "form" | "verify";
  const [premiumStep, setPremiumStep] = useState<PremiumStep>("form");
  const [premiumEmail, setPremiumEmail] = useState("");
  const [premiumNote, setPremiumNote] = useState("");
  const [premiumProof, setPremiumProof] = useState("");
  const [premiumCode, setPremiumCode] = useState("");
  const [premiumFormError, setPremiumFormError] = useState<string | null>(null);
  const [premiumSubmitted, setPremiumSubmitted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paymentTab, setPaymentTab] = useState<"lightning" | "bch" | "btc" | "liquid">("lightning");

  const { data: premiumStatus } = useQuery<{ isPremium: boolean; email?: string; expiresAt?: string }>({
    queryKey: ["/api/premium/status", myAlias],
    queryFn: () => fetch(`/api/premium/status/${encodeURIComponent(myAlias)}`).then((r) => r.json()),
    enabled: !!myAlias,
    staleTime: 60_000,
  });

  const { data: prices } = useQuery<{ bch: number; btc: number; eurPerUsd: number; brlPerUsd: number }>({
    queryKey: ["/api/prices"],
    staleTime: 60_000,
  });

  const { data: paymentCfg } = useQuery<{ lightningAddress: string; bchAddress: string; btcAddress: string; liquidAddress: string }>({
    queryKey: ["/api/config/payment"],
    staleTime: 300_000,
  });

  const isPremium = premiumStatus?.isPremium === true;

  // $10 USD quotations per method
  const requiredSats = prices?.btc
    ? Math.round((10 / prices.btc) * 100_000_000 / 100) * 100
    : null;
  const requiredMsats = requiredSats ? requiredSats * 1000 : null;

  // Liquid stablecoin equivalents for $10 (USDt fixed, EURx/DePix from forex)
  const liquidEurx  = prices?.eurPerUsd ? `${(10 * prices.eurPerUsd).toFixed(2)} EURx`  : null;
  const liquidDepix = prices?.brlPerUsd ? `${(10 * prices.brlPerUsd).toFixed(2)} DePix` : null;

  const liquidAmountStr = prices?.btc
    ? [
        `${(10 / prices.btc).toFixed(6)} L-BTC`,
        "10.00 USDt",
        prices.eurPerUsd  ? `${(10 * prices.eurPerUsd).toFixed(2)} EURx`  : null,
        prices.brlPerUsd  ? `${(10 * prices.brlPerUsd).toFixed(2)} DePix` : null,
      ].filter(Boolean).join(" | ")
    : null;

  const quotations: Record<string, string | null> = {
    lightning: requiredSats ? `${requiredSats.toLocaleString()} sats` : null,
    btc:       prices?.btc  ? `${(10 / prices.btc).toFixed(6)} BTC`  : null,
    bch:       prices?.bch  ? `${(10 / prices.bch).toFixed(4)} BCH`  : null,
    liquid:    prices?.btc  ? `${(10 / prices.btc).toFixed(6)} L-BTC` : null,
  };

  const lightningAddress = paymentCfg?.lightningAddress ?? "";
  const lightningUri = lightningAddress
    ? (requiredMsats ? `lightning:${lightningAddress}?amount=${requiredMsats}` : `lightning:${lightningAddress}`)
    : "";

  // Payment methods available (non-empty)
  type PayTab = "lightning" | "bch" | "btc" | "liquid";
  const paymentMethods: { key: PayTab; label: string; address: string; qrValue: string; placeholder: string }[] = [
    { key: "lightning", label: "Lightning", address: lightningAddress, qrValue: lightningUri || lightningAddress, placeholder: "No Lightning address set" },
    { key: "bch",       label: "BCH",       address: paymentCfg?.bchAddress ?? "",   qrValue: paymentCfg?.bchAddress ?? "",   placeholder: "No BCH address set" },
    { key: "btc",       label: "BTC",       address: paymentCfg?.btcAddress ?? "",   qrValue: paymentCfg?.btcAddress ?? "",   placeholder: "No BTC address set" },
    { key: "liquid",    label: "Liquid",    address: paymentCfg?.liquidAddress ?? "", qrValue: paymentCfg?.liquidAddress ?? "", placeholder: "No Liquid address set" },
  ].filter((m) => m.address);

  // Step 1: send verification code to email
  const sendCodeMutation = useMutation({
    mutationFn: (email: string) => apiRequest("POST", "/api/premium/send-code", { email }),
    onSuccess: () => {
      setPremiumStep("verify");
      setPremiumFormError(null);
    },
    onError: async (err: any) => {
      const msg = await err?.response?.json?.().catch(() => null);
      setPremiumFormError(msg?.message ?? "Failed to send code. Check your email and try again.");
    },
  });

  // Step 2: verify code + submit premium request (pending approval)
  const claimMutation = useMutation({
    mutationFn: (data: { alias: string; email: string; code: string; paymentMethod?: string; paymentAmount?: string; paymentNote?: string; paymentProof?: string }) =>
      apiRequest("POST", "/api/premium/claim", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/premium/status", myAlias] });
      setPremiumEmail("");
      setPremiumNote("");
      setPremiumProof("");
      setPremiumCode("");
      setPremiumStep("form");
      setPremiumFormError(null);
      setPremiumSubmitted(true);
    },
    onError: async (err: any) => {
      const msg = await err?.response?.json?.().catch(() => null);
      setPremiumFormError(msg?.message ?? "Invalid or expired code. Please try again.");
    },
  });


  const handleSendCode = () => {
    if (!premiumEmail.includes("@")) {
      setPremiumFormError("Please enter a valid email address.");
      return;
    }
    setPremiumFormError(null);
    sendCodeMutation.mutate(premiumEmail);
  };

  const handleVerifyCode = () => {
    if (premiumCode.length !== 6) {
      setPremiumFormError("Enter the 6-digit code from your email.");
      return;
    }
    setPremiumFormError(null);
    const activeMethod = (paymentMethods.find((m) => m.key === paymentTab) ?? paymentMethods[0])?.key;
    const activeQuote = activeMethod === "liquid"
      ? (liquidAmountStr ?? quotations["liquid"] ?? undefined)
      : (activeMethod ? (quotations[activeMethod] ?? undefined) : undefined);
    claimMutation.mutate({ alias: myAlias, email: premiumEmail, code: premiumCode, paymentMethod: activeMethod, paymentAmount: activeQuote, paymentNote: premiumNote || undefined, paymentProof: premiumProof || undefined });
  };

  const handleDownloadBackup = async () => {
    setBackupState("busy");
    setBackupError(null);
    try {
      const keyPair = await exportKeyPair();
      const bchPrivKey = await exportBchPrivKey();
      const alias = localStorage.getItem("bcb-alias") ?? "";
      const backup = {
        bcbVersion: 1,
        alias,
        addresses: {
          bch:       localStorage.getItem("bcb-bch-address")       ?? "",
          btc:       localStorage.getItem("bcb-btc-address")       ?? "",
          lightning: localStorage.getItem("bcb-lightning-address") ?? "",
          liquid:    localStorage.getItem("bcb-liquid-address")    ?? "",
        },
        activeCurrency: localStorage.getItem("bcb-payment-currency") ?? "bch",
        contacts: JSON.parse(localStorage.getItem("bcb-contacts") ?? "[]"),
        keyPair,
        bchPrivKey,
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `bcb-backup-${alias || "wallet"}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupState("idle");
    } catch {
      setBackupState("error");
      setBackupError("Failed to export wallet. Try again.");
    }
  };

  const handleRestoreFile = async (file: File) => {
    setBackupState("busy");
    setBackupError(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.bcbVersion || data.bcbVersion !== 1) throw new Error("Invalid backup file.");
      if (data.alias)                          localStorage.setItem("bcb-alias",            data.alias);
      if (data.addresses?.bch)                 localStorage.setItem("bcb-bch-address",       data.addresses.bch);
      if (data.addresses?.btc)                 localStorage.setItem("bcb-btc-address",       data.addresses.btc);
      if (data.addresses?.lightning)           localStorage.setItem("bcb-lightning-address", data.addresses.lightning);
      if (data.addresses?.liquid)              localStorage.setItem("bcb-liquid-address",    data.addresses.liquid);
      if (data.activeCurrency)                 localStorage.setItem("bcb-payment-currency",  data.activeCurrency);
      if (Array.isArray(data.contacts))        localStorage.setItem("bcb-contacts",          JSON.stringify(data.contacts));
      if (data.keyPair?.privateKey && data.keyPair?.publicKey) {
        await importKeyPairFromBackup(data.keyPair.privateKey, data.keyPair.publicKey);
      }
      if (data.bchPrivKey && typeof data.bchPrivKey === "string") {
        await importBchPrivKey(data.bchPrivKey);
      }
      setBackupState("success");
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setBackupState("error");
      setBackupError(e instanceof Error ? e.message : "Failed to restore backup.");
    }
  };

  const myQRPayload =
    myPublicKeyBase64 ? buildQRKeyPayload(myAlias, myPublicKeyBase64) : null;

  const handleScanned = (result: ScannedKey) => {
    setScannedAlias(result.alias);
    setScannedKey(result.publicKeyBase64);
    setAddError(null);
    setAddMode("confirm");
  };

  const handleConfirmScanned = async () => {
    setAddError(null);
    setIsAdding(true);
    try {
      await onAddContact(scannedAlias.trim(), scannedKey.trim());
      setAddMode("idle");
      setScannedAlias("");
      setScannedKey("");
    } catch (e: any) {
      setAddError(e.message ?? "Invalid key");
    } finally {
      setIsAdding(false);
    }
  };

  const handlePasteAdd = async () => {
    setAddError(null);
    setIsAdding(true);
    try {
      await onAddContact(pasteAlias.trim(), pasteKey.trim());
      setAddMode("idle");
      setPasteAlias("");
      setPasteKey("");
    } catch (e: any) {
      setAddError(e.message ?? "Invalid key");
    } finally {
      setIsAdding(false);
    }
  };

  const handleLookup = async () => {
    const alias = lookupAlias.trim();
    if (!alias) return;
    setLookupError(null);
    setIsLooking(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(alias)}`);
      if (res.status === 404) {
        setLookupError("Alias not found. They need to open the app first.");
        setIsLooking(false);
        return;
      }
      if (!res.ok) {
        setLookupError("Server error. Please try again.");
        setIsLooking(false);
        return;
      }
      const data = await res.json();
      setLookupResult({ alias: data.alias, publicKey: data.publicKey });
      setAddMode("lookup-confirm");
    } catch {
      setLookupError("Could not reach server.");
    } finally {
      setIsLooking(false);
    }
  };

  const handleConfirmLookup = async () => {
    if (!lookupResult) return;
    setAddError(null);
    setIsAdding(true);
    try {
      await onAddContact(lookupResult.alias, lookupResult.publicKey);
      cancelAdd();
    } catch (e: any) {
      setAddError(e.message ?? "Could not add contact");
    } finally {
      setIsAdding(false);
    }
  };

  const cancelAdd = () => {
    setAddMode("idle");
    setAddError(null);
    setScannedAlias("");
    setScannedKey("");
    setPasteAlias("");
    setPasteKey("");
    setLookupAlias("");
    setLookupError(null);
    setLookupResult(null);
  };

  const truncateKey = (key: string) =>
    key.length > 24 ? `${key.slice(0, 12)}…${key.slice(-8)}` : key;

  return (
    <>
      {addMode === "scanning" && (
        <QRScanner
          onScanned={handleScanned}
          onClose={() => setAddMode("idle")}
        />
      )}

      <div className="absolute inset-0 z-20 glass-panel rounded-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <MessageSquareLock size={16} className="text-primary" />
            <span className="text-sm font-mono font-semibold tracking-wide uppercase text-foreground">
              Secure Contacts
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenWallet}
              className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/50 hover:text-primary transition-colors uppercase tracking-wide px-2 py-1 rounded-lg hover:bg-primary/10"
              title="BCH Wallet"
              data-testid="button-open-wallet"
            >
              <Wallet size={12} />
              Wallet
            </button>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-close-contacts"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-5">
          {/* My Identity / QR Code */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
                Your Identity
              </p>
              <button
                onClick={() => setShowMyQR((v) => !v)}
                className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/50 hover:text-primary transition-colors uppercase tracking-wide"
                data-testid="button-toggle-qr-view"
              >
                {showMyQR ? <KeyRound size={10} /> : <QrCode size={10} />}
                {showMyQR ? "Show key" : "Show QR"}
              </button>
            </div>

            <div className="bg-background/50 border border-white/10 rounded-xl p-3">
              {!myQRPayload ? (
                <p className="text-xs text-muted-foreground/40 font-mono animate-pulse py-2">
                  Generating key pair…
                </p>
              ) : showMyQR ? (
                <div className="flex flex-col items-center gap-2 py-1">
                  <QRCodeDisplay value={myQRPayload} size={180} />
                  <p className="text-[10px] font-mono text-muted-foreground/40 text-center leading-relaxed">
                    Let the other user scan this QR code<br />to add you as a contact
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-muted-foreground/50">
                    Your public key — share only with people you trust
                  </p>
                  <div className="font-mono text-[10px] text-muted-foreground/60 break-all leading-relaxed bg-black/20 rounded-lg p-2 max-h-20 overflow-y-auto">
                    {myPublicKeyBase64}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Contacts */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
                Contacts ({contacts.length})
              </p>
              {addMode === "idle" && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setAddMode("lookup"); setLookupError(null); }}
                    className="flex items-center gap-1 text-[10px] font-mono text-primary hover:text-primary/80 transition-colors uppercase tracking-wide"
                    data-testid="button-find-alias"
                  >
                    <Search size={11} />
                    Find
                  </button>
                  <span className="text-muted-foreground/20 text-[10px]">|</span>
                  <button
                    onClick={() => setAddMode("scanning")}
                    className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/50 hover:text-primary transition-colors uppercase tracking-wide"
                    data-testid="button-scan-qr"
                  >
                    <ScanLine size={11} />
                    Scan
                  </button>
                  <span className="text-muted-foreground/20 text-[10px]">|</span>
                  <button
                    onClick={() => setAddMode("paste")}
                    className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground/50 hover:text-primary transition-colors uppercase tracking-wide"
                    data-testid="button-paste-key"
                  >
                    <KeyRound size={11} />
                    Paste
                  </button>
                </div>
              )}
            </div>

            {/* Find by alias */}
            {addMode === "lookup" && (
              <div className="bg-background/50 border border-white/10 rounded-xl p-3 mb-3 space-y-2">
                <p className="text-[10px] font-mono text-primary/70 uppercase tracking-wide">
                  Find contact by alias
                </p>
                <div className="flex gap-2">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Their alias..."
                    value={lookupAlias}
                    onChange={(e) => { setLookupAlias(e.target.value); setLookupError(null); }}
                    onKeyDown={(e) => e.key === "Enter" && !isLooking && handleLookup()}
                    maxLength={254}
                    className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40"
                    data-testid="input-lookup-alias"
                  />
                  <button
                    onClick={handleLookup}
                    disabled={isLooking || !lookupAlias.trim()}
                    className="px-3 py-2 bg-primary/20 hover:bg-primary/30 text-primary rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1.5 text-xs font-mono"
                    data-testid="button-lookup-search"
                  >
                    {isLooking ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                    {isLooking ? "" : "Search"}
                  </button>
                </div>
                {lookupError && (
                  <p className="text-[10px] font-mono text-destructive" data-testid="text-lookup-error">{lookupError}</p>
                )}
                <button
                  onClick={cancelAdd}
                  className="text-xs font-mono text-muted-foreground/50 hover:text-foreground transition-colors"
                  data-testid="button-cancel-lookup"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Lookup confirm */}
            {addMode === "lookup-confirm" && lookupResult && (
              <div className="bg-background/50 border border-primary/30 rounded-xl p-3 mb-3 space-y-2">
                <p className="text-[10px] font-mono text-primary/70 uppercase tracking-wide">
                  Found — confirm to add
                </p>
                <div className="bg-black/20 rounded-lg px-3 py-2 space-y-1">
                  <p className="text-sm font-mono text-foreground font-medium">{lookupResult.alias}</p>
                  <p className="text-[10px] font-mono text-muted-foreground/40 break-all">{truncateKey(lookupResult.publicKey)}</p>
                </div>
                {addError && (
                  <p className="text-[10px] font-mono text-destructive">{addError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleConfirmLookup}
                    disabled={isAdding}
                    className="flex-1 bg-primary/20 hover:bg-primary/30 text-primary text-xs font-mono py-1.5 rounded-lg transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
                    data-testid="button-confirm-lookup"
                  >
                    {isAdding && <Loader2 size={12} className="animate-spin" />}
                    {isAdding ? "Adding…" : "Add Contact"}
                  </button>
                  <button
                    onClick={cancelAdd}
                    className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors px-3"
                    data-testid="button-cancel-lookup-confirm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Confirm scanned contact */}
            {addMode === "confirm" && (
              <div className="bg-background/50 border border-primary/30 rounded-xl p-3 mb-3 space-y-2">
                <p className="text-[10px] font-mono text-primary/70 uppercase tracking-wide">
                  Contact scanned — confirm to add
                </p>
                <input
                  type="text"
                  value={scannedAlias}
                  onChange={(e) => setScannedAlias(e.target.value)}
                  placeholder="Alias..."
                  maxLength={254}
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40"
                  data-testid="input-scanned-alias"
                />
                <div className="font-mono text-[10px] text-muted-foreground/40 break-all bg-black/20 rounded-lg p-2">
                  {truncateKey(scannedKey)}
                </div>
                {addError && (
                  <p className="text-[10px] font-mono text-destructive">{addError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleConfirmScanned}
                    disabled={isAdding || !scannedAlias.trim()}
                    className="flex-1 bg-primary/20 hover:bg-primary/30 text-primary text-xs font-mono py-1.5 rounded-lg transition-colors disabled:opacity-40"
                    data-testid="button-confirm-scanned-contact"
                  >
                    {isAdding ? "Adding…" : "Add Contact"}
                  </button>
                  <button
                    onClick={cancelAdd}
                    className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors px-3"
                    data-testid="button-cancel-add"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Paste key form */}
            {addMode === "paste" && (
              <div className="bg-background/50 border border-white/10 rounded-xl p-3 mb-3 space-y-2">
                <input
                  type="text"
                  placeholder="Their alias..."
                  value={pasteAlias}
                  onChange={(e) => setPasteAlias(e.target.value)}
                  maxLength={254}
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40"
                  data-testid="input-contact-alias"
                />
                <textarea
                  placeholder="Paste their public key..."
                  value={pasteKey}
                  onChange={(e) => setPasteKey(e.target.value)}
                  rows={3}
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 resize-none"
                  data-testid="input-contact-key"
                />
                {addError && (
                  <p className="text-[10px] font-mono text-destructive">{addError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handlePasteAdd}
                    disabled={isAdding || !pasteAlias.trim() || !pasteKey.trim()}
                    className="flex-1 bg-primary/20 hover:bg-primary/30 text-primary text-xs font-mono py-1.5 rounded-lg transition-colors disabled:opacity-40"
                    data-testid="button-add-contact-confirm"
                  >
                    {isAdding ? "Verifying…" : "Add Contact"}
                  </button>
                  <button
                    onClick={cancelAdd}
                    className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors px-3"
                    data-testid="button-add-contact-cancel"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Contact rows */}
            {contacts.length === 0 && addMode === "idle" ? (
              <div className="text-center py-8 space-y-3">
                <Search size={28} className="text-muted-foreground/20 mx-auto" />
                <p className="text-xs font-mono text-muted-foreground/40">
                  Tap <span className="text-primary">Find</span> to add a contact by alias, or <span className="text-primary">Scan</span> their QR code
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {contacts.map((c) => {
                  const unread = unreadCounts[c.alias] ?? 0;
                  return (
                    <div
                      key={c.alias}
                      className="flex items-center gap-3 bg-background/40 hover:bg-background/60 border border-white/5 rounded-xl px-3 py-2.5 transition-colors group"
                      data-testid={`row-contact-${c.alias}`}
                    >
                      <button
                        className="flex-1 min-w-0 text-left"
                        onClick={() => onOpenChat(c.alias)}
                        data-testid={`button-open-chat-alias-${c.alias}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-foreground font-medium truncate">
                            {c.alias}
                          </span>
                          {unread > 0 && (
                            <span className="bg-primary text-primary-foreground text-[10px] font-mono px-1.5 py-0.5 rounded-full cursor-pointer">
                              {unread}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground/40">
                          {truncateKey(c.publicKeyBase64)}
                        </span>
                      </button>
                      <button
                        onClick={() => onOpenChat(c.alias)}
                        className="text-primary hover:text-primary/80 transition-colors"
                        title="Open private chat"
                        data-testid={`button-open-chat-${c.alias}`}
                      >
                        <ChevronRight size={16} />
                      </button>
                      <button
                        onClick={() => onRemoveContact(c.alias)}
                        className="text-muted-foreground/30 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                        title="Remove contact"
                        data-testid={`button-remove-contact-${c.alias}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Premium Verified ───────────────────────────────────────── */}
          <div className="!mt-2">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
                Premium Verified
              </p>
              {isPremium && <BadgeCheck size={12} className="text-amber-400" />}
            </div>

            {isPremium ? (
              /* ── Active premium card ── */
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <BadgeCheck size={15} className="text-amber-400" />
                  <span className="text-xs font-mono font-semibold text-amber-300">Verified Premium</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground/60">
                  <Mail size={10} />
                  {premiumStatus?.email}
                </div>
                {premiumStatus?.expiresAt && (
                  <p className="text-[10px] font-mono text-muted-foreground/40">
                    Valid until {new Date(premiumStatus.expiresAt).toLocaleDateString()}
                  </p>
                )}

                {/* Wallet Backup — unlocked for premium */}
                <div className="pt-2 border-t border-white/5 space-y-2">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
                    Wallet Backup
                  </p>
                  <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-2">
                    <ShieldAlert size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    <p className="text-[10px] font-mono text-amber-300/80 leading-relaxed">
                      Backup contains your <strong>private key</strong>. Keep it encrypted, never share it.
                    </p>
                  </div>
                  {backupState === "success" && (
                    <div className="flex items-center gap-2 text-green-400 text-[11px] font-mono">
                      <CheckCircle2 size={12} />
                      Restored! Reloading…
                    </div>
                  )}
                  {backupState === "error" && backupError && (
                    <p className="text-[10px] font-mono text-destructive">{backupError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={handleDownloadBackup}
                      disabled={backupState === "busy"}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-primary/30 bg-primary/10 text-primary text-[11px] font-mono font-semibold transition-colors hover:bg-primary/20 disabled:opacity-40"
                      data-testid="button-backup-download"
                    >
                      {backupState === "busy" ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                      Download
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={backupState === "busy"}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-white/10 bg-white/5 text-muted-foreground text-[11px] font-mono font-semibold transition-colors hover:bg-white/10 disabled:opacity-40"
                      data-testid="button-backup-restore"
                    >
                      {backupState === "busy" ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                      Restore
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleRestoreFile(file);
                        e.target.value = "";
                      }}
                      data-testid="input-backup-file"
                    />
                  </div>
                </div>
              </div>
            ) : (
              /* ── Go-premium card ── */
              <div className="bg-background/50 border border-white/10 rounded-xl p-3 space-y-3">
                {!premiumSubmitted && premiumStep === "form" && (
                  <>
                    <div className="flex items-start gap-2">
                      <Star size={13} className="text-amber-400 mt-0.5 flex-shrink-0" />
                      <p className="text-[11px] font-mono text-muted-foreground/70 leading-relaxed">
                        Pay <strong className="text-amber-300">$10 / year</strong> to unlock wallet backup and a verified badge.
                      </p>
                    </div>

                    {paymentMethods.length > 0 && (
                      <>
                        {/* Payment method tabs */}
                        {paymentMethods.length > 1 && (
                          <div className="flex gap-1">
                            {paymentMethods.map((m) => (
                              <button
                                key={m.key}
                                onClick={() => setPaymentTab(m.key)}
                                className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-semibold transition-colors ${
                                  paymentTab === m.key
                                    ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                                    : "text-muted-foreground/50 hover:text-foreground border border-transparent"
                                }`}
                                data-testid={`tab-payment-${m.key}`}
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Active payment method */}
                        {(() => {
                          const active = paymentMethods.find((m) => m.key === paymentTab) ?? paymentMethods[0];
                          const quote = quotations[active.key];
                          return (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wide">Pay to ({active.label})</p>
                                {quote && (
                                  <span className="text-[11px] font-mono font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5" data-testid={`text-quote-${active.key}`}>
                                    ≈ {quote} <span className="text-amber-300/50">= $10</span>
                                  </span>
                                )}
                              </div>
                              {active.key === "liquid" && (
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 bg-blue-500/5 border border-blue-500/15 rounded-lg px-3 py-2" data-testid="liquid-stables-row">
                                  <span className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-wide w-full">Or pay in stablecoins:</span>
                                  <span className="text-[11px] font-mono font-semibold text-emerald-400" data-testid="quote-usdt">10.00 USDt</span>
                                  {liquidEurx && (
                                    <><span className="text-muted-foreground/30">·</span><span className="text-[11px] font-mono font-semibold text-blue-300" data-testid="quote-eurx">{liquidEurx}</span></>
                                  )}
                                  {liquidDepix && (
                                    <><span className="text-muted-foreground/30">·</span><span className="text-[11px] font-mono font-semibold text-green-300" data-testid="quote-depix">{liquidDepix}</span></>
                                  )}
                                </div>
                              )}
                              <div className="flex items-center gap-2 bg-black/20 border border-white/10 rounded-lg px-2.5 py-2">
                                <Zap size={11} className="text-amber-400 flex-shrink-0" />
                                <span className="flex-1 text-[11px] font-mono text-amber-300 break-all">{active.address}</span>
                                <button
                                  onClick={() => { navigator.clipboard.writeText(active.address); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                                  className="text-muted-foreground/50 hover:text-foreground transition-colors ml-1 flex-shrink-0"
                                  title={`Copy ${active.label} address`}
                                  data-testid={`button-copy-payment-${active.key}`}
                                >
                                  {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                                </button>
                              </div>
                              <div className="flex justify-center py-1">
                                <QRCodeDisplay value={active.qrValue} size={140} />
                              </div>
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </>
                )}

                {/* Two-step activation form */}
                {premiumSubmitted ? (
                  <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-3">
                    <CheckCircle2 size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    <div className="space-y-0.5">
                      <p className="text-xs font-mono font-semibold text-amber-300">Request submitted!</p>
                      <p className="text-[11px] font-mono text-amber-300/70 leading-relaxed">
                        Your payment proof is under review. You'll receive a confirmation email once approved (usually within 24 hours).
                      </p>
                      <button
                        onClick={() => setPremiumSubmitted(false)}
                        className="text-[10px] font-mono text-muted-foreground/50 hover:text-muted-foreground transition-colors mt-1"
                        data-testid="button-premium-submit-another"
                      >
                        Submit another request
                      </button>
                    </div>
                  </div>
                ) : premiumStep === "form" ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wide">
                      After paying — enter your email to verify
                    </p>
                    <input
                      type="email"
                      value={premiumEmail}
                      onChange={(e) => { setPremiumEmail(e.target.value); setPremiumFormError(null); }}
                      placeholder="your@email.com"
                      className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40"
                      data-testid="input-premium-email"
                    />
                    <input
                      type="text"
                      value={premiumNote}
                      onChange={(e) => setPremiumNote(e.target.value)}
                      placeholder="Payment note or reference (optional)"
                      maxLength={100}
                      className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40"
                      data-testid="input-premium-note"
                    />
                    <textarea
                      value={premiumProof}
                      onChange={(e) => setPremiumProof(e.target.value)}
                      placeholder="Lightning payment proof / preimage (paste here to speed up approval)"
                      rows={2}
                      className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-amber-400/30 resize-none"
                      data-testid="input-premium-proof"
                    />
                    {premiumFormError && (
                      <p className="text-[10px] font-mono text-destructive">{premiumFormError}</p>
                    )}
                    <button
                      onClick={handleSendCode}
                      disabled={sendCodeMutation.isPending || !premiumEmail}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[11px] font-mono font-semibold transition-colors hover:bg-amber-500/20 disabled:opacity-40"
                      data-testid="button-send-verification-code"
                    >
                      {sendCodeMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <Mail size={11} />}
                      Send Verification Code
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wide">
                        Enter the code sent to
                      </p>
                      <button
                        onClick={() => { setPremiumStep("form"); setPremiumFormError(null); setPremiumCode(""); }}
                        className="text-[10px] font-mono text-muted-foreground/40 hover:text-foreground transition-colors"
                        data-testid="button-premium-back"
                      >
                        ← back
                      </button>
                    </div>
                    <p className="text-[11px] font-mono text-amber-300/80 truncate">{premiumEmail}</p>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={premiumCode}
                      onChange={(e) => { setPremiumCode(e.target.value.replace(/\D/g, "")); setPremiumFormError(null); }}
                      placeholder="6-digit code"
                      className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-center tracking-widest text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40"
                      data-testid="input-premium-code"
                    />
                    {premiumFormError && (
                      <p className="text-[10px] font-mono text-destructive">{premiumFormError}</p>
                    )}
                    <button
                      onClick={handleVerifyCode}
                      disabled={claimMutation.isPending || premiumCode.length !== 6}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[11px] font-mono font-semibold transition-colors hover:bg-amber-500/20 disabled:opacity-40"
                      data-testid="button-activate-premium"
                    >
                      {claimMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <BadgeCheck size={11} />}
                      Activate Premium
                    </button>
                    <button
                      onClick={() => sendCodeMutation.mutate(premiumEmail)}
                      disabled={sendCodeMutation.isPending}
                      className="w-full text-[10px] font-mono text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                      data-testid="button-resend-code"
                    >
                      {sendCodeMutation.isPending ? "Sending…" : "Resend code"}
                    </button>
                  </div>
                )}

              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
