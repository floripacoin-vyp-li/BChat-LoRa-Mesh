import { useEffect, useRef, useState } from "react";
import { ExternalLink, ShieldAlert, Signal, WifiOff } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard-header";
import { ChatInput } from "@/components/chat-input";
import { ChatMessage } from "@/components/chat-message";
import { useMessages } from "@/hooks/use-messages";
import { useBLE } from "@/hooks/use-ble";

function useBluetoothAvailable() {
  const [status, setStatus] = useState<"checking" | "available" | "blocked">("checking");
  useEffect(() => {
    const inIframe = window.self !== window.top;
    const hasApi = !!(navigator as any).bluetooth;
    if (!hasApi || inIframe) {
      // Try a quick permissions check to confirm it's blocked
      if ((navigator as any).bluetooth) {
        (navigator as any).bluetooth.getAvailability?.()
          .then((available: boolean) => setStatus(available ? "available" : "blocked"))
          .catch(() => setStatus("blocked"));
      } else {
        setStatus("blocked");
      }
    } else {
      setStatus("available");
    }
  }, []);
  return status;
}

export default function Dashboard() {
  const { data: messages, isLoading, refetch } = useMessages();
  const ble = useBLE();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bluetoothStatus = useBluetoothAvailable();

  useEffect(() => {
    const handleConnected = () => {
      console.log("BLE connected event received, refetching...");
      refetch();
    };
    window.addEventListener('ble-connected', handleConnected);
    return () => window.removeEventListener('ble-connected', handleConnected);
  }, [refetch]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const isInIframe = window.self !== window.top;

  return (
    <div className="min-h-screen p-4 md:p-8 flex items-center justify-center relative">
      <div className="absolute top-20 left-20 w-64 h-64 bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-20 right-20 w-96 h-96 bg-blue-500/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-4xl flex flex-col gap-3 relative z-10">
        {/* Iframe / permissions-policy warning banner */}
        {isInIframe && (
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 font-mono text-xs">
            <div className="flex items-center gap-2">
              <ShieldAlert size={15} className="shrink-0" />
              <span>
                <strong>Web Bluetooth is blocked inside this preview frame.</strong>{" "}
                You must open the app in a standalone browser tab for BLE to work.
              </span>
            </div>
            <a
              href={window.location.href}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 transition-colors text-amber-300 font-semibold"
              data-testid="link-open-new-tab"
            >
              <ExternalLink size={13} />
              Open in new tab
            </a>
          </div>
        )}

        <div className="h-[85vh] flex flex-col">
          <DashboardHeader ble={ble} />

          <div className="flex-1 glass-panel border-y-0 relative flex flex-col overflow-hidden bg-card/60">
            <div className={`px-4 py-1.5 text-xs font-mono uppercase tracking-widest flex items-center justify-center gap-3 border-b ${
              ble.isConnected
                ? "bg-primary/10 text-primary border-primary/20"
                : "bg-destructive/10 text-destructive border-destructive/20"
            }`}>
              {ble.isConnected ? (
                <>
                  <Signal size={12} className="animate-pulse" />
                  <span>Uplink Established: {ble.deviceName}</span>
                </>
              ) : (
                <>
                  <WifiOff size={12} />
                  <span>Uplink Severed - Awaiting Bluetooth Connection</span>
                </>
              )}
            </div>

            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar scroll-smooth relative"
            >
              {isLoading ? (
                <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm animate-pulse">
                  INITIALIZING TERMINAL...
                </div>
              ) : !messages || messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground/50 font-mono text-center gap-4">
                  <ShieldAlert size={48} className="opacity-20" />
                  <div>
                    <p className="mb-2 uppercase">Local log empty</p>
                    <p className="text-xs max-w-xs leading-relaxed opacity-60">
                      Connect to a Meshtastic device via BLE to begin receiving and transmitting LoRa packets.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 pb-4">
                  <div className="flex justify-center mb-8">
                    <span className="text-[10px] font-mono text-muted-foreground/40 bg-secondary/50 px-3 py-1 rounded-full uppercase">
                      Session Started
                    </span>
                  </div>
                  {messages.map((msg) => (
                    <ChatMessage key={msg.id} message={msg} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <ChatInput isConnected={ble.isConnected} />
        </div>
      </div>
    </div>
  );
}
