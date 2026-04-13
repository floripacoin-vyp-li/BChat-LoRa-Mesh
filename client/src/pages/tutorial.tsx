import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Bluetooth,
  MessageSquare,
  RadioTower,
  ShieldCheck,
  Wallet,
  RotateCcw,
  Activity,
  Bug,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Send,
  Crown,
  BadgeCheck,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const sections = [
  {
    icon: <Bluetooth size={22} className="text-primary" />,
    title: "Connect to the Mesh",
    body: (
      <>
        <p>
          BChat bridges your browser to a <strong>BitChat BLE mesh</strong> or a{" "}
          <strong>Meshtastic LoRa mesh</strong> so you can chat and send BCH
          payments over a radio network — no internet required on the mesh side.
        </p>
        <ul className="mt-3 space-y-2 list-disc list-inside text-muted-foreground">
          <li>
            Tap <strong>Connect BLE</strong> to pair with a nearby Meshtastic
            device over Bluetooth.
          </li>
          <li>
            Or tap <strong>Connect USB</strong> if your device is plugged in via
            cable (Chrome/Edge only).
          </li>
          <li>
            If the BLE connection drops after a send (common on Android), the
            app <strong>auto-reconnects</strong> silently — a "Reconnecting…"
            banner appears while it retries.
          </li>
          <li>
            When a remote <strong>BLB Node</strong> operator is active, messages
            travel over LoRa even without your own radio — see the{" "}
            <Link href="/firmware">
              <span className="text-primary underline cursor-pointer">Firmware page</span>
            </Link>{" "}
            to build one.
          </li>
        </ul>
      </>
    ),
  },
  {
    icon: <MessageSquare size={22} className="text-primary" />,
    title: "Public Mesh Chat",
    body: (
      <>
        <p>
          The main screen is the shared <strong>mesh chat log</strong> — every
          device on the network can read it.
        </p>
        <ul className="mt-3 space-y-2 list-disc list-inside text-muted-foreground">
          <li>Type a message at the bottom and press Enter or the send button.</li>
          <li>Your alias is shown next to each message you send.</li>
          <li>Messages are relayed hop-by-hop across the mesh.</li>
          <li>Delete your own messages with the trash icon.</li>
        </ul>
      </>
    ),
  },
  {
    icon: <RadioTower size={22} className="text-primary" />,
    title: "Adding Private Contacts",
    body: (
      <>
        <p>
          Tap the <strong>antenna icon</strong> next to any message sender's
          name to get contact options.
        </p>
        <ul className="mt-3 space-y-2 list-disc list-inside text-muted-foreground">
          <li>
            <strong>Add to Private Chats</strong> — adds them as a contact and
            sends them a contact request over the mesh.
          </li>
          <li>
            They will see a card: <em>"UserX wants to start a private chat"</em>{" "}
            with Accept / Ignore buttons.
          </li>
          <li>
            Once both sides accept, encryption keys are exchanged and the
            private channel opens automatically.
          </li>
        </ul>
      </>
    ),
  },
  {
    icon: <ShieldCheck size={22} className="text-primary" />,
    title: "End-to-End Encrypted DMs",
    body: (
      <>
        <p>
          Tap the <strong>Secure</strong> button to open your private contacts
          and encrypted chat threads.
        </p>
        <ul className="mt-3 space-y-2 list-disc list-inside text-muted-foreground">
          <li>
            Messages are encrypted with <strong>ECDH + AES-GCM</strong> — only
            you and your contact can read them, not the server.
          </li>
          <li>
            Share your public key (shown by default in the Secure panel) with
            trusted contacts so they can add you directly.
          </li>
          <li>
            Show your QR code for a quick in-person key exchange.
          </li>
          <li>
            Unread message counts appear as a badge — tap the badge or the
            contact name to open the chat.
          </li>
        </ul>
      </>
    ),
  },
  {
    icon: <Wallet size={22} className="text-primary" />,
    title: "Bitcoin Cash Payments",
    body: (
      <>
        <p>
          Inside any private chat you can request or acknowledge{" "}
          <strong>BCH payments</strong> — encrypted end-to-end like the messages.
        </p>
        <ul className="mt-3 space-y-2 list-disc list-inside text-muted-foreground">
          <li>
            Open the <strong>Wallet</strong> panel (inside Secure) to set your
            BCH address via paste or QR scan.
          </li>
          <li>
            The app also generates a built-in BCH address automatically — tap
            Wallet to view or copy it.
          </li>
          <li>
            In a private chat, tap the <strong>BCH</strong> button to send a
            payment request card with your address and an optional amount.
          </li>
          <li>
            The recipient taps <strong>Pay Now</strong> to open their BCH wallet
            app directly with the address pre-filled.
          </li>
          <li>
            Tap <strong>Payment received</strong> to confirm once funds arrive.
          </li>
        </ul>
      </>
    ),
  },
  {
    icon: <RotateCcw size={22} className="text-primary" />,
    title: "Resetting Your Identity",
    body: (
      <>
        <p>
          The <strong>Reset</strong> button (top-right of the header) gives you
          a clean slate on this device.
        </p>
        <ul className="mt-3 space-y-2 list-disc list-inside text-muted-foreground">
          <li>
            Clears your alias, contacts, encryption keys, BCH address, and
            private keys from this browser.
          </li>
          <li>
            Deletes your messages from the server and frees your username for
            others.
          </li>
          <li>You will be asked to pick a new alias on next load.</li>
          <li>
            <strong>This cannot be undone</strong> — a confirmation prompt is
            shown first.
          </li>
        </ul>
      </>
    ),
  },
];

const CATEGORY_OPTIONS = [
  { value: "bug",     label: "Bug / Error",        desc: "Something is broken or not working" },
  { value: "ux",      label: "UX / Usability",     desc: "Confusing flow or interface issue" },
  { value: "feature", label: "Feature Request",    desc: "Something you'd like to see added" },
  { value: "other",   label: "Other",              desc: "Anything else" },
] as const;

type Category = "bug" | "ux" | "feature" | "other";

type SubmitResult = {
  ok: boolean;
  id?: number;
  status?: string;
  analysisNote?: string;
};

const STATUS_META: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  likely_valid:   { icon: CheckCircle2,  color: "text-emerald-400",  label: "Looks good — queued for review" },
  needs_review:   { icon: Clock,         color: "text-amber-400",    label: "Submitted — will be reviewed manually" },
  likely_invalid: { icon: AlertTriangle, color: "text-orange-400",   label: "Submitted — low detail detected" },
};

export default function Tutorial() {
  const { toast } = useToast();
  const alias = localStorage.getItem("bcb-alias") ?? "";

  const [category, setCategory] = useState<Category>("bug");
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);

  const { mutate, isPending } = useMutation({
    mutationFn: (body: { alias: string; category: Category; description: string }) =>
      apiRequest<SubmitResult>("POST", "/api/bug-reports", body),
    onSuccess: (data) => {
      setResult(data);
      setDescription("");
    },
    onError: (err: Error) => {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (description.trim().length < 20) {
      toast({ title: "Too short", description: "Please describe the issue in at least 20 characters.", variant: "destructive" });
      return;
    }
    setResult(null);
    mutate({ alias: alias || "anonymous", category, description: description.trim() });
  };

  const statusMeta = result?.status ? STATUS_META[result.status] : null;

  return (
    <div className="min-h-screen bg-background text-foreground font-mono">
      <div className="max-w-3xl mx-auto px-4 py-10">
        {/* Back link */}
        <Link href="/">
          <button
            className="mb-8 flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
            data-testid="link-back-home"
          >
            <ArrowLeft size={13} /> Back to BChat
          </button>
        </Link>

        {/* Page heading */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-card to-background border border-white/10 flex items-center justify-center shadow-lg">
            <Activity size={20} className="text-primary animate-pulse" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Getting Started
            </h1>
            <p className="text-xs text-muted-foreground">
              How to use BChat — BitChat Bridge
            </p>
          </div>
        </div>

        <p className="mt-4 mb-10 text-sm text-muted-foreground leading-relaxed border-l-2 border-primary/30 pl-4">
          BChat is a progressive web app that connects a browser-based chat
          interface to the <strong>BitChat BLE mesh</strong> and the{" "}
          <strong>Meshtastic LoRa mesh</strong>, with end-to-end encrypted
          private messaging and <strong>Bitcoin Cash</strong> payment requests.
          No account, no phone number, no central server reads your DMs.
        </p>

        {/* Sections */}
        <div className="space-y-8">
          {sections.map((s, i) => (
            <div
              key={i}
              className="glass-panel rounded-xl p-6"
              data-testid={`tutorial-section-${i}`}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                  {s.icon}
                </div>
                <h2 className="text-sm font-semibold tracking-wide text-foreground uppercase">
                  {s.title}
                </h2>
              </div>
              <div className="text-sm text-muted-foreground leading-relaxed">
                {s.body}
              </div>
            </div>
          ))}
        </div>

        {/* Premium Features */}
        <div className="mt-8 glass-panel rounded-xl p-6 border border-amber-500/20" data-testid="premium-section">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
              <Crown size={16} className="text-amber-400" />
            </div>
            <h2 className="text-sm font-semibold tracking-wide text-foreground uppercase">
              Premium Features
            </h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            Upgrade to <strong className="text-amber-300">BCB Premium</strong> for{" "}
            <strong className="text-amber-300">$10 / year</strong> (paid in sats via Lightning)
            to unlock the following features inside the <strong>Secure</strong> panel.
          </p>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <BadgeCheck size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <span>
                <strong className="text-foreground">Verified badge</strong> — your alias
                displays a gold checkmark so others know you're a verified member.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <BadgeCheck size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <span>
                <strong className="text-foreground">Email as alias</strong> — use your
                email address (e.g. <em>you@example.com</em>) as your mesh alias instead
                of a random handle.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <BadgeCheck size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <span>
                <strong className="text-foreground">Full wallet backup &amp; restore</strong> —
                download a single encrypted JSON file that contains your alias, all wallet
                addresses, your E2E encryption key pair, your BCH private key, and your
                contact list. Restore it on any device to recover everything instantly.
              </span>
            </li>
          </ul>
          <p className="mt-4 text-xs text-muted-foreground/60 leading-relaxed">
            To activate, open the <strong>Secure</strong> panel → scroll to{" "}
            <strong>Premium Verified</strong> → follow the Lightning payment instructions,
            then submit your email for verification. Approval is usually within 24 hours.
          </p>
        </div>

        {/* Bug Report */}
        <div className="mt-8 glass-panel rounded-xl p-6" data-testid="bug-report-section">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-destructive/10 border border-destructive/20 flex items-center justify-center flex-shrink-0">
              <Bug size={16} className="text-destructive" />
            </div>
            <h2 className="text-sm font-semibold tracking-wide text-foreground uppercase">
              Report a Bug or Suggestion
            </h2>
          </div>
          <p className="text-xs text-muted-foreground mb-5 pl-11">
            Spotted something wrong or have an idea? Describe it below — reports are automatically reviewed for relevance before being queued for the team.
          </p>

          {result ? (
            <div className="rounded-lg border border-white/10 bg-black/20 p-4 space-y-2" data-testid="bug-report-result">
              <div className={`flex items-center gap-2 text-sm font-semibold ${statusMeta?.color ?? "text-primary"}`}>
                {statusMeta && <statusMeta.icon size={16} />}
                {statusMeta?.label ?? "Submitted"}
              </div>
              {result.analysisNote && (
                <p className="text-xs text-muted-foreground leading-relaxed">{result.analysisNote}</p>
              )}
              <button
                onClick={() => setResult(null)}
                className="mt-2 text-xs text-primary hover:underline"
                data-testid="button-bug-report-again"
              >
                Submit another report →
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Category selector */}
              <div className="grid grid-cols-2 gap-2" data-testid="bug-report-category">
                {CATEGORY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setCategory(opt.value)}
                    className={`text-left rounded-lg border px-3 py-2.5 transition-all ${
                      category === opt.value
                        ? "border-primary/50 bg-primary/10 text-foreground"
                        : "border-white/8 bg-black/10 text-muted-foreground hover:border-white/15"
                    }`}
                    data-testid={`button-category-${opt.value}`}
                  >
                    <div className="text-xs font-semibold">{opt.label}</div>
                    <div className="text-[10px] mt-0.5 opacity-70">{opt.desc}</div>
                  </button>
                ))}
              </div>

              {/* Description textarea */}
              <div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the bug or suggestion in plain language — what happened, what you expected, and the steps to reproduce if applicable…"
                  rows={5}
                  maxLength={1000}
                  className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40 resize-none leading-relaxed"
                  data-testid="input-bug-description"
                />
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-muted-foreground/40">
                    {description.length < 20 ? `${20 - description.length} more chars needed` : ""}
                  </span>
                  <span className="text-[10px] text-muted-foreground/40">{description.length}/1000</span>
                </div>
              </div>

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={isPending || description.trim().length < 20}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-destructive/15 hover:bg-destructive/25 border border-destructive/30 text-destructive rounded-lg text-xs font-mono font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="button-submit-bug-report"
              >
                <Send size={13} />
                {isPending ? "Submitting…" : "Submit Report"}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <Link href="/">
            <button
              className="px-6 py-2 rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary text-xs font-mono transition-colors"
              data-testid="button-tutorial-go-back"
            >
              Back to BChat →
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
