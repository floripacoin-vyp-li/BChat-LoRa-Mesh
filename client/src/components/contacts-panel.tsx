import { useState } from "react";
import { X, Trash2, MessageSquareLock, ChevronRight, QrCode, ScanLine, KeyRound, Search, Loader2 } from "lucide-react";
import { QRCodeDisplay } from "@/components/qr-code";
import { QRScanner, buildQRKeyPayload, type ScannedKey } from "@/components/qr-scanner";
import type { Contact } from "@/hooks/use-contacts";

interface ContactsPanelProps {
  contacts: Contact[];
  myPublicKeyBase64: string | null;
  myAlias: string;
  unreadCounts: Record<string, number>;
  onAddContact: (alias: string, publicKeyBase64: string) => Promise<void>;
  onRemoveContact: (alias: string) => void;
  onOpenChat: (contactAlias: string) => void;
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
  onClose,
}: ContactsPanelProps) {
  const [showMyQR, setShowMyQR] = useState(true);
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
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-close-contacts"
          >
            <X size={16} />
          </button>
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
                    maxLength={24}
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
                  maxLength={24}
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
                  maxLength={24}
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
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-foreground font-medium truncate">
                            {c.alias}
                          </span>
                          {unread > 0 && (
                            <span className="bg-primary text-primary-foreground text-[10px] font-mono px-1.5 py-0.5 rounded-full">
                              {unread}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground/40">
                          {truncateKey(c.publicKeyBase64)}
                        </span>
                      </div>
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
        </div>
      </div>
    </>
  );
}
