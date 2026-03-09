import { useState, useCallback } from "react";
import { useToast } from "./use-toast";

const BITCHAT_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const BITCHAT_TX     = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // notify → we receive
const BITCHAT_RX     = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // write  → we send

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface BitChatPeer {
  device: BluetoothDevice;
  rxChar: BluetoothRemoteGATTCharacteristic;
  name: string;
}

// Module-level: persists across renders, supports multiple simultaneous peers
const peers: BitChatPeer[] = [];

async function sendToPeers(bytes: Uint8Array): Promise<void> {
  for (const peer of [...peers]) {
    try {
      await peer.rxChar.writeValueWithoutResponse(bytes);
    } catch (e) {
      console.warn(`BitChat: write to "${peer.name}" failed:`, e);
    }
  }
}

// Retry getPrimaryService up to maxAttempts times with a delay between each.
// Some GATT stacks (especially iOS) need a moment after connect() before they
// are ready to enumerate services.
async function getServiceWithRetry(
  server: BluetoothRemoteGATTServer,
  serviceUuid: string,
  maxAttempts = 3,
  delayMs = 600,
): Promise<BluetoothRemoteGATTService> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (!server.connected) throw new DOMException("GATT server disconnected", "NetworkError");
    try {
      return await server.getPrimaryService(serviceUuid);
    } catch (err: any) {
      lastError = err;
      console.warn(`BitChat: getPrimaryService attempt ${attempt}/${maxAttempts} failed:`, err?.name, err?.message);
      // NotFoundError = service definitively absent; no point retrying
      if (err?.name === "NotFoundError") throw err;
      if (attempt < maxAttempts) await sleep(delayMs);
    }
  }
  throw lastError;
}

export function useBitChat() {
  const [peerCount, setPeerCount] = useState(0);
  const { toast } = useToast();

  const connect = useCallback(async () => {
    if (!("bluetooth" in navigator)) {
      toast({
        title: "Bluetooth Not Supported",
        description: "Web Bluetooth requires Chrome on Android or desktop.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Show ALL nearby BLE devices — avoids empty picker when BitChat isn't
      // broadcasting its service UUID (common on iOS in background mode).
      // optionalServices grants access to the NUS service after the user picks.
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [BITCHAT_SERVICE],
      });

      const server = await device.gatt!.connect();

      // Brief pause: some GATT stacks need a moment after connect() before
      // they can enumerate services reliably.
      await sleep(300);

      // Attempt to get the BitChat NUS service with retries for transient errors
      let service: BluetoothRemoteGATTService;
      try {
        service = await getServiceWithRetry(server, BITCHAT_SERVICE);
      } catch (err: any) {
        server.disconnect();
        if (err?.name === "NotFoundError") {
          toast({
            title: "BitChat Not Found on That Device",
            description: "Make sure the BitChat app is open and in the foreground on that device, then try again.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "GATT Connection Error",
            description: "Could not read services from that device. Try moving closer or reconnecting.",
            variant: "destructive",
          });
        }
        return;
      }

      const txChar = await service.getCharacteristic(BITCHAT_TX);
      const rxChar = await service.getCharacteristic(BITCHAT_RX);

      await txChar.startNotifications();
      txChar.addEventListener("characteristicvaluechanged", (event: Event) => {
        const val = (event.target as BluetoothRemoteGATTCharacteristic).value!;
        const bytes = new Uint8Array(val.buffer);
        (window as any).bitchatReceived?.(bytes, device.name || "BitChat");
      });

      device.addEventListener("gattserverdisconnected", () => {
        const idx = peers.findIndex((p) => p.device === device);
        if (idx !== -1) peers.splice(idx, 1);
        setPeerCount(peers.length);
        (window as any).bitchatSend = peers.length > 0 ? sendToPeers : undefined;
        toast({
          title: "BitChat Peer Lost",
          description: `${device.name || "Peer"} disconnected from bridge.`,
          variant: "destructive",
        });
      });

      peers.push({ device, rxChar, name: device.name || "BitChat" });
      setPeerCount(peers.length);
      (window as any).bitchatSend = sendToPeers;

      toast({
        title: "BitChat Peer Bridged",
        description: `"${device.name || "device"}" linked to LoRa mesh — BLB active.`,
      });
    } catch (e: any) {
      // NotFoundError = user cancelled the picker — no toast needed
      if (e?.name !== "NotFoundError") {
        toast({
          title: "BitChat Connect Failed",
          description: e?.message || "Could not connect to BitChat peer.",
          variant: "destructive",
        });
      }
    }
  }, [toast]);

  const disconnect = useCallback(async () => {
    for (const peer of [...peers]) {
      try { peer.device.gatt?.disconnect(); } catch (_) {}
    }
    peers.length = 0;
    setPeerCount(0);
    (window as any).bitchatSend = undefined;
    toast({ title: "BitChat Bridge Down", description: "All peers disconnected." });
  }, [toast]);

  return {
    isConnected: peerCount > 0,
    peerCount,
    connect,
    disconnect,
  };
}
