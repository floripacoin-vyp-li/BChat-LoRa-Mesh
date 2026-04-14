import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp, LogOut, RefreshCw, Settings, Save, Loader2, Zap, Bitcoin, Waves } from "lucide-react";
import type { PremiumUser, PaymentConfig } from "@shared/schema";

type Filter = "all" | "pending" | "active" | "revoked";

const PAYMENT_METHOD_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  lightning: { label: "Lightning", icon: <Zap size={9} />, color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  bch:       { label: "BCH",       icon: <span className="text-[9px] font-bold leading-none">₿</span>, color: "text-green-400 bg-green-500/10 border-green-500/20" },
  btc:       { label: "BTC",       icon: <Bitcoin size={9} />, color: "text-orange-400 bg-orange-500/10 border-orange-500/20" },
  liquid:    { label: "Liquid",    icon: <Waves size={9} />,   color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
};

function paymentMethodBadge(method: string | null | undefined) {
  if (!method) return null;
  const meta = PAYMENT_METHOD_LABELS[method] ?? { label: method, icon: null, color: "text-muted-foreground/60 bg-white/5 border-white/10" };
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-mono font-semibold ${meta.color}`}>
      {meta.icon}{meta.label}
    </span>
  );
}

function statusBadge(status: string) {
  if (status === "active")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-[10px] font-mono font-semibold"><CheckCircle2 size={10} />active</span>;
  if (status === "pending")
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-mono font-semibold"><Clock size={10} />pending</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/15 text-destructive text-[10px] font-mono font-semibold"><XCircle size={10} />revoked</span>;
}

function fmt(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function PaymentConfigSection({
  lightning, onLightning,
  bch, onBch,
  btc, onBtc,
  liquid, onLiquid,
  onSave, isPending, isSaved,
}: {
  lightning: string; onLightning: (v: string) => void;
  bch: string; onBch: (v: string) => void;
  btc: string; onBtc: (v: string) => void;
  liquid: string; onLiquid: (v: string) => void;
  onSave: () => void; isPending: boolean; isSaved: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-card border border-border/40 rounded-xl overflow-hidden" data-testid="payment-config-section">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/3 transition-colors"
        data-testid="button-toggle-payment-config"
      >
        <div className="flex items-center gap-2">
          <Settings size={14} className="text-amber-400" />
          <span className="text-sm font-semibold text-foreground">Payment Addresses</span>
          <span className="text-[10px] text-muted-foreground/50">— shown to users on Premium upgrade</span>
        </div>
        {open ? <ChevronUp size={13} className="text-muted-foreground/40" /> : <ChevronDown size={13} className="text-muted-foreground/40" />}
      </button>

      {open && (
        <div className="border-t border-border/30 px-4 py-4 space-y-3 bg-background/30">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wide">
                <Zap size={10} className="text-amber-400" /> Lightning address
              </label>
              <input
                type="text"
                value={lightning}
                onChange={(e) => onLightning(e.target.value)}
                placeholder="you@walletofsatoshi.com"
                className="w-full bg-background/50 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-amber-400/40"
                data-testid="input-payment-lightning"
              />
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wide">
                <span className="text-green-400 text-[10px] font-bold">₿</span> BCH address
              </label>
              <input
                type="text"
                value={bch}
                onChange={(e) => onBch(e.target.value)}
                placeholder="bitcoincash:q..."
                className="w-full bg-background/50 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-amber-400/40"
                data-testid="input-payment-bch"
              />
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wide">
                <Bitcoin size={10} className="text-orange-400" /> BTC address
              </label>
              <input
                type="text"
                value={btc}
                onChange={(e) => onBtc(e.target.value)}
                placeholder="bc1q..."
                className="w-full bg-background/50 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-amber-400/40"
                data-testid="input-payment-btc"
              />
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wide">
                <Waves size={10} className="text-blue-400" /> Liquid address
              </label>
              <input
                type="text"
                value={liquid}
                onChange={(e) => onLiquid(e.target.value)}
                placeholder="lq1..."
                className="w-full bg-background/50 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-amber-400/40"
                data-testid="input-payment-liquid"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={onSave}
              disabled={isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 text-xs font-mono font-semibold hover:bg-amber-500/25 disabled:opacity-40 transition-colors"
              data-testid="button-save-payment-config"
            >
              {isPending ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              {isPending ? "Saving…" : "Save"}
            </button>
            {isSaved && (
              <span className="flex items-center gap-1 text-[11px] text-green-400 font-mono">
                <CheckCircle2 size={11} /> Saved
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem("bcb-admin-key") ?? "");
  const [keyInput, setKeyInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [filter, setFilter] = useState<Filter>("pending");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [paymentSaved, setPaymentSaved] = useState(false);
  const [pcLightning, setPcLightning] = useState("");
  const [pcBch, setPcBch] = useState("");
  const [pcBtc, setPcBtc] = useState("");
  const [pcLiquid, setPcLiquid] = useState("");

  const authenticated = !!adminKey;
  const qc = useQueryClient();

  const headers = { "x-admin-key": adminKey };

  const { data: users = [], isLoading, isError, refetch } = useQuery<PremiumUser[]>({
    queryKey: ["/api/admin/premium", adminKey],
    queryFn: async () => {
      const res = await fetch("/api/admin/premium", { headers });
      if (res.status === 401) throw new Error("Unauthorized");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: authenticated,
    retry: false,
  });

  const approveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/premium/${id}/approve`, { method: "POST", headers });
      if (!res.ok) throw new Error("Failed to approve");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/premium", adminKey] }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/premium/${id}/revoke`, { method: "POST", headers });
      if (!res.ok) throw new Error("Failed to revoke");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/premium", adminKey] }),
  });

  const { data: paymentConfig } = useQuery<PaymentConfig>({
    queryKey: ["/api/config/payment"],
    queryFn: async () => {
      const res = await fetch("/api/config/payment");
      return res.json();
    },
    enabled: authenticated,
    staleTime: 0,
    refetchOnMount: true,
  });

  useEffect(() => {
    if (!paymentConfig) return;
    setPcLightning(paymentConfig.lightningAddress ?? "");
    setPcBch(paymentConfig.bchAddress ?? "");
    setPcBtc(paymentConfig.btcAddress ?? "");
    setPcLiquid(paymentConfig.liquidAddress ?? "");
  }, [paymentConfig]);

  const savePaymentConfig = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/payment-config", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ lightningAddress: pcLightning, bchAddress: pcBch, btcAddress: pcBtc, liquidAddress: pcLiquid }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/config/payment"] });
      setPaymentSaved(true);
      setTimeout(() => setPaymentSaved(false), 2500);
    },
  });

  const handleLogin = async () => {
    setAuthError("");
    const res = await fetch("/api/admin/premium", { headers: { "x-admin-key": keyInput } });
    if (res.status === 401 || res.status === 503) {
      setAuthError("Invalid admin key.");
      return;
    }
    sessionStorage.setItem("bcb-admin-key", keyInput);
    setAdminKey(keyInput);
    setKeyInput("");
  };

  const handleLogout = () => {
    sessionStorage.removeItem("bcb-admin-key");
    setAdminKey("");
    setKeyInput("");
  };

  const filtered = filter === "all" ? users : users.filter((u) => u.status === filter);
  const counts = {
    all: users.length,
    pending: users.filter((u) => u.status === "pending").length,
    active: users.filter((u) => u.status === "active").length,
    revoked: users.filter((u) => u.status === "revoked").length,
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-card border border-border/50 rounded-2xl p-6 space-y-4 font-mono">
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-amber-400" />
            <h1 className="text-sm font-semibold text-foreground">BCB Admin</h1>
          </div>
          <p className="text-[11px] text-muted-foreground/60">Enter the admin key to access the premium management panel.</p>
          <input
            type="password"
            autoFocus
            value={keyInput}
            onChange={(e) => { setKeyInput(e.target.value); setAuthError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="Admin key"
            className="w-full bg-background/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-amber-400/40 focus:ring-1 focus:ring-amber-400/10"
            data-testid="input-admin-key"
          />
          {authError && <p className="text-[10px] text-destructive">{authError}</p>}
          <button
            onClick={handleLogin}
            disabled={!keyInput}
            className="w-full py-2 rounded-lg bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400 disabled:opacity-40 transition-colors"
            data-testid="button-admin-login"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background font-mono">
      {/* Header */}
      <div className="border-b border-border/30 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-amber-400" />
          <span className="text-sm font-semibold text-foreground">BCB Admin — Premium Users</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-white/5 transition-colors"
            title="Refresh"
            data-testid="button-admin-refresh"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-white/5 text-[11px] transition-colors"
            data-testid="button-admin-logout"
          >
            <LogOut size={12} />
            Sign out
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-4">

        {/* Payment Config */}
        <PaymentConfigSection
          lightning={pcLightning} onLightning={setPcLightning}
          bch={pcBch} onBch={setPcBch}
          btc={pcBtc} onBtc={setPcBtc}
          liquid={pcLiquid} onLiquid={setPcLiquid}
          onSave={() => savePaymentConfig.mutate()}
          isPending={savePaymentConfig.isPending}
          isSaved={paymentSaved}
        />

        {/* Filter tabs */}
        <div className="flex items-center gap-1">
          {(["pending", "active", "revoked", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-mono font-semibold transition-colors ${
                filter === f
                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                  : "text-muted-foreground/50 hover:text-foreground hover:bg-white/5 border border-transparent"
              }`}
              data-testid={`tab-filter-${f}`}
            >
              {f} ({counts[f]})
            </button>
          ))}
        </div>

        {/* Status */}
        {isLoading && <p className="text-xs text-muted-foreground/50 py-8 text-center">Loading…</p>}
        {isError && <p className="text-xs text-destructive py-8 text-center">Failed to load. Check your admin key.</p>}

        {/* User cards */}
        {!isLoading && !isError && filtered.length === 0 && (
          <p className="text-xs text-muted-foreground/40 py-8 text-center">No {filter === "all" ? "" : filter} requests.</p>
        )}

        <div className="space-y-2">
          {filtered.map((u) => {
            const expanded = expandedId === u.id;
            const acting = approveMutation.isPending || revokeMutation.isPending;
            return (
              <div
                key={u.id}
                className="bg-card border border-border/40 rounded-xl overflow-hidden"
                data-testid={`card-premium-user-${u.id}`}
              >
                {/* Main row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-foreground font-semibold truncate" data-testid={`text-alias-${u.id}`}>{u.alias}</span>
                      {statusBadge(u.status)}
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50 flex-wrap">
                      <span data-testid={`text-email-${u.id}`}>{u.email}</span>
                      {paymentMethodBadge(u.paymentMethod)}
                      {u.paymentAmount && (
                        <span className="font-mono text-amber-300/80" data-testid={`text-amount-${u.id}`}>≈ {u.paymentAmount}</span>
                      )}
                      <span>submitted {fmt(u.createdAt)}</span>
                      {u.status === "active" && <span>expires {fmt(u.expiresAt)}</span>}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {u.status === "pending" && (
                      <button
                        onClick={() => approveMutation.mutate(u.id)}
                        disabled={acting}
                        className="px-3 py-1.5 rounded-lg bg-green-500/15 text-green-400 text-[11px] font-semibold hover:bg-green-500/25 disabled:opacity-40 transition-colors border border-green-500/20"
                        data-testid={`button-approve-${u.id}`}
                      >
                        Approve
                      </button>
                    )}
                    {u.status === "active" && (
                      <button
                        onClick={() => revokeMutation.mutate(u.id)}
                        disabled={acting}
                        className="px-3 py-1.5 rounded-lg bg-destructive/10 text-destructive text-[11px] font-semibold hover:bg-destructive/20 disabled:opacity-40 transition-colors border border-destructive/20"
                        data-testid={`button-revoke-${u.id}`}
                      >
                        Revoke
                      </button>
                    )}
                    {u.status === "revoked" && (
                      <button
                        onClick={() => approveMutation.mutate(u.id)}
                        disabled={acting}
                        className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400/70 text-[11px] font-semibold hover:bg-green-500/20 disabled:opacity-40 transition-colors border border-green-500/15"
                        data-testid={`button-reapprove-${u.id}`}
                      >
                        Re-approve
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedId(expanded ? null : u.id)}
                      className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-white/5 transition-colors"
                      data-testid={`button-expand-${u.id}`}
                    >
                      {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </div>
                </div>

                {/* Expanded detail */}
                {expanded && (
                  <div className="border-t border-border/30 px-4 py-3 space-y-3 bg-background/30">
                    {u.paymentNote && (
                      <div>
                        <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wide mb-1">Payment note</p>
                        <p className="text-xs text-foreground/80 leading-relaxed" data-testid={`text-note-${u.id}`}>{u.paymentNote}</p>
                      </div>
                    )}
                    {u.paymentProof ? (
                      <div>
                        <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wide mb-1">Payment proof</p>
                        <pre className="text-[11px] text-amber-300/80 bg-black/30 border border-amber-500/15 rounded-lg px-3 py-2 whitespace-pre-wrap break-all leading-relaxed" data-testid={`text-proof-${u.id}`}>{u.paymentProof}</pre>
                      </div>
                    ) : (
                      <div>
                        <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wide mb-1">Payment proof</p>
                        <p className="text-[11px] text-muted-foreground/30 italic">No payment proof provided</p>
                      </div>
                    )}
                    {u.status === "pending" && (
                      <button
                        onClick={() => approveMutation.mutate(u.id)}
                        disabled={acting}
                        className="w-full py-2 rounded-lg bg-green-500/15 text-green-400 text-xs font-semibold hover:bg-green-500/25 disabled:opacity-40 transition-colors border border-green-500/20"
                        data-testid={`button-approve-expanded-${u.id}`}
                      >
                        ✓ Approve and notify user by email
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
