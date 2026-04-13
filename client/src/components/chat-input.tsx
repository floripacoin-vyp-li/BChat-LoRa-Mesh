import { useState, useRef, useEffect } from "react";
import { Send, Terminal, Pencil, Check, X, Loader2, BadgeCheck, XCircle, Mail, KeyRound, Crown, Dices } from "lucide-react";
import { useSendMessage } from "@/hooks/use-messages";
import { useToast } from "@/hooks/use-toast";
import { getMyPublicKeyBase64 } from "@/lib/crypto";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ChatInputProps {
  alias: string;
  onAliasChange: (newAlias: string) => Promise<"ok" | "taken">;
}

type EmailStatus = "idle" | "checking" | "premium" | "not-premium";
type ReclaimStep = "none" | "sending" | "code-entry" | "verifying";

export function ChatInput({ alias, onAliasChange }: ChatInputProps) {
  const [content, setContent] = useState("");
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasInput, setAliasInput] = useState(alias);
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [committingAlias, setCommittingAlias] = useState(false);

  // Email-alias flow
  const [emailStatus, setEmailStatus] = useState<EmailStatus>("idle");
  const [reclaimStep, setReclaimStep] = useState<ReclaimStep>("none");
  const [reclaimCode, setReclaimCode] = useState("");
  const [reclaimError, setReclaimError] = useState("");
  const [showTakenOptions, setShowTakenOptions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { mutate: sendMessage, isPending } = useSendMessage();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const aliasInputRef = useRef<HTMLInputElement>(null);

  const trimmedInput = aliasInput.trim();
  const isEmail = EMAIL_RE.test(trimmedInput);

  // Debounced premium check when alias looks like an email
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isEmail) {
      setEmailStatus("idle");
      setReclaimStep("none");
      setReclaimCode("");
      setReclaimError("");
      return;
    }
    setEmailStatus("checking");
    setShowTakenOptions(false);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/premium/check-email/${encodeURIComponent(trimmedInput)}`);
        const data = await res.json();
        setEmailStatus(data.isPremium ? "premium" : "not-premium");
      } catch {
        setEmailStatus("not-premium");
      }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [trimmedInput, isEmail]);

  useEffect(() => {
    if (!editingAlias) inputRef.current?.focus();
  }, [editingAlias]);

  useEffect(() => {
    if (editingAlias) {
      aliasInputRef.current?.focus();
      aliasInputRef.current?.select();
    }
  }, [editingAlias]);

  const resetEmailFlow = () => {
    setReclaimStep("none");
    setReclaimCode("");
    setReclaimError("");
    setShowTakenOptions(false);
  };

  const cancelAlias = () => {
    setAliasInput(alias);
    setEditingAlias(false);
    setAliasError(null);
    resetEmailFlow();
    setEmailStatus("idle");
  };

  const commitAlias = async () => {
    const trimmed = trimmedInput.slice(0, 254);
    if (trimmed.length < 2) { cancelAlias(); return; }
    if (trimmed === alias) { setEditingAlias(false); setAliasError(null); return; }

    // Block email aliases that aren't verified Premium
    if (isEmail) {
      if (emailStatus === "checking") return;
      if (emailStatus === "not-premium") {
        setAliasError("email-not-premium");
        return;
      }
      // premium — proceed to claim (reclaim flow handles "taken" case below)
    }

    setCommittingAlias(true);
    setAliasError(null);
    const result = await onAliasChange(trimmed);
    setCommittingAlias(false);

    if (result === "taken") {
      if (isEmail && emailStatus === "premium") {
        setReclaimStep("code-entry");
      } else {
        setShowTakenOptions(true);
      }
    } else {
      setEditingAlias(false);
      resetEmailFlow();
    }
  };

  const handleSendCode = async () => {
    setReclaimStep("sending");
    setReclaimError("");
    try {
      const res = await fetch("/api/premium/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedInput }),
      });
      if (!res.ok) throw new Error();
      setReclaimStep("code-entry");
    } catch {
      setReclaimError("Could not send code. Try again.");
      setReclaimStep("code-entry");
    }
  };

  const handleVerifyAndClaim = async () => {
    if (reclaimCode.length !== 6) {
      setReclaimError("Enter the 6-digit code.");
      return;
    }
    setReclaimStep("verifying");
    setReclaimError("");
    try {
      const publicKey = await getMyPublicKeyBase64();
      const res = await fetch("/api/users/reclaim-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: trimmedInput, publicKey, code: reclaimCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setReclaimError(data.message ?? "Invalid code. Try again.");
        setReclaimStep("code-entry");
        return;
      }
      // publicKey updated — retry claim
      setCommittingAlias(true);
      const result = await onAliasChange(trimmedInput);
      setCommittingAlias(false);
      if (result === "ok") {
        setEditingAlias(false);
        resetEmailFlow();
      } else {
        setReclaimError("Verification passed but claim failed. Try again.");
        setReclaimStep("code-entry");
      }
    } catch {
      setReclaimError("Network error. Try again.");
      setReclaimStep("code-entry");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || isPending) return;
    sendMessage({ content: content.trim(), sender: alias }, {
      onSuccess: () => setContent(""),
      onError: (err) => {
        toast({
          title: "Message not sent",
          description: err instanceof Error ? err.message : "Failed to transmit",
          variant: "destructive",
        });
      },
    });
  };

  const inReclaim = reclaimStep !== "none";
  const confirmDisabled = committingAlias || inReclaim || showTakenOptions ||
    (isEmail && (emailStatus === "checking" || emailStatus === "not-premium"));

  return (
    <div className="p-4 glass-panel border-t-0 rounded-b-2xl">
      {/* Alias bar */}
      <div className="flex flex-col gap-1 mb-2 px-1">
        <div className="flex items-center gap-2">
          <Terminal size={12} className="text-muted-foreground/50 shrink-0" />
          {editingAlias ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <div className="relative flex-1 min-w-0">
                <input
                  ref={aliasInputRef}
                  type="text"
                  value={aliasInput}
                  maxLength={254}
                  onChange={(e) => {
                    setAliasInput(e.target.value);
                    setAliasError(null);
                    resetEmailFlow();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !committingAlias && !inReclaim) commitAlias();
                    if (e.key === "Escape") cancelAlias();
                  }}
                  className="w-full bg-background/50 border border-primary/40 rounded px-2 py-0.5 text-xs font-mono text-primary focus:outline-none pr-5"
                  data-testid="input-alias-edit"
                />
                {isEmail && (
                  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none">
                    {emailStatus === "checking" && <Loader2 size={10} className="animate-spin text-muted-foreground/50" />}
                    {emailStatus === "premium" && <BadgeCheck size={10} className="text-amber-400" />}
                    {emailStatus === "not-premium" && <XCircle size={10} className="text-destructive/60" />}
                  </span>
                )}
              </div>
              <button
                onClick={commitAlias}
                disabled={confirmDisabled}
                className="text-primary hover:text-primary/80 transition-colors disabled:opacity-40 shrink-0"
                data-testid="button-alias-confirm"
              >
                {committingAlias ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              </button>
              <button
                onClick={cancelAlias}
                disabled={committingAlias}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 shrink-0"
                data-testid="button-alias-cancel"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setAliasInput(alias); setEditingAlias(true); setAliasError(null); resetEmailFlow(); }}
              className="flex items-center gap-1.5 group"
              title="Edit your alias"
              data-testid="button-edit-alias"
            >
              <span className="text-xs font-mono text-primary tracking-wide">{alias}</span>
              <Pencil size={14} className="text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
            </button>
          )}
        </div>

        {/* ── Inline status notices ─────────────────────────── */}
        {editingAlias && showTakenOptions && (
          <div className="ml-5 mt-1 space-y-2 bg-destructive/8 border border-destructive/20 rounded-lg px-2.5 py-2.5">
            <div className="flex items-start gap-1.5">
              <XCircle size={10} className="text-destructive/70 mt-0.5 shrink-0" />
              <p className="text-[10px] font-mono text-destructive/80 leading-relaxed">
                <span className="font-semibold">{trimmedInput}</span> is unavailable — taken or recently released (held 1 week).
              </p>
            </div>
            <button
              onClick={() => {
                const random = (document.querySelector("[data-testid='button-random-alias']") as HTMLButtonElement)?.click;
                const handle = `User_${Math.random().toString(36).slice(2, 6)}`;
                setAliasInput(handle);
                setShowTakenOptions(false);
                setAliasError(null);
              }}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-primary/15 hover:bg-primary/25 text-primary text-[10px] font-mono font-semibold transition-colors"
              data-testid="button-taken-random"
            >
              <Dices size={11} />
              Generate a random alias
            </button>
            <div className="flex items-start gap-1.5 pt-1 border-t border-white/5">
              <Crown size={9} className="text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[10px] font-mono text-amber-300/70 leading-relaxed">
                <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("bcb:open-premium"))} className="text-amber-400 underline underline-offset-2 hover:text-amber-300 transition-colors">Upgrade to Premium</button>
                {" "}in the Contacts panel to use your email as alias instead.
              </p>
            </div>
          </div>
        )}

        {editingAlias && !showTakenOptions && isEmail && emailStatus === "checking" && (
          <div className="flex items-center gap-1.5 pl-5" data-testid="text-alias-checking">
            <Loader2 size={10} className="animate-spin text-muted-foreground/40" />
            <span className="text-[10px] font-mono text-muted-foreground/40">Checking Premium status…</span>
          </div>
        )}

        {editingAlias && !showTakenOptions && isEmail && emailStatus === "premium" && !inReclaim && aliasError !== "email-not-premium" && (
          <div className="flex items-center gap-1.5 pl-5" data-testid="text-alias-premium-ok">
            <BadgeCheck size={10} className="text-amber-400 shrink-0" />
            <span className="text-[10px] font-mono text-amber-300">Premium account verified — you can use this email.</span>
          </div>
        )}

        {!showTakenOptions && ((editingAlias && isEmail && emailStatus === "not-premium") || aliasError === "email-not-premium") ? (
          <div className="flex items-start gap-1.5 pl-5 pr-1" data-testid="text-alias-not-premium">
            <Crown size={10} className="text-amber-400 mt-0.5 shrink-0" />
            <span className="text-[10px] font-mono text-amber-300/80 leading-relaxed">
              This email isn't a Premium account.{" "}
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("bcb:open-premium"))} className="text-amber-400 underline underline-offset-2 hover:text-amber-300 transition-colors">Upgrade to Premium</button>
              {" "}in the Contacts panel to use your email as alias.
            </span>
          </div>
        ) : !showTakenOptions && aliasError && aliasError !== "email-not-premium" ? (
          <p className="text-[10px] font-mono text-destructive pl-5" data-testid="text-alias-edit-error">{aliasError}</p>
        ) : null}

        {/* ── Reclaim / OTP panel ───────────────────────────── */}
        {editingAlias && inReclaim && (
          <div className="mt-1 ml-5 space-y-2 bg-amber-500/8 border border-amber-500/20 rounded-lg p-2.5">
            <div className="flex items-start gap-1.5">
              <Mail size={10} className="text-amber-400 mt-0.5 shrink-0" />
              <p className="text-[10px] font-mono text-amber-300/80 leading-relaxed">
                {reclaimStep === "code-entry" || reclaimStep === "verifying"
                  ? `Enter the 6-digit code sent to ${trimmedInput}.`
                  : `Sending code to ${trimmedInput}…`}
              </p>
            </div>

            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <KeyRound size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={reclaimCode}
                  onChange={(e) => { setReclaimCode(e.target.value.replace(/\D/g, "")); setReclaimError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && reclaimStep === "code-entry" && handleVerifyAndClaim()}
                  placeholder="000000"
                  className="w-full bg-background/50 border border-white/10 rounded px-2 py-1 pl-6 text-xs font-mono text-foreground tracking-widest placeholder:tracking-normal placeholder:text-muted-foreground/30 focus:outline-none focus:border-amber-400/40 transition-all"
                  data-testid="input-reclaim-code"
                />
              </div>
              <button
                onClick={handleVerifyAndClaim}
                disabled={reclaimStep === "verifying" || reclaimCode.length !== 6}
                className="px-2 py-1 bg-amber-500 text-black text-[10px] font-mono font-semibold rounded hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1 shrink-0"
                data-testid="button-verify-claim"
              >
                {reclaimStep === "verifying" ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                {reclaimStep === "verifying" ? "…" : "Verify"}
              </button>
            </div>

            {reclaimError && (
              <p className="text-[10px] font-mono text-destructive" data-testid="text-reclaim-error">{reclaimError}</p>
            )}

            <button
              onClick={handleSendCode}
              disabled={reclaimStep === "sending" || reclaimStep === "verifying"}
              className="text-[10px] font-mono text-amber-300/60 hover:text-amber-300 transition-colors disabled:opacity-40 flex items-center gap-1"
              data-testid="button-send-reclaim-code"
            >
              {reclaimStep === "sending" ? <Loader2 size={10} className="animate-spin" /> : <Mail size={10} />}
              {reclaimStep === "sending" ? "Sending…" : "Resend code"}
            </button>
          </div>
        )}
      </div>

      {/* Message form */}
      <form
        onSubmit={handleSubmit}
        className="relative flex items-center bg-background/50 border border-white/10 rounded-xl overflow-hidden focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all duration-300"
      >
        <div className="pl-3 pr-2 text-muted-foreground/40 font-mono text-xs select-none whitespace-nowrap">
          &gt;
        </div>
        <input
          ref={inputRef}
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Transmit message..."
          disabled={isPending || editingAlias}
          className="flex-1 bg-transparent border-none px-2 py-4 text-sm focus:outline-none focus:ring-0 disabled:opacity-50 text-foreground placeholder:text-muted-foreground/75 font-mono"
          data-testid="input-message"
        />
        <div className="pr-2">
          <button
            type="submit"
            disabled={!content.trim() || isPending}
            className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-30 disabled:hover:bg-primary/10 disabled:hover:text-primary transition-all duration-200"
            data-testid="button-send"
          >
            <Send size={22} className={isPending ? "animate-pulse" : ""} />
          </button>
        </div>
      </form>
    </div>
  );
}
