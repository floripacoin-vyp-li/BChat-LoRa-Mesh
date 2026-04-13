import { ShieldAlert } from "lucide-react";

interface Props {
  obscured: boolean;
}

export function ScreenshotGuard({ obscured }: Props) {
  if (!obscured) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center gap-4 select-none"
      aria-hidden="true"
      data-testid="screenshot-guard-overlay"
    >
      <ShieldAlert size={48} className="text-primary/60" />
      <p className="text-primary/60 font-mono text-sm uppercase tracking-widest">
        Protected Content
      </p>
    </div>
  );
}
