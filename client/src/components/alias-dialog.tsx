import { useState } from "react";
import { UserCheck, Shuffle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface AliasDialogProps {
  open: boolean;
  onConfirm: (alias: string) => Promise<"ok" | "taken">;
  onSkip: () => string;
}

export function AliasDialog({ open, onConfirm, onSkip }: AliasDialogProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setError("Alias must be at least 2 characters.");
      return;
    }
    setLoading(true);
    setError("");
    const result = await onConfirm(trimmed);
    setLoading(false);
    if (result === "taken") {
      setError("This alias is already taken. Please choose another.");
    }
  };

  const handleSkip = () => {
    const generated = onSkip();
    setValue(generated);
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="bg-card border-border/50 font-mono max-w-sm"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <UserCheck size={18} className="text-primary" />
            Set your alias
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs leading-relaxed">
            Choose a handle that other users will see next to your messages. You can change it later.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={value}
              maxLength={24}
              onChange={(e) => { setValue(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleConfirm()}
              placeholder="e.g. AlphaNode"
              className="flex-1 bg-background/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
              data-testid="input-alias"
            />
            <button
              type="button"
              onClick={handleSkip}
              disabled={loading}
              title="Generate a random alias"
              className="px-3 py-2 rounded-lg border border-white/10 text-muted-foreground hover:bg-primary/10 hover:border-primary/30 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              data-testid="button-random-alias"
            >
              <Shuffle size={15} />
            </button>
          </div>

          {error && (
            <p className="text-xs text-destructive font-mono" data-testid="text-alias-error">{error}</p>
          )}

          <button
            onClick={handleConfirm}
            disabled={!value.trim() || loading}
            className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            data-testid="button-confirm-alias"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? "Checking..." : "Confirm alias"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
