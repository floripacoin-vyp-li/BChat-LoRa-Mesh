import { useEffect, useRef } from "react";
import { ShieldAlert, Signal, WifiOff, Bluetooth, Usb } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard-header";
import { ChatInput } from "@/components/chat-input";
import { ChatMessage } from "@/components/chat-message";
import { AliasDialog } from "@/components/alias-dialog";
import { useMessages } from "@/hooks/use-messages";
import { useBLE } from "@/hooks/use-ble";
import { useSerial } from "@/hooks/use-serial";
import { useAlias } from "@/hooks/use-alias";
import { useRelay } from "@/hooks/use-relay";
import { useMessageStream } from "@/hooks/use-message-stream";

export default function Dashboard() {
  const { data: messages, isLoading, refetch } = useMessages();
  const ble = useBLE();
  const serial = useSerial();
  const { alias, setAlias, assignRandom, isSet } = useAlias();
  const scrollRef = useRef<HTMLDivElement>(null);

  const isConnected = ble.isConnected || serial.isConnected;
  useRelay(isConnected);
  useMessageStream();
  const activeDeviceName = ble.isConnected ? ble.deviceName : serial.isConnected ? serial.deviceName : null;
  const activeTransport = ble.isConnected ? "ble" : serial.isConnected ? "serial" : null;

  useEffect(() => {
    const handleConnected = () => refetch();
    window.addEventListener("ble-connected", handleConnected);
    return () => window.removeEventListener("ble-connected", handleConnected);
  }, [refetch]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="min-h-screen p-4 md:p-8 flex items-center justify-center relative">
      <div className="absolute top-20 left-20 w-64 h-64 bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-20 right-20 w-96 h-96 bg-blue-500/5 rounded-full blur-[120px] pointer-events-none" />

      <AliasDialog
        open={!isSet}
        onConfirm={setAlias}
        onSkip={assignRandom}
      />

      <div className="w-full max-w-4xl h-[85vh] flex flex-col relative z-10">
        <DashboardHeader ble={ble} serial={serial} />

        <div className="flex-1 glass-panel border-y-0 relative flex flex-col overflow-hidden bg-card/60">
          {/* Connection Status Banner */}
          <div className={`px-4 py-1.5 text-xs font-mono uppercase tracking-widest flex items-center justify-center gap-3 border-b ${
            isConnected
              ? "bg-primary/10 text-primary border-primary/20"
              : "bg-destructive/10 text-destructive border-destructive/20"
          }`}>
            {isConnected ? (
              <>
                <Signal size={12} className="animate-pulse" />
                <span>Uplink Established: {activeDeviceName}</span>
                {activeTransport === "ble" ? (
                  <span className="flex items-center gap-1 opacity-50">
                    <Bluetooth size={10} /> BLE
                  </span>
                ) : (
                  <span className="flex items-center gap-1 opacity-50">
                    <Usb size={10} /> USB
                  </span>
                )}
              </>
            ) : (
              <>
                <WifiOff size={12} />
                <span>Uplink Severed — Connect via BLE or USB Serial</span>
              </>
            )}
          </div>

          {/* Messages Scroll Area */}
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
                    Connect to a Meshtastic device via BLE or USB to begin.
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
                  <ChatMessage key={msg.id} message={msg} myAlias={alias} />
                ))}
              </div>
            )}
          </div>
        </div>

        <ChatInput isConnected={isConnected} alias={alias} onAliasChange={setAlias} />
      </div>
    </div>
  );
}
