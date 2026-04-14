import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Lock, Send, Bitcoin, CheckCircle, ExternalLink, X } from "lucide-react";
import type { PrivateMessage } from "@/hooks/use-private-messages";
import { useSendPrivateMessage } from "@/hooks/use-messages";
import type { useContacts } from "@/hooks/use-contacts";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import {
  parseBchPayMessage,
  parseBchPaySent,
  formatBchPayMessage,
  formatBchPaySent,
  formatPayUri,
  getActiveCurrency,
  setActiveCurrency,
  getStoredAddress,
  isLightningInvoice,
  CURRENCY_LABELS,
  CURRENCY_AMOUNT_UNIT,
  LIQUID_ASSET_LABELS,
  LIQUID_ASSET_UNITS,
  ALL_LIQUID_ASSETS,
  type BchPayRequest,
  type PaymentCurrency,
  type LiquidAsset,
} from "@/lib/bch";

const ALL_CURRENCIES: PaymentCurrency[] = ["bch", "btc", "lightning", "liquid"];

const LIQUID_ASSET_COLOR: Record<LiquidAsset, string> = {
  lbtc:  "border-sky-500/50   bg-sky-500/10   text-sky-400",
  usdt:  "border-teal-400/50  bg-teal-400/10  text-teal-300",
  depix: "border-green-500/50 bg-green-500/10 text-green-400",
  eurx:  "border-indigo-400/50 bg-indigo-400/10 text-indigo-300",
};

const CURRENCY_COLOR: Record<PaymentCurrency, string> = {
  bch:       "border-emerald-500/50 bg-emerald-500/10 text-emerald-400",
  btc:       "border-orange-500/50  bg-orange-500/10  text-orange-400",
  lightning: "border-amber-400/50   bg-amber-400/10   text-amber-300",
  liquid:    "border-sky-500/50     bg-sky-500/10     text-sky-400",
};

const CURRENCY_COLOR_INACTIVE = "border-white/8 bg-black/10 text-muted-foreground hover:border-white/20";

interface PrivateChatProps {
  contactAlias: string;
  myAlias: string;
  messages: PrivateMessage[];
  getSharedKey: ReturnType<typeof useContacts>["getSharedKey"];
  onAddSentDm: (contactAlias: string, content: string) => void;
  onMarkRead: (contactAlias: string) => void;
  onBack: () => void;
}

interface PayRequestFormState {
  amount: string;
  memo: string;
}

export function PrivateChat({
  contactAlias,
  myAlias,
  messages,
  getSharedKey,
  onAddSentDm,
  onMarkRead,
  onBack,
}: PrivateChatProps) {
  const [content, setContent] = useState("");
  const [showPayForm, setShowPayForm] = useState(false);
  const [payFormCurrency, setPayFormCurrency] = useState<PaymentCurrency>(getActiveCurrency);
  const [payFormLiquidAsset, setPayFormLiquidAsset] = useState<LiquidAsset>("lbtc");
  const [payForm, setPayForm] = useState<PayRequestFormState>({ amount: "", memo: "" });
  const [payFormError, setPayFormError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { mutate: sendDm, isPending } = useSendPrivateMessage(getSharedKey);
  const { toast } = useToast();

  // Track which requestIds have been "paid" (sent confirmation in this session)
  const [paidRequestIds, setPaidRequestIds] = useState<Set<string>>(new Set());

  // Live crypto prices (BCH + BTC in USD) — fetched only while form is open, refreshed every 60 s
  const { data: prices } = useQuery<{ bch: number; btc: number }>({
    queryKey: ["/api/prices"],
    enabled: showPayForm,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    onMarkRead(contactAlias);
  }, [contactAlias, onMarkRead]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Build a set of requestIds that have a BCB-PAY-SENT confirmation in the thread
  const sentConfirmationIds = new Set<string>();
  for (const msg of messages) {
    const sentId = parseBchPaySent(msg.content);
    if (sentId) sentConfirmationIds.add(sentId);
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || isPending) return;

    // Add the optimistic copy BEFORE the send so it is already in the thread
    // when the SSE echo arrives — preventing a duplicate from being appended.
    onAddSentDm(contactAlias, trimmed);
    setContent("");

    sendDm(
      { contactAlias, content: trimmed, myAlias },
      {
        onError: (err) => {
          toast({
            title: "Message not sent",
            description: err instanceof Error ? err.message : "Failed to transmit",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleSendPayRequest = () => {
    const c = payFormCurrency;
    const la = payFormLiquidAsset;
    const myAddress = getStoredAddress(c);
    const invoiceMode = c === "lightning" && !!myAddress && isLightningInvoice(myAddress);
    // Amount is optional for Lightning (both invoice and address); required for others
    const skipAmount = c === "lightning";
    const amountNum = parseFloat(payForm.amount);
    const amountUnit = c === "liquid" ? LIQUID_ASSET_UNITS[la] : CURRENCY_AMOUNT_UNIT[c];
    if (!skipAmount && (!payForm.amount || isNaN(amountNum) || amountNum <= 0)) {
      setPayFormError(`Please enter a valid amount in ${amountUnit}`);
      return;
    }

    if (!myAddress) {
      setPayFormError(`No ${CURRENCY_LABELS[c]} address set. Open the Wallet panel and add one first.`);
      return;
    }

    // For Lightning invoices the amount is embedded — store 0.
    // For Lightning addresses with a provided amount, store the sats value.
    const finalAmount = invoiceMode ? 0 : (!payForm.amount || isNaN(amountNum)) ? 0 : amountNum;

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const payload: BchPayRequest = {
      to: contactAlias,
      from: myAlias,
      address: myAddress,
      amountBCH: finalAmount,
      memo: payForm.memo.trim(),
      requestId,
      currency: c,
      ...(c === "liquid" ? { liquidAsset: la } : {}),
    };

    const msgContent = formatBchPayMessage(payload);

    onAddSentDm(contactAlias, msgContent);
    setShowPayForm(false);
    setPayForm({ amount: "", memo: "" });
    setPayFormError(null);

    sendDm(
      { contactAlias, content: msgContent, myAlias },
      {
        onError: (err) => {
          toast({
            title: "Request not sent",
            description: err instanceof Error ? err.message : "Failed to transmit",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handlePayNow = (payReq: BchPayRequest) => {
    const c: PaymentCurrency = (payReq.currency as PaymentCurrency) ?? "bch";
    const la = (payReq.liquidAsset as LiquidAsset | undefined) ?? "lbtc";
    const uri = formatPayUri(c, payReq.address, payReq.amountBCH || undefined, payReq.memo || undefined, la);
    window.open(uri, "_blank");

    // Send a "payment sent" confirmation back
    const sentMsg = formatBchPaySent(payReq.requestId);
    onAddSentDm(contactAlias, sentMsg);
    setPaidRequestIds((prev) => { const s = new Set(Array.from(prev)); s.add(payReq.requestId); return s; });

    sendDm(
      { contactAlias, content: sentMsg, myAlias },
      { onError: () => {} }
    );
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const renderMessage = (msg: PrivateMessage) => {
    // Check if it's a BCH pay-sent confirmation
    const sentId = parseBchPaySent(msg.content);
    if (sentId !== null) {
      return (
        <div
          key={msg.id}
          className={`flex ${msg.mine ? "justify-end" : "justify-start"}`}
          data-testid={`dm-message-${msg.id}`}
        >
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-400/10 border border-green-400/20 rounded-full">
            <CheckCircle size={12} className="text-green-400" />
            <span className="text-[11px] font-mono text-green-400/80">
              {msg.mine ? "Payment sent" : `${msg.senderAlias} sent payment`}
            </span>
            <span className="text-[10px] text-muted-foreground/40">{formatTime(msg.timestamp)}</span>
          </div>
        </div>
      );
    }

    // Check if it's a BCH payment request
    const payReq = parseBchPayMessage(msg.content);
    if (payReq !== null) {
      const isPaid = sentConfirmationIds.has(payReq.requestId) || paidRequestIds.has(payReq.requestId);
      const isIncoming = !msg.mine;
      return (
        <div
          key={msg.id}
          className={`flex ${msg.mine ? "justify-end" : "justify-start"}`}
          data-testid={`dm-message-${msg.id}`}
        >
          <div className="max-w-[85%] rounded-2xl border bg-background/70 border-primary/30 overflow-hidden">
            {/* Card header */}
            {(() => {
              const cardCurrency = (payReq.currency as PaymentCurrency) ?? "bch";
              const cardLa = (payReq.liquidAsset as LiquidAsset | undefined) ?? "lbtc";
              const cardLabel = cardCurrency === "liquid"
                ? `Liquid ${LIQUID_ASSET_LABELS[cardLa]}`
                : CURRENCY_LABELS[cardCurrency];
              const cardAmountUnit = cardCurrency === "liquid"
                ? LIQUID_ASSET_UNITS[cardLa]
                : CURRENCY_AMOUNT_UNIT[cardCurrency];
              return (
                <>
                  <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b border-primary/20">
                    <Bitcoin size={13} className="text-primary" />
                    <span className="text-[11px] font-mono text-primary uppercase tracking-wide font-semibold">
                      {cardLabel} Payment Request
                    </span>
                  </div>
                  {/* Card body */}
                  <div className="px-3 py-2.5 space-y-1.5">
                    {!msg.mine && (
                      <p className="text-[10px] font-mono text-primary/70">
                        From {payReq.from}
                      </p>
                    )}
                    {payReq.amountBCH > 0 && (
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xl font-mono font-bold text-foreground">{payReq.amountBCH}</span>
                        <span className="text-sm font-mono text-muted-foreground/60">{cardAmountUnit}</span>
                      </div>
                    )}
                    {payReq.memo && (
                      <p className="text-xs text-muted-foreground/70 italic">{payReq.memo}</p>
                    )}
                    <p className="text-[9px] font-mono text-muted-foreground/30 break-all">
                      {payReq.address.length > 30
                        ? `${payReq.address.slice(0, 16)}…${payReq.address.slice(-10)}`
                        : payReq.address}
                    </p>
                  </div>
                  {/* Footer */}
                  <div className="px-3 py-2 border-t border-white/5 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground/40">{formatTime(msg.timestamp)}</span>
                    {isIncoming ? (
                      isPaid ? (
                        <div className="flex items-center gap-1.5 text-green-400/80">
                          <CheckCircle size={12} />
                          <span className="text-[11px] font-mono">Paid</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => handlePayNow(payReq)}
                          className="flex items-center gap-1.5 px-3 py-1 bg-primary/20 hover:bg-primary/30 text-primary rounded-lg text-xs font-mono transition-colors"
                          data-testid={`button-pay-now-${payReq.requestId}`}
                        >
                          <ExternalLink size={11} />
                          Pay Now
                        </button>
                      )
                    ) : (
                      isPaid ? (
                        <div className="flex items-center gap-1.5 text-green-400/80">
                          <CheckCircle size={12} />
                          <span className="text-[11px] font-mono">Payment received</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/40 font-mono">Awaiting payment…</span>
                      )
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      );
    }

    // Regular message
    return (
      <div
        key={msg.id}
        className={`flex ${msg.mine ? "justify-end" : "justify-start"}`}
        data-testid={`dm-message-${msg.id}`}
      >
        <div
          className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${
            msg.mine
              ? "bg-primary/20 text-foreground rounded-br-sm"
              : "bg-background/60 text-foreground border border-white/5 rounded-bl-sm"
          }`}
        >
          {!msg.mine && (
            <p className="text-[10px] font-mono text-primary/70 mb-0.5">
              {msg.senderAlias}
            </p>
          )}
          <p className="text-sm leading-relaxed break-words">{msg.content}</p>
          <p className="text-[10px] text-muted-foreground/40 mt-0.5 text-right">
            {formatTime(msg.timestamp)}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="absolute inset-0 z-20 glass-panel rounded-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/5">
        <button
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-back-to-contacts"
        >
          <ArrowLeft size={16} />
        </button>
        <Lock size={13} className="text-primary" />
        <span className="text-sm font-mono font-semibold text-foreground flex-1">
          {contactAlias}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-widest">
          E2E Encrypted
        </span>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground/40 font-mono text-center gap-3">
            <Lock size={32} className="opacity-20" />
            <div>
              <p className="text-xs uppercase tracking-wide mb-1">Secure channel ready</p>
              <p className="text-[10px] opacity-60">
                Messages are encrypted end-to-end with AES-256-GCM.
                <br />Only you and {contactAlias} can read them.
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg) => renderMessage(msg))
        )}
      </div>

      {/* Payment Request Form */}
      {showPayForm && (() => {
        const c = payFormCurrency;
        const la = payFormLiquidAsset;
        const storedAddr = getStoredAddress(c) ?? "";
        const hideAmount = c === "lightning" && isLightningInvoice(storedAddr);
        const amountUnit = c === "liquid" ? LIQUID_ASSET_UNITS[la] : CURRENCY_AMOUNT_UNIT[c];
        const amountStep = c === "lightning" ? "1" : "0.00000001";
        const amountPlaceholder = c === "lightning"
          ? `Amount (${amountUnit}) — optional`
          : `Amount (${amountUnit})`;

        // USD estimate — only for assets priced against BTC/BCH; stablecoins skip it
        let usdEstimate: string | null = null;
        const amtNum = parseFloat(payForm.amount);
        if (!hideAmount && payForm.amount && !isNaN(amtNum) && amtNum > 0 && prices) {
          let usd = 0;
          if (c === "bch") usd = amtNum * prices.bch;
          else if (c === "btc") usd = amtNum * prices.btc;
          else if (c === "liquid" && la === "lbtc") usd = amtNum * prices.btc;
          else if (c === "lightning") usd = (amtNum / 100_000_000) * prices.btc;
          if (usd > 0) {
            usdEstimate = usd < 0.01
              ? `< $0.01 USDt`
              : `≈ $${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDt`;
          }
        }

        const handleCurrencySwitch = (next: PaymentCurrency) => {
          setPayFormCurrency(next);
          setActiveCurrency(next);
          setPayForm({ amount: "", memo: "" });
          setPayFormError(null);
        };

        return (
          <div className="border-t border-white/5 bg-background/40 p-3 space-y-2">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bitcoin size={13} className="text-primary" />
                <span className="text-xs font-mono text-primary uppercase tracking-wide">
                  Payment Request
                </span>
              </div>
              <button
                onClick={() => { setShowPayForm(false); setPayFormError(null); setPayForm({ amount: "", memo: "" }); }}
                className="text-muted-foreground/50 hover:text-foreground transition-colors"
                data-testid="button-close-pay-form"
              >
                <X size={14} />
              </button>
            </div>

            {/* Currency selector */}
            <div className="grid grid-cols-4 gap-1" data-testid="pay-currency-selector">
              {ALL_CURRENCIES.map((cur) => (
                <button
                  key={cur}
                  onClick={() => handleCurrencySwitch(cur)}
                  className={`py-1.5 rounded-lg border text-[10px] font-mono font-semibold transition-all ${
                    c === cur ? CURRENCY_COLOR[cur] : CURRENCY_COLOR_INACTIVE
                  }`}
                  data-testid={`button-pay-currency-${cur}`}
                >
                  {CURRENCY_LABELS[cur]}
                </button>
              ))}
            </div>

            {/* Liquid asset sub-selector */}
            {c === "liquid" && (
              <div className="grid grid-cols-4 gap-1" data-testid="pay-liquid-asset-selector">
                {ALL_LIQUID_ASSETS.map((asset) => (
                  <button
                    key={asset}
                    onClick={() => { setPayFormLiquidAsset(asset); setPayForm({ amount: "", memo: "" }); setPayFormError(null); }}
                    className={`py-1 rounded-lg border text-[10px] font-mono font-semibold transition-all ${
                      la === asset ? LIQUID_ASSET_COLOR[asset] : CURRENCY_COLOR_INACTIVE
                    }`}
                    data-testid={`button-pay-liquid-asset-${asset}`}
                  >
                    {LIQUID_ASSET_LABELS[asset]}
                  </button>
                ))}
              </div>
            )}

            {/* Amount + memo row */}
            <div className="flex gap-2">
              {!hideAmount && (
                <div className="flex-1 flex flex-col gap-0.5">
                  <input
                    type="number"
                    step={amountStep}
                    min="0"
                    value={payForm.amount}
                    onChange={(e) => { setPayForm((p) => ({ ...p, amount: e.target.value })); setPayFormError(null); }}
                    placeholder={amountPlaceholder}
                    className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40"
                    data-testid="input-pay-amount"
                  />
                  {usdEstimate && (
                    <span className="text-[10px] font-mono text-muted-foreground/50 pl-1" data-testid="text-usd-estimate">
                      {usdEstimate}
                    </span>
                  )}
                </div>
              )}
              <input
                type="text"
                value={payForm.memo}
                onChange={(e) => setPayForm((p) => ({ ...p, memo: e.target.value }))}
                placeholder="Note (optional)"
                maxLength={80}
                className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40"
                data-testid="input-pay-memo"
              />
            </div>

            {payFormError && (
              <p className="text-[10px] font-mono text-destructive" data-testid="text-pay-form-error">{payFormError}</p>
            )}
            <button
              onClick={handleSendPayRequest}
              disabled={isPending}
              className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-mono font-semibold transition-colors disabled:opacity-40 border ${CURRENCY_COLOR[c]}`}
              data-testid="button-send-pay-request"
            >
              <Bitcoin size={13} />
              Request {c === "liquid" ? `Liquid ${LIQUID_ASSET_LABELS[la]}` : CURRENCY_LABELS[c]}
            </button>
          </div>
        );
      })()}

      {/* Input */}
      <div className="p-3 border-t border-white/5">
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 bg-background/50 border border-white/10 rounded-xl px-3 focus-within:border-primary/50 transition-all duration-300"
        >
          <Lock size={12} className="text-primary/40 flex-shrink-0" />
          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={`Message ${contactAlias}…`}
            disabled={isPending}
            className="flex-1 bg-transparent border-none py-3.5 text-sm focus:outline-none text-foreground placeholder:text-muted-foreground/40 font-mono"
            data-testid="input-dm-message"
          />
          <button
            type="button"
            onClick={() => setShowPayForm((v) => !v)}
            title={`Payment request (${CURRENCY_LABELS[payFormCurrency]})`}
            className={`p-1.5 rounded-lg transition-all duration-200 ${
              showPayForm
                ? "bg-primary text-primary-foreground"
                : "bg-primary/10 text-primary hover:bg-primary/20"
            }`}
            data-testid="button-toggle-pay-form"
          >
            <Bitcoin size={15} />
          </button>
          <button
            type="submit"
            disabled={!content.trim() || isPending}
            className="p-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-30 transition-all duration-200"
            data-testid="button-send-dm"
          >
            <Send size={15} className={isPending ? "animate-pulse" : ""} />
          </button>
        </form>
      </div>
    </div>
  );
}
