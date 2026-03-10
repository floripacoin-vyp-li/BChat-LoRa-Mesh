import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Lock, Send } from "lucide-react";
import type { PrivateMessage } from "@/hooks/use-private-messages";
import { useSendPrivateMessage } from "@/hooks/use-messages";
import type { useContacts } from "@/hooks/use-contacts";
import { useToast } from "@/hooks/use-toast";

interface PrivateChatProps {
  contactAlias: string;
  myAlias: string;
  messages: PrivateMessage[];
  getSharedKey: ReturnType<typeof useContacts>["getSharedKey"];
  onAddSentDm: (contactAlias: string, content: string) => void;
  onMarkRead: (contactAlias: string) => void;
  onBack: () => void;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const { mutate: sendDm, isPending } = useSendPrivateMessage(getSharedKey);
  const { toast } = useToast();

  useEffect(() => {
    onMarkRead(contactAlias);
  }, [contactAlias, onMarkRead]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || isPending) return;

    sendDm(
      { contactAlias, content: trimmed, myAlias },
      {
        onSuccess: () => {
          onAddSentDm(contactAlias, trimmed);
          setContent("");
        },
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

  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
          messages.map((msg) => (
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
          ))
        )}
      </div>

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
