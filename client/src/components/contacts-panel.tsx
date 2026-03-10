import { useState } from "react";
import { X, Copy, Plus, Trash2, MessageSquareLock, Check, ChevronRight } from "lucide-react";
import type { Contact } from "@/hooks/use-contacts";

interface ContactsPanelProps {
  contacts: Contact[];
  myPublicKeyBase64: string | null;
  unreadCounts: Record<string, number>;
  onAddContact: (alias: string, publicKeyBase64: string) => Promise<void>;
  onRemoveContact: (alias: string) => void;
  onOpenChat: (contactAlias: string) => void;
  onClose: () => void;
}

export function ContactsPanel({
  contacts,
  myPublicKeyBase64,
  unreadCounts,
  onAddContact,
  onRemoveContact,
  onOpenChat,
  onClose,
}: ContactsPanelProps) {
  const [newAlias, setNewAlias] = useState("");
  const [newKey, setNewKey] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyKey = () => {
    if (!myPublicKeyBase64) return;
    navigator.clipboard.writeText(myPublicKeyBase64).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleAdd = async () => {
    setAddError(null);
    setIsAdding(true);
    try {
      await onAddContact(newAlias.trim(), newKey.trim());
      setNewAlias("");
      setNewKey("");
      setShowAddForm(false);
    } catch (e: any) {
      setAddError(e.message ?? "Invalid key");
    } finally {
      setIsAdding(false);
    }
  };

  const truncateKey = (key: string) =>
    key.length > 24 ? `${key.slice(0, 12)}…${key.slice(-8)}` : key;

  return (
    <div className="absolute inset-0 z-20 glass-panel rounded-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
        <div className="flex items-center gap-2">
          <MessageSquareLock size={16} className="text-primary" />
          <span className="text-sm font-mono font-semibold tracking-wide uppercase text-foreground">
            Secure Contacts
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-close-contacts"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-5">
        {/* My Identity */}
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60 mb-2">
            Your Public Key
          </p>
          <div className="bg-background/50 border border-white/10 rounded-xl p-3 space-y-2">
            <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
              Share this key with someone to enable encrypted private messaging.
            </p>
            {myPublicKeyBase64 ? (
              <>
                <div className="font-mono text-[10px] text-muted-foreground/70 break-all leading-relaxed bg-black/20 rounded-lg p-2 max-h-20 overflow-y-auto">
                  {myPublicKeyBase64}
                </div>
                <button
                  onClick={handleCopyKey}
                  className="flex items-center gap-1.5 text-xs font-mono text-primary hover:text-primary/80 transition-colors"
                  data-testid="button-copy-my-key"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "Copied!" : "Copy key"}
                </button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground/40 font-mono animate-pulse">
                Generating key pair…
              </p>
            )}
          </div>
        </div>

        {/* Contacts list */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
              Contacts ({contacts.length})
            </p>
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className="flex items-center gap-1 text-[10px] font-mono text-primary hover:text-primary/80 transition-colors uppercase tracking-wide"
              data-testid="button-toggle-add-contact"
            >
              <Plus size={11} />
              Add
            </button>
          </div>

          {/* Add contact form */}
          {showAddForm && (
            <div className="bg-background/50 border border-primary/20 rounded-xl p-3 mb-3 space-y-2">
              <input
                type="text"
                placeholder="Their alias..."
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                maxLength={24}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40"
                data-testid="input-contact-alias"
              />
              <textarea
                placeholder="Paste their public key..."
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                rows={3}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 resize-none"
                data-testid="input-contact-key"
              />
              {addError && (
                <p className="text-[10px] font-mono text-destructive">{addError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleAdd}
                  disabled={isAdding || !newAlias.trim() || !newKey.trim()}
                  className="flex-1 bg-primary/20 hover:bg-primary/30 text-primary text-xs font-mono py-1.5 rounded-lg transition-colors disabled:opacity-40"
                  data-testid="button-add-contact-confirm"
                >
                  {isAdding ? "Verifying…" : "Add Contact"}
                </button>
                <button
                  onClick={() => { setShowAddForm(false); setAddError(null); }}
                  className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors px-3"
                  data-testid="button-add-contact-cancel"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Contact rows */}
          {contacts.length === 0 ? (
            <p className="text-xs font-mono text-muted-foreground/40 text-center py-6">
              No contacts yet — add someone to start a private chat
            </p>
          ) : (
            <div className="space-y-1.5">
              {contacts.map((c) => {
                const unread = unreadCounts[c.alias] ?? 0;
                return (
                  <div
                    key={c.alias}
                    className="flex items-center gap-3 bg-background/40 hover:bg-background/60 border border-white/5 rounded-xl px-3 py-2.5 transition-colors group"
                    data-testid={`row-contact-${c.alias}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-foreground font-medium truncate">
                          {c.alias}
                        </span>
                        {unread > 0 && (
                          <span className="bg-primary text-primary-foreground text-[10px] font-mono px-1.5 py-0.5 rounded-full">
                            {unread}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground/40">
                        {truncateKey(c.publicKeyBase64)}
                      </span>
                    </div>
                    <button
                      onClick={() => onOpenChat(c.alias)}
                      className="text-primary hover:text-primary/80 transition-colors"
                      title="Open private chat"
                      data-testid={`button-open-chat-${c.alias}`}
                    >
                      <ChevronRight size={16} />
                    </button>
                    <button
                      onClick={() => onRemoveContact(c.alias)}
                      className="text-muted-foreground/30 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                      title="Remove contact"
                      data-testid={`button-remove-contact-${c.alias}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
