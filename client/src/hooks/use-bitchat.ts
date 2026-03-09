import { useState, useCallback } from "react";
import { useToast } from "./use-toast";

const BITCHAT_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const BITCHAT_TX     = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // notify → we receive
const BITCHAT_RX     = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // write  → we send

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
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ services: [BITCHAT_SERVICE] }],
      });

      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService(BITCHAT_SERVICE);
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
