import { useState, useEffect, useRef } from "react";
import { UserCheck, Shuffle, Loader2, BadgeCheck, XCircle, Mail, KeyRound, Crown, Dices } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { getMyPublicKeyBase64 } from "@/lib/crypto";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AliasDialogProps {
  open: boolean;
  onConfirm: (alias: string) => Promise<"ok" | "taken">;
  onSkip: () => string;
}

type EmailCheck = "idle" | "checking" | "premium" | "not-premium";
type ReclaimStep = "none" | "sending" | "code-entry" | "verifying";

export function AliasDialog({ open, onConfirm, onSkip }: AliasDialogProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailCheck, setEmailCheck] = useState<EmailCheck>("idle");
  const [reclaimStep, setReclaimStep] = useState<ReclaimStep>("none");
  const [reclaimCode, setReclaimCode] = useState("");
  const [reclaimError, setReclaimError] = useState("");
  const [showTakenOptions, setShowTakenOptions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmed = value.trim();
  const isEmailFormat = EMAIL_RE.test(trimmed);

  // Reset reclaim/taken state when alias changes
  useEffect(() => {
    setReclaimStep("none");
    setReclaimCode("");
    setReclaimError("");
    setShowTakenOptions(false);
    setError("");
  }, [value]);

  // Debounced premium check whenever the value looks like an email
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isEmailFormat) {
      setEmailCheck("idle");
      return;
    }
    setEmailCheck("checking");
    const email = trimmed;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/premium/check-email/${encodeURIComponent(email)}`);
        const data = await res.json();
        setEmailCheck(data.isPremium ? "premium" : "not-premium");
      } catch {
        setEmailCheck("not-premium");
      }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [trimmed, isEmailFormat]);

  const handleConfirm = async () => {
    if (trimmed.length < 2) {
      setError("Alias must be at least 2 characters.");
      return;
    }
    if (isEmailFormat) {
      if (emailCheck === "checking") return;
      if (emailCheck !== "premium") {
        setError("email-not-premium");
        return;
      }
    }
    setLoading(true);
    setError("");
    const result = await onConfirm(trimmed);
    setLoading(false);
    if (result === "taken") {
      if (isEmailFormat && emailCheck === "premium") {
        setReclaimStep("code-entry");
      } else {
        setShowTakenOptions(true);
      }
    }
  };

  const handleRandom = () => {
    const generated = onSkip();
    setValue(generated);
  };

  const handleSendCode = async () => {
    setReclaimStep("sending");
    setReclaimError("");
    try {
      const res = await fetch("/api/premium/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!res.ok) throw new Error();
      setReclaimStep("code-entry");
    } catch {
      setReclaimError("Could not send the code. Check your connection and try again.");
      setReclaimStep("code-entry");
    }
  };

  const handleVerifyAndClaim = async () => {
    if (reclaimCode.length !== 6) {
      setReclaimError("Enter the 6-digit code from your email.");
      return;
    }
    setReclaimStep("verifying");
    setReclaimError("");
    try {
      const publicKey = await getMyPublicKeyBase64();
      const res = await fetch("/api/users/reclaim-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: trimmed, publicKey, code: reclaimCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setReclaimError(data.message ?? "Verification failed. Try sending a new code.");
        setReclaimStep("code-entry");
        return;
      }
      setLoading(true);
      const result = await onConfirm(trimmed);
      setLoading(false);
      if (result !== "ok") {
        setReclaimError("Verification passed but claim failed. Please try again.");
        setReclaimStep("code-entry");
      }
    } catch {
      setReclaimError("Network error. Please try again.");
      setReclaimStep("code-entry");
    }
  };

  const inReclaim = reclaimStep !== "none";
  const confirmDisabled = !trimmed || loading || inReclaim || showTakenOptions ||
    (isEmailFormat && (emailCheck === "checking" || emailCheck === "not-premium"));

  return (
    <Dialog open={open}>
      <DialogContent
        className="bg-card border-border/50 font-mono max-w-sm"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            {inReclaim
              ? <><Mail size={18} className="text-amber-400" />Verify ownership</>
              : <><UserCheck size={18} className="text-primary" />Set your alias</>}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs leading-relaxed">
            {inReclaim
              ? `A verification code will be sent to ${trimmed}. Enter it below to reclaim this alias.`
              : "Choose a handle that other users will see next to your messages. You can change it later."}
          </DialogDescription>
        </DialogHeader>

        {!inReclaim ? (
          <div className="mt-2 space-y-4">
            {/* Alias input */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  autoFocus
                  type="text"
                  value={value}
                  maxLength={254}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !loading && !showTakenOptions && handleConfirm()}
                  placeholder="e.g. AlphaNode"
                  className="w-full bg-background/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all pr-8"
                  data-testid="input-alias"
                />
                {isEmailFormat && (
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    {emailCheck === "checking" && <Loader2 size={13} className="animate-spin text-muted-foreground/50" />}
                    {emailCheck === "premium" && <BadgeCheck size={13} className="text-amber-400" />}
                    {emailCheck === "not-premium" && <XCircle size={13} className="text-destructive/70" />}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleRandom}
                disabled={loading}
                title="Generate a random alias"
                className="px-3 py-2 rounded-lg border border-white/10 text-muted-foreground hover:bg-primary/10 hover:border-primary/30 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                data-testid="button-random-alias"
              >
                <Shuffle size={15} />
              </button>
            </div>

            {/* ── Taken options panel ───────────────────────── */}
            {showTakenOptions && (
              <div className="space-y-3 bg-destructive/8 border border-destructive/20 rounded-lg px-3 py-3">
                <div className="flex items-start gap-2">
                  <XCircle size={13} className="text-destructive/70 mt-0.5 shrink-0" />
                  <p className="text-[11px] font-mono text-destructive/80 leading-relaxed">
                    <span className="font-semibold">{trimmed}</span> is unavailable — it may be taken or recently released (held for 1 week).
                  </p>
                </div>
                <button
                  onClick={handleRandom}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary text-xs font-mono font-semibold transition-colors"
                  data-testid="button-taken-random"
                >
                  <Dices size={13} />
                  Generate a random alias
                </button>
                <div className="flex items-start gap-2 pt-1 border-t border-white/5">
                  <Crown size={11} className="text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-[10px] font-mono text-amber-300/70 leading-relaxed">
                    <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("bcb:open-premium"))} className="text-amber-400 underline underline-offset-2 hover:text-amber-300 transition-colors">Upgrade to Premium</button>
                    {" "}in the Contacts panel to use your email as alias instead.
                  </p>
                </div>
              </div>
            )}

            {/* Status banners (not shown when takenOptions is visible) */}
            {!showTakenOptions && (
              <>
                {error === "email-not-premium" ? (
                  <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2.5" data-testid="text-alias-error">
                    <BadgeCheck size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    <div className="space-y-0.5">
                      <p className="text-xs font-mono font-semibold text-amber-300">This email is not a Premium account</p>
                      <p className="text-[11px] font-mono text-amber-300/70 leading-relaxed">
                        Email aliases are reserved for verified Premium members. Choose a regular handle now, then{" "}
                        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("bcb:open-premium"))} className="text-amber-400 underline underline-offset-2 hover:text-amber-300 transition-colors">Upgrade to Premium</button>
                        {" "}in the Contacts panel to use your email.
                      </p>
                    </div>
                  </div>
                ) : error ? (
                  <p className="text-xs text-destructive font-mono" data-testid="text-alias-error">{error}</p>
                ) : isEmailFormat && emailCheck === "premium" ? (
                  <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2" data-testid="text-alias-premium-ok">
                    <BadgeCheck size={13} className="text-amber-400 flex-shrink-0" />
                    <p className="text-[11px] font-mono text-amber-300">Premium account verified — you can use this email as your alias.</p>
                  </div>
                ) : isEmailFormat && emailCheck === "not-premium" ? (
                  <div className="flex items-start gap-2 bg-amber-500/8 border border-amber-500/15 rounded-lg px-3 py-2" data-testid="text-alias-email-hint">
                    <XCircle size={13} className="text-destructive/60 mt-0.5 flex-shrink-0" />
                    <p className="text-[11px] font-mono text-amber-300/60 leading-relaxed">
                      This email is not registered as a Premium account. Use a regular handle or{" "}
                      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("bcb:open-premium"))} className="text-amber-400 underline underline-offset-2 hover:text-amber-300 transition-colors">Upgrade to Premium</button>.
                    </p>
                  </div>
                ) : isEmailFormat && emailCheck === "checking" ? (
                  <div className="flex items-center gap-2 px-1" data-testid="text-alias-checking">
                    <Loader2 size={11} className="animate-spin text-muted-foreground/50" />
                    <p className="text-[11px] font-mono text-muted-foreground/50">Checking Premium status…</p>
                  </div>
                ) : null}
              </>
            )}

            {!showTakenOptions && (
              <button
                onClick={handleConfirm}
                disabled={confirmDisabled}
                className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                data-testid="button-confirm-alias"
              >
                {loading && <Loader2 size={14} className="animate-spin" />}
                {loading ? "Checking..." : "Confirm alias"}
              </button>
            )}
          </div>
        ) : (
          /* ── Reclaim / OTP panel ─────────────────────────── */
          <div className="mt-2 space-y-4">
            <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2.5">
              <Mail size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="space-y-0.5">
                <p className="text-xs font-mono font-semibold text-amber-300">This email alias is already registered</p>
                <p className="text-[11px] font-mono text-amber-300/70 leading-relaxed">
                  If this is your account, verify ownership by entering the code sent to{" "}
                  <span className="text-amber-300">{trimmed}</span>.
                </p>
              </div>
            </div>

            <div className="relative">
              <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
              <input
                autoFocus
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={reclaimCode}
                onChange={(e) => { setReclaimCode(e.target.value.replace(/\D/g, "")); setReclaimError(""); }}
                onKeyDown={(e) => e.key === "Enter" && reclaimStep === "code-entry" && handleVerifyAndClaim()}
                placeholder="6-digit code"
                className="w-full bg-background/50 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-foreground tracking-widest placeholder:tracking-normal placeholder:text-muted-foreground/50 focus:outline-none focus:border-amber-400/40 focus:ring-1 focus:ring-amber-400/20 transition-all"
                data-testid="input-reclaim-code"
              />
            </div>

            {reclaimError && (
              <p className="text-xs text-destructive font-mono" data-testid="text-reclaim-error">{reclaimError}</p>
            )}

            <button
              onClick={handleVerifyAndClaim}
              disabled={reclaimStep === "verifying" || reclaimStep === "sending" || reclaimCode.length !== 6}
              className="w-full py-2.5 rounded-lg bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              data-testid="button-verify-claim"
            >
              {reclaimStep === "verifying" && <Loader2 size={14} className="animate-spin" />}
              {reclaimStep === "verifying" ? "Verifying…" : "Verify & claim alias"}
            </button>

            <button
              onClick={handleSendCode}
              disabled={reclaimStep === "sending" || reclaimStep === "verifying"}
              className="w-full py-2 rounded-lg border border-white/10 text-muted-foreground text-xs font-mono hover:bg-white/5 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              data-testid="button-send-reclaim-code"
            >
              {reclaimStep === "sending" && <Loader2 size={12} className="animate-spin" />}
              {reclaimStep === "sending" ? "Sending code…" : "Send verification code to my email"}
            </button>

            <button
              type="button"
              onClick={() => { setReclaimStep("none"); setReclaimCode(""); setReclaimError(""); setError(""); setShowTakenOptions(false); }}
              className="w-full text-[11px] font-mono text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              data-testid="button-reclaim-cancel"
            >
              ← Back to alias selection
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
