import { Activity, Bluetooth, Check, Clipboard, Cpu, Power, QrCode, Trash2, Usb } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { useBLE } from "@/hooks/use-ble";
import { useSerial } from "@/hooks/use-serial";
import { useClearMessages } from "@/hooks/use-messages";
import { QRCodeDisplay } from "@/components/qr-code";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DashboardHeaderProps {
  ble: ReturnType<typeof useBLE>;
  serial: ReturnType<typeof useSerial>;
  isOnline: boolean;
}

const serialSupported = typeof navigator !== "undefined" && "serial" in navigator;

export function DashboardHeader({ ble, serial, isOnline }: DashboardHeaderProps) {
  const { mutate: clearMessages, isPending: isClearing } = useClearMessages();
  const anyConnected = ble.isConnected || serial.isConnected;
  const anyConnecting = ble.isConnecting || serial.isConnecting;
  const [qrOpen, setQrOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const currentUrl = typeof window !== "undefined" ? window.location.href : "";

  const handleOpenQr = () => {
    setQrOpen(true);
    fetch("/api/network-info")
      .then((r) => r.json())
      .then((data) => setLocalUrl(data.localUrl ?? null))
      .catch(() => {});
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const showLocalQr = localUrl && localUrl !== currentUrl;

  return (
    <header className="glass-panel border-b-0 rounded-t-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative overflow-hidden">
      <div className="absolute inset-0 scanlines pointer-events-none opacity-20" />

      <div className="flex items-center gap-3 relative z-10">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-card to-background border border-white/10 flex items-center justify-center shadow-lg">
          <Activity className="text-primary animate-pulse" size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            Bit Chat{" "}
            <span className={`font-mono text-xs px-2 py-0.5 rounded-full border transition-colors duration-500 ${
              isOnline
                ? "text-green-400 bg-green-400/10 border-green-400/30"
                : "text-red-400 bg-red-400/10 border-red-400/30"
            }`}>
              BRIDGE
            </span>
          </h1>
          <p className="text-xs text-muted-foreground font-mono">
            Meshtastic LoRa Protocol
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 w-full sm:w-auto relative z-10 flex-wrap">
        <Link href="/firmware">
          <button
            className="px-3 py-2 rounded-lg border border-white/10 text-muted-foreground hover:bg-primary/10 hover:border-primary/30 hover:text-primary flex items-center gap-1.5 text-xs font-mono transition-colors"
            title="BLB Node Firmware for ESP32"
            data-testid="link-firmware"
          >
            <Cpu size={12} />
            <span className="hidden sm:inline">Firmware</span>
          </button>
        </Link>

        <button
          onClick={handleOpenQr}
          className="px-3 py-2 rounded-lg border border-white/10 text-muted-foreground hover:bg-primary/10 hover:border-primary/30 hover:text-primary flex items-center gap-1.5 text-xs font-mono transition-colors"
          title="Share this URL via QR code"
          data-testid="button-scan-to-join"
        >
          <QrCode size={12} />
          <span className="hidden sm:inline">Join</span>
        </button>

        <Dialog open={qrOpen} onOpenChange={setQrOpen}>
          <DialogContent className="bg-card border-border/50 font-mono max-w-sm overflow-y-auto max-h-[90vh]">
            <DialogHeader>
              <DialogTitle className="text-sm font-mono uppercase tracking-widest text-primary">
                Scan to Join
              </DialogTitle>
            </DialogHeader>

            {showLocalQr ? (
              <div className="flex flex-col items-center gap-5 py-2">
                {/* Local network QR — primary */}
                <div className="flex flex-col items-center gap-3 w-full">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
                      Local Network
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground text-center leading-relaxed">
                    Devices on your hotspot use this URL — works offline
                  </p>
                  <QRCodeDisplay value={localUrl!} size={200} />
                  <p className="text-[10px] font-mono text-muted-foreground/60 break-all text-center px-2" data-testid="text-local-url">
                    {localUrl}
                  </p>
                  <button
                    onClick={() => handleCopyUrl(localUrl!)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary border border-white/10 hover:bg-primary/10 hover:border-primary/30 hover:text-primary text-xs font-mono transition-colors"
                    data-testid="button-copy-local-url"
                  >
                    {copied === localUrl ? <Check size={13} className="text-green-400" /> : <Clipboard size={13} />}
                    {copied === localUrl ? "Copied!" : "Copy Local URL"}
                  </button>
                </div>

                <div className="w-full border-t border-white/10 pt-4 flex flex-col items-center gap-3">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50">
                    Internet URL
                  </span>
                  <QRCodeDisplay value={currentUrl} size={140} />
                  <p className="text-[10px] font-mono text-muted-foreground/40 break-all text-center px-2" data-testid="text-share-url">
                    {currentUrl}
                  </p>
                  <button
                    onClick={() => handleCopyUrl(currentUrl)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary border border-white/10 hover:bg-primary/10 hover:border-primary/30 hover:text-primary text-xs font-mono transition-colors"
                    data-testid="button-copy-url"
                  >
                    {copied === currentUrl ? <Check size={11} className="text-green-400" /> : <Clipboard size={11} />}
                    {copied === currentUrl ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 py-2">
                <p className="text-xs text-muted-foreground text-center leading-relaxed">
                  Share this link — other devices need internet access to open it
                </p>
                <QRCodeDisplay value={currentUrl} size={220} />
                <p className="text-[10px] font-mono text-muted-foreground/60 break-all text-center px-2" data-testid="text-share-url">
                  {currentUrl}
                </p>
                <button
                  onClick={() => handleCopyUrl(currentUrl)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary border border-white/10 hover:bg-primary/10 hover:border-primary/30 hover:text-primary text-xs font-mono transition-colors"
                  data-testid="button-copy-url"
                >
                  {copied === currentUrl ? <Check size={13} className="text-green-400" /> : <Clipboard size={13} />}
                  {copied === currentUrl ? "Copied!" : "Copy URL"}
                </button>
                <p className="text-[10px] font-mono text-muted-foreground/40 text-center leading-relaxed px-4">
                  For offline LAN mode, run BCB on your own machine — the local IP QR will appear automatically
                </p>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              className="px-3 py-2 rounded-lg border border-destructive/20 text-destructive/80 hover:bg-destructive/10 hover:text-destructive flex items-center gap-2 text-xs font-mono transition-colors"
              title="Clear Local Log"
              data-testid="button-clear-log"
            >
              <Trash2 size={14} />
              <span className="hidden sm:inline">Clear Log</span>
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent className="bg-card border-border/50 font-mono">
            <AlertDialogHeader>
              <AlertDialogTitle>Purge communication logs?</AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                This will delete all local messages from the bridge terminal. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-secondary text-secondary-foreground border-white/10 hover:bg-white/5">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => clearMessages()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isClearing ? "Purging..." : "Purge Logs"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="h-6 w-px bg-white/10 mx-1 hidden sm:block" />

        {anyConnected ? (
          <button
            onClick={ble.isConnected ? ble.disconnect : serial.disconnect}
            className="flex-1 sm:flex-none px-4 py-2 rounded-lg bg-secondary border border-white/10 hover:bg-destructive/20 hover:border-destructive/50 hover:text-destructive text-foreground flex items-center justify-center gap-2 text-sm font-medium transition-all group"
            data-testid="button-disconnect"
          >
            <Power size={16} className="group-hover:animate-pulse" />
            <span>Disconnect</span>
            <span className="text-[10px] font-mono opacity-50 uppercase">
              {ble.isConnected ? "BLE" : "USB"}
            </span>
          </button>
        ) : (
          <div className="flex gap-2 flex-1 sm:flex-none">
            <button
              onClick={ble.connect}
              disabled={anyConnecting}
              className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center gap-2 text-sm font-semibold tech-glow-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="button-connect-ble"
            >
              <Bluetooth size={15} className={ble.isConnecting ? "animate-pulse" : ""} />
              <span>{ble.isConnecting ? "Pairing…" : "BLE"}</span>
            </button>

            <button
              onClick={serial.connect}
              disabled={anyConnecting || !serialSupported}
              title={serialSupported ? "Connect via USB Serial" : "Requires Chrome 89+ on desktop or Chrome 126+ on Android"}
              className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-secondary border border-white/10 hover:bg-primary/10 hover:border-primary/30 hover:text-primary text-foreground flex items-center justify-center gap-2 text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="button-connect-serial"
            >
              <Usb size={15} className={serial.isConnecting ? "animate-pulse" : ""} />
              <span>{serial.isConnecting ? "Opening…" : "USB"}</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
