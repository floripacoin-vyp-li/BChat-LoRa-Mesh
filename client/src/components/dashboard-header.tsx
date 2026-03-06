import { Activity, Bluetooth, Power, Trash2, Settings2, Radio } from "lucide-react";
import { useBLE } from "@/hooks/use-ble";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DashboardHeaderProps {
  ble: ReturnType<typeof useBLE>;
  frequency: string;
  channel: string;
  onFrequencyChange: (freq: string) => void;
  onChannelChange: (ch: string) => void;
}

const FREQUENCIES = [
  { label: "919.875 MHz (Custom)", value: "919.875" },
  { label: "915.0 MHz (US)", value: "915.0" },
  { label: "868.0 MHz (EU)", value: "868.0" },
  { label: "433.0 MHz (CN)", value: "433.0" },
  { label: "923.0 MHz (AS)", value: "923.0" },
];

const CHANNELS = [
  { label: "Channel 0", value: "0" },
  { label: "Channel 1", value: "1" },
  { label: "Channel 2", value: "2" },
  { label: "Channel 3", value: "3" },
  { label: "Channel 4", value: "4" },
  { label: "Channel 5", value: "5" },
];

export function DashboardHeader({ ble, frequency, channel, onFrequencyChange, onChannelChange }: DashboardHeaderProps) {
  const { mutate: clearMessages, isPending: isClearing } = useClearMessages();

  return (
    <header className="glass-panel border-b-0 rounded-t-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative overflow-hidden">
      {/* Decorative scanline for header */}
      <div className="absolute inset-0 scanlines pointer-events-none opacity-20" />
      
      <div className="flex items-center gap-3 relative z-10">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-card to-background border border-white/10 flex items-center justify-center shadow-lg">
          <Activity className="text-primary animate-pulse" size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            Bit Chat <span className="text-primary font-mono text-xs px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">BRIDGE</span>
          </h1>
          <p className="text-xs text-muted-foreground font-mono">Meshtastic LoRa Protocol</p>
        </div>
      </div>

      <div className="flex items-center gap-3 w-full sm:w-auto relative z-10">
        {ble.isConnected && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button 
                  className="px-3 py-2 rounded-lg border border-white/10 text-muted-foreground hover:bg-white/5 flex items-center gap-2 text-xs font-mono transition-colors"
                  data-testid="button-frequency"
                >
                  <Settings2 size={14} />
                  <span>{frequency} MHz</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card border-border/50 font-mono text-xs">
                {FREQUENCIES.map((freq) => (
                  <DropdownMenuItem 
                    key={freq.value}
                    onClick={() => onFrequencyChange(freq.value)}
                    className="cursor-pointer focus:bg-primary/20 focus:text-primary"
                  >
                    {freq.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button 
                  className="px-3 py-2 rounded-lg border border-white/10 text-muted-foreground hover:bg-white/5 flex items-center gap-2 text-xs font-mono transition-colors"
                  data-testid="button-channel"
                >
                  <Radio size={14} />
                  <span>CH {channel}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card border-border/50 font-mono text-xs">
                {CHANNELS.map((ch) => (
                  <DropdownMenuItem 
                    key={ch.value}
                    onClick={() => onChannelChange(ch.value)}
                    className="cursor-pointer focus:bg-primary/20 focus:text-primary"
                  >
                    {ch.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button 
              className="px-3 py-2 rounded-lg border border-destructive/20 text-destructive/80 hover:bg-destructive/10 hover:text-destructive flex items-center gap-2 text-xs font-mono transition-colors"
              title="Clear Local Log"
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

        <div className="h-6 w-px bg-white/10 mx-1 hidden sm:block"></div>

        {ble.isConnected ? (
          <button
            onClick={ble.disconnect}
            className="flex-1 sm:flex-none px-4 py-2 rounded-lg bg-secondary border border-white/10 hover:bg-destructive/20 hover:border-destructive/50 hover:text-destructive text-foreground flex items-center justify-center gap-2 text-sm font-medium transition-all group"
          >
            <Power size={16} className="group-hover:animate-pulse" />
            <span>Disconnect</span>
          </button>
        ) : (
          <button
            onClick={ble.connect}
            disabled={ble.isConnecting}
            className="flex-1 sm:flex-none px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 flex items-center justify-center gap-2 text-sm font-semibold tech-glow-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Bluetooth size={16} className={ble.isConnecting ? "animate-pulse" : ""} />
            <span>{ble.isConnecting ? "Pairing..." : "Connect BLE"}</span>
          </button>
        )}
      </div>
    </header>
  );
}
