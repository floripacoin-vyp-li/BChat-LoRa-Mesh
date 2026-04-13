import { UserPlus, X, ShieldCheck } from "lucide-react";
import type { PendingContactRequest } from "@/hooks/use-contact-requests";

interface Props {
  requests: PendingContactRequest[];
  onAccept: (req: PendingContactRequest) => void;
  onIgnore: (req: PendingContactRequest) => void;
}

export function ContactRequestNotification({ requests, onAccept, onIgnore }: Props) {
  if (requests.length === 0) return null;

  return (
    <div className="absolute bottom-4 right-4 z-50 flex flex-col gap-2 max-w-xs w-full">
      {requests.map((req) => (
        <div
          key={req.messageId}
          className="bg-card border border-primary/30 rounded-xl p-3 shadow-lg shadow-black/40 flex flex-col gap-2 animate-in slide-in-from-bottom-2"
          data-testid={`contact-request-${req.fromAlias}`}
        >
          <div className="flex items-start gap-2">
            <ShieldCheck size={14} className="text-primary mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono text-foreground leading-snug">
                <span className="text-primary font-semibold">{req.fromAlias}</span>
                {" "}wants to start a private chat with you.
              </p>
              <p className="text-[10px] font-mono text-muted-foreground/60 mt-0.5">
                Accept to exchange encrypted messages
              </p>
            </div>
            <button
              onClick={() => onIgnore(req)}
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors flex-shrink-0"
              data-testid={`button-ignore-request-${req.fromAlias}`}
              title="Ignore"
            >
              <X size={13} />
            </button>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onAccept(req)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary rounded-lg text-xs font-mono transition-colors"
              data-testid={`button-accept-request-${req.fromAlias}`}
            >
              <UserPlus size={11} />
              Accept
            </button>
            <button
              onClick={() => onIgnore(req)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-background/50 hover:bg-white/5 border border-white/10 text-muted-foreground rounded-lg text-xs font-mono transition-colors"
              data-testid={`button-decline-request-${req.fromAlias}`}
            >
              Ignore
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
