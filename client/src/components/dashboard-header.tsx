import { Activity, Bluetooth, Cpu, Power, Radio, Trash2, Usb } from "lucide-react";
import { Link } from "wouter";
import { useBLE } from "@/hooks/use-ble";
import { useSerial } from "@/hooks/use-serial";
import { useBitChat } from "@/hooks/use-bitchat";
import { useClearMessages } from "@/hooks/use-messages";
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

interface DashboardHeaderProps {
  ble: ReturnType<typeof useBLE>;
  serial: ReturnType<typeof useSerial>;
  bitchat: ReturnType<typeof useBitChat>;
}

const serialSupported = typeof navigator !== "undefined" && "serial" in navigator;

export function DashboardHeader({ ble, serial, bitchat }: DashboardHeaderProps) {
  const { mutate: clearMessages, isPending: isClearing } = useClearMessages();
  const anyConnected = ble.isConnected || serial.isConnected;
  const anyConnecting = ble.isConnecting || serial.isConnecting;
  const blbActive = anyConnected && bitchat.isConnected;

  return (
    <header className="glass-panel border-b-0 rounded-t-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative overflow-hidden">
      <div className="absolute inset-0 scanlines pointer-events-none opacity-20" />

      <div className="flex items-center gap-3 relative z-10">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-card to-background border border-white/10 flex items-center justify-center shadow-lg">
          <Activity className={`${blbActive ? "text-cyan-400" : "text-primary"} animate-pulse`} size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            Bit Chat{" "}
            <span className={`font-mono text-xs px-2 py-0.5 rounded-full border ${
              blbActive
                ? "text-cyan-400 bg-cyan-400/10 border-cyan-400/30"
                : "text-primary bg-primary/10 border-primary/20"
            }`}>
              {blbActive ? "BLB" : "BRIDGE"}
            </span>
          </h1>
          <p className="text-xs text-muted-foreground font-mono">
            {blbActive
              ? `LoRa ↔ BitChat · ${bitchat.peerCount} peer${bitchat.peerCount !== 1 ? "s" : ""}`
              : "Meshtastic LoRa Protocol"}
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

        {/* LoRa transport (BLE / USB) */}
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

        {/* BitChat BLE bridge — always independent of LoRa transport */}
        {bitchat.isConnected ? (
          <button
            onClick={bitchat.disconnect}
            title="Disconnect all BitChat peers"
            className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-destructive/20 hover:border-destructive/50 hover:text-destructive flex items-center justify-center gap-2 text-sm font-medium transition-all group"
            data-testid="button-disconnect-bitchat"
          >
            <Radio size={15} className="group-hover:animate-pulse" />
            <span>BChat</span>
            <span className="text-[10px] font-mono opacity-70">·{bitchat.peerCount}</span>
          </button>
        ) : (
          <button
            onClick={bitchat.connect}
            title={
              bitchat.isAutoConnecting
                ? "Auto-connecting to nearby BitChat devices…"
                : "Connect to a BitChat device — keep the BitChat app open & in the foreground on your phone first"
            }
            className={`flex-1 sm:flex-none px-3 py-2 rounded-lg flex items-center justify-center gap-2 text-sm font-semibold transition-all ${
              bitchat.isAutoConnecting
                ? "bg-cyan-500/5 border border-cyan-500/20 text-cyan-400/50"
                : "bg-secondary border border-white/10 hover:bg-cyan-500/10 hover:border-cyan-500/30 hover:text-cyan-400 text-foreground"
            }`}
            data-testid="button-connect-bitchat"
          >
            <Radio size={15} className={bitchat.isAutoConnecting ? "animate-pulse" : ""} />
            <span>BChat</span>
          </button>
        )}
      </div>
    </header>
  );
}
