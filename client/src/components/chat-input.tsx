import { useState, useRef, useEffect } from "react";
import { Send, Terminal } from "lucide-react";
import { useSendMessage } from "@/hooks/use-messages";

interface ChatInputProps {
  isConnected: boolean;
}

export function ChatInput({ isConnected }: ChatInputProps) {
  const [content, setContent] = useState("");
  const { mutate: sendMessage, isPending } = useSendMessage();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Keep focus when connected
    if (isConnected) {
      inputRef.current?.focus();
    }
  }, [isConnected]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !isConnected || isPending) return;

    sendMessage({ content: content.trim(), sender: "user" }, {
      onSuccess: () => setContent("")
    });
  };

  return (
    <div className="p-4 glass-panel border-t-0 rounded-b-2xl">
      <form 
        onSubmit={handleSubmit}
        className="relative flex items-center bg-background/50 border border-white/10 rounded-xl overflow-hidden focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all duration-300"
      >
        <div className="pl-4 pr-2 text-muted-foreground">
          <Terminal size={18} />
        </div>
        
        <input
          ref={inputRef}
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={isConnected ? "Transmit message..." : "Connect to Meshtastic to transmit"}
          disabled={!isConnected || isPending}
          className="flex-1 bg-transparent border-none px-2 py-4 text-sm focus:outline-none focus:ring-0 disabled:opacity-50 text-foreground placeholder:text-muted-foreground/50 font-mono"
        />
        
        <div className="pr-2">
          <button
            type="submit"
            disabled={!content.trim() || !isConnected || isPending}
            className="p-2 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-30 disabled:hover:bg-primary/10 disabled:hover:text-primary transition-all duration-200"
          >
            <Send size={18} className={isPending ? "animate-pulse" : ""} />
          </button>
        </div>
      </form>
      
      <div className="mt-2 flex justify-between items-center px-2 text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest">
        <span>Channel: Primary</span>
        <span>Freq: 915.0 MHz (LoRa)</span>
      </div>
    </div>
  );
}
