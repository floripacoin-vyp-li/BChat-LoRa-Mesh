import { format } from "date-fns";
import { motion } from "framer-motion";
import { RadioTower, User, Cpu } from "lucide-react";
import type { Message } from "@shared/schema";

interface ChatMessageProps {
  message: Message;
  myAlias: string;
}

export function ChatMessage({ message, myAlias }: ChatMessageProps) {
  const isSystem = message.sender === "system";
  const isUser = message.sender === myAlias || message.sender === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex w-full gap-3 ${isUser ? "justify-end" : "justify-start"} mb-4`}
    >
      {!isUser && (
        <div className="flex-shrink-0 mt-1">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
            isSystem
              ? "bg-secondary border-muted-foreground/30 text-muted-foreground"
              : "bg-primary/10 border-primary/30 text-primary tech-glow"
          }`}>
            {isSystem ? <Cpu size={16} /> : <RadioTower size={16} />}
          </div>
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
