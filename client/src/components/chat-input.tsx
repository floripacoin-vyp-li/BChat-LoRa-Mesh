import { useState, useRef, useEffect } from "react";
import { Send, Terminal, Pencil, Check, X } from "lucide-react";
import { useSendMessage } from "@/hooks/use-messages";
import { useToast } from "@/hooks/use-toast";

interface ChatInputProps {
  isConnected: boolean;
  isOnline: boolean;
  alias: string;
  onAliasChange: (newAlias: string) => void;
}

export function ChatInput({ isConnected, isOnline, alias, onAliasChange }: ChatInputProps) {
  const [content, setContent] = useState("");
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasInput, setAliasInput] = useState(alias);
  const { mutate: sendMessage, isPending } = useSendMessage();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const aliasInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isConnected && !editingAlias) {
      inputRef.current?.focus();
    }
  }, [isConnected, editingAlias]);

  useEffect(() => {
    if (editingAlias) {
      aliasInputRef.current?.focus();
      aliasInputRef.current?.select();
    }
  }, [editingAlias]);

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

  const commitAlias = () => {
    const trimmed = aliasInput.trim().slice(0, 24);
    if (trimmed.length >= 2) {
      onAliasChange(trimmed);
    } else {
      setAliasInput(alias);
    }
    setEditingAlias(false);
  };

  const cancelAlias = () => {
    setAliasInput(alias);
    setEditingAlias(false);
  };

  return (
    <div className="p-4 glass-panel border-t-0 rounded-b-2xl">
      {/* Alias bar */}
      <div className="flex items-center gap-2 mb-2 px-1">
        <Terminal size={12} className="text-muted-foreground/50" />
        {editingAlias ? (
          <div className="flex items-center gap-1.5 flex-1">
            <input
              ref={aliasInputRef}
              type="text"
              value={aliasInput}
              maxLength={24}
              onChange={(e) => setAliasInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitAlias();
                if (e.key === "Escape") cancelAlias();
              }}
              className="bg-background/50 border border-primary/40 rounded px-2 py-0.5 text-xs font-mono text-primary focus:outline-none w-36"
              data-testid="input-alias-edit"
            />
            <button onClick={commitAlias} className="text-primary hover:text-primary/80 transition-colors" data-testid="button-alias-confirm">
              <Check size={13} />
            </button>
            <button onClick={cancelAlias} className="text-muted-foreground hover:text-foreground transition-colors" data-testid="button-alias-cancel">
              <X size={13} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setAliasInput(alias); setEditingAlias(true); }}
            className="flex items-center gap-1.5 group"
            title="Edit your alias"
            data-testid="button-edit-alias"
          >
            <span className="text-xs font-mono text-primary tracking-wide">{alias}</span>
            <Pencil size={10} className="text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
          </button>
        )}
      </div>

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
          placeholder={!isOnline && !isConnected ? "Connect BLE radio to transmit..." : "Transmit message..."}
          disabled={isPending || editingAlias || (!isOnline && !isConnected)}
          className="flex-1 bg-transparent border-none px-2 py-4 text-sm focus:outline-none focus:ring-0 disabled:opacity-50 text-foreground placeholder:text-muted-foreground/50 font-mono"
          data-testid="input-message"
        />

        <div className="pr-2">
          <button
            type="submit"
            disabled={!content.trim() || isPending || (!isOnline && !isConnected)}
            title={!isOnline && !isConnected ? "Connect a BLE radio to transmit offline" : undefined}
            className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-30 disabled:hover:bg-primary/10 disabled:hover:text-primary transition-all duration-200"
            data-testid="button-send"
          >
            <Send size={18} className={isPending ? "animate-pulse" : ""} />
          </button>
        </div>
      </form>
    </div>
  );
}
