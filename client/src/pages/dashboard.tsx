import { useEffect, useRef, useState } from "react";
import { ShieldAlert, Signal, WifiOff, Bluetooth, Usb, Lock } from "lucide-react";
import { DashboardHeader } from "@/components/dashboard-header";
import { ChatInput } from "@/components/chat-input";
import { ChatMessage } from "@/components/chat-message";
import { AliasDialog } from "@/components/alias-dialog";
import { ContactsPanel } from "@/components/contacts-panel";
import { PrivateChat } from "@/components/private-chat";
import { useMessages } from "@/hooks/use-messages";
import { useBLE } from "@/hooks/use-ble";
import { useSerial } from "@/hooks/use-serial";
import { useAlias } from "@/hooks/use-alias";
import { useRelay } from "@/hooks/use-relay";
import { useMessageStream } from "@/hooks/use-message-stream";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useMyCryptoKey, useContacts } from "@/hooks/use-contacts";
import { usePrivateMessages } from "@/hooks/use-private-messages";
import { parseDmPayload } from "@/lib/crypto";

export default function Dashboard() {
  const { data: messages, isLoading, refetch } = useMessages();
  const ble = useBLE();
  const serial = useSerial();
  const { alias, setAlias, assignRandom, isSet } = useAlias();
  const scrollRef = useRef<HTMLDivElement>(null);

  const isConnected = ble.isConnected || serial.isConnected;
  const isOnline = useConnectivity();
  useRelay(isConnected);
  useMessageStream();
  const activeDeviceName = ble.isConnected ? ble.deviceName : serial.isConnected ? serial.deviceName : null;
  const activeTransport = ble.isConnected ? "ble" : serial.isConnected ? "serial" : null;

  // E2E crypto state
  const { myPublicKeyBase64 } = useMyCryptoKey();
  const { contacts, addContact, removeContact, getSharedKey } = useContacts();
  const { getThread, addSentDm, markRead, unreadCounts, totalUnread } = usePrivateMessages(contacts, getSharedKey);

  const [dmPanelOpen, setDmPanelOpen] = useState(false);
  const [activeDmContact, setActiveDmContact] = useState<string | null>(null);

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

  const handleOpenChat = (contactAlias: string) => {
    setActiveDmContact(contactAlias);
  };

  const handleBackToContacts = () => {
    setActiveDmContact(null);
  };

  const handleClosePanel = () => {
    setDmPanelOpen(false);
    setActiveDmContact(null);
  };

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
            !isOnline
              ? "bg-yellow-400/10 text-yellow-400 border-yellow-400/20"
              : isConnected
              ? "bg-primary/10 text-primary border-primary/20"
              : "bg-destructive/10 text-destructive border-destructive/20"
          }`}>
            {!isOnline ? (
              <>
                <WifiOff size={12} className="animate-pulse" />
                <span>Offline · Local BLE Only</span>
                {isConnected && activeDeviceName && (
                  <span className="flex items-center gap-1 opacity-60">
                    {activeTransport === "ble" ? <Bluetooth size={10} /> : <Usb size={10} />}
                    {activeDeviceName}
                  </span>
                )}
              </>
            ) : isConnected ? (
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

          {/* DM Button */}
          <button
            onClick={() => setDmPanelOpen(true)}
            className="absolute top-10 right-3 z-10 flex items-center gap-1 bg-background/60 hover:bg-background/80 border border-white/10 rounded-lg px-2 py-1.5 transition-colors"
            title="Secure private chats"
            data-testid="button-open-dm-panel"
          >
            <Lock size={12} className="text-primary" />
            {totalUnread > 0 && (
              <span className="bg-primary text-primary-foreground text-[10px] font-mono px-1 rounded-full leading-none py-0.5" data-testid="badge-unread-dm">
                {totalUnread}
              </span>
            )}
          </button>

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
                {messages.map((msg) => {
                  const isDm = parseDmPayload(msg.content) !== null;
                  if (isDm) {
                    return (
                      <div key={msg.id} className="flex items-center gap-2 px-2 py-1" data-testid={`msg-encrypted-${msg.id}`}>
                        <Lock size={11} className="text-muted-foreground/30 flex-shrink-0" />
                        <span className="text-xs font-mono text-muted-foreground/30 italic">
                          Private message
                        </span>
                      </div>
                    );
                  }
                  return <ChatMessage key={msg.id} message={msg} myAlias={alias} />;
                })}
              </div>
            )}
          </div>

          {/* DM Overlays */}
          {dmPanelOpen && !activeDmContact && (
            <ContactsPanel
              contacts={contacts}
              myPublicKeyBase64={myPublicKeyBase64}
              unreadCounts={unreadCounts}
              onAddContact={addContact}
              onRemoveContact={removeContact}
              onOpenChat={handleOpenChat}
              onClose={handleClosePanel}
            />
          )}

          {dmPanelOpen && activeDmContact && (
            <PrivateChat
              contactAlias={activeDmContact}
              myAlias={alias}
              messages={getThread(activeDmContact)}
              getSharedKey={getSharedKey}
              onAddSentDm={addSentDm}
              onMarkRead={markRead}
              onBack={handleBackToContacts}
            />
          )}
        </div>

        <ChatInput isConnected={isConnected} alias={alias} onAliasChange={setAlias} />
      </div>
    </div>
  );
}
