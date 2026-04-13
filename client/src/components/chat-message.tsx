import { useState, useRef, useEffect } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { RadioTower, User, Cpu, Trash2, MessageSquareLock, UserPlus, Loader2, Check } from "lucide-react";
import type { Message } from "@shared/schema";

interface ChatMessageProps {
  message: Message;
  myAlias: string;
  isContact?: boolean;
  onDelete?: (id: number) => void;
  onQuickAddContact?: (alias: string) => Promise<void>;
  onOpenChat?: (alias: string) => void;
}

export function ChatMessage({
  message,
  myAlias,
  isContact = false,
  onDelete,
  onQuickAddContact,
  onOpenChat,
}: ChatMessageProps) {
  const isSystem = message.sender === "system";
  const isUser = message.sender === myAlias || message.sender === "user";

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
        setAddError(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [popoverOpen]);

  const handleIconClick = () => {
    if (isSystem || isUser) return;
    setPopoverOpen((v) => !v);
    setAddError(null);
    setAdded(false);
  };

  const handleAdd = async () => {
    if (!onQuickAddContact) return;
    setAdding(true);
    setAddError(null);
    try {
      await onQuickAddContact(message.sender);
      setAdded(true);
      setTimeout(() => setPopoverOpen(false), 1200);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to add contact");
    } finally {
      setAdding(false);
    }
  };

  const handleOpenChat = () => {
    setPopoverOpen(false);
    onOpenChat?.(message.sender);
  };

  const canInteract = !isSystem && !isUser && (onQuickAddContact || onOpenChat);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex w-full gap-3 ${isUser ? "justify-end" : "justify-start"} mb-4`}
    >
      {!isUser && (
        <div className="flex-shrink-0 mt-1 relative" ref={popoverRef}>
          <button
            onClick={handleIconClick}
            disabled={!canInteract}
            title={canInteract ? (isContact ? "Open private chat" : "Add to private chats") : undefined}
            data-testid={`button-sender-icon-${message.sender}`}
            className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-all
              ${isSystem
                ? "bg-secondary border-muted-foreground/30 text-muted-foreground cursor-default"
                : canInteract
                  ? "bg-primary/10 border-primary/30 text-primary tech-glow hover:bg-primary/20 hover:border-primary/60 cursor-pointer"
                  : "bg-primary/10 border-primary/30 text-primary tech-glow cursor-default"
              }`}
          >
            {isSystem ? <Cpu size={16} /> : <RadioTower size={16} />}
          </button>

          {popoverOpen && canInteract && (
            <div className="absolute left-10 top-0 z-50 w-48 bg-card border border-white/10 rounded-xl shadow-xl p-3 space-y-2">
              <p className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wide truncate">
                {message.sender}
              </p>

              {isContact || added ? (
                <button
                  onClick={handleOpenChat}
                  className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-primary/20 hover:bg-primary/30 text-primary rounded-lg text-xs font-mono transition-colors"
                  data-testid={`button-open-chat-${message.sender}`}
                >
                  <MessageSquareLock size={12} />
                  {added ? "Added! Open Chat" : "Open Private Chat"}
                </button>
              ) : (
                <button
                  onClick={handleAdd}
                  disabled={adding}
                  className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-xs font-mono transition-colors disabled:opacity-50"
                  data-testid={`button-add-contact-quick-${message.sender}`}
                >
                  {adding ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : added ? (
                    <Check size={12} className="text-green-400" />
                  ) : (
                    <UserPlus size={12} />
                  )}
                  {adding ? "Adding…" : "Add to Private Chats"}
                </button>
              )}

              {addError && (
                <p className="text-[10px] font-mono text-destructive leading-tight">{addError}</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className={`flex flex-col max-w-[80%] ${isUser ? "items-end" : "items-start"}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-mono tracking-wider uppercase text-muted-foreground">
            {isUser && message.sender === "user" ? myAlias : message.sender}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground/50">
            {message.timestamp ? format(new Date(message.timestamp), "HH:mm:ss") : "--:--:--"}
          </span>
          {isUser && onDelete && message.id > 0 && (
            <button
              onClick={() => onDelete(message.id)}
              className="text-primary-foreground/30 hover:text-destructive transition-colors p-0.5 rounded"
              title="Delete message"
              data-testid={`button-delete-msg-${message.id}`}
            >
              <Trash2 size={10} />
            </button>
          )}
        </div>

        <div className={`
          px-4 py-3 rounded-2xl text-sm
          ${isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : isSystem
              ? "bg-secondary text-secondary-foreground border border-white/5 rounded-tl-sm font-mono text-xs"
              : "bg-card border border-primary/20 text-card-foreground rounded-tl-sm shadow-[0_0_15px_rgba(0,255,102,0.05)]"
          }
        `}>
          {message.content}
        </div>
      </div>

      {isUser && (
        <div className="flex-shrink-0 mt-1">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-accent border border-white/5 text-foreground" title={myAlias}>
            <User size={16} />
          </div>
        </div>
      )}
    </motion.div>
  );
}
