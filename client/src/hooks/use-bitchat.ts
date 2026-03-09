import { useState, useCallback, useRef } from "react";
import { useToast } from "./use-toast";

const BITCHAT_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const BITCHAT_TX     = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // notify → we receive
const BITCHAT_RX     = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // write  → we send

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Guard so auto-connect only runs once per page load
let autoConnectRan = false;

interface BitChatPeer {
  device: BluetoothDevice;
  rxChar: BluetoothRemoteGATTCharacteristic;
  name: string;
}

// Module-level peer list — persists across renders, supports multiple connections
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

// Retry getPrimaryService up to maxAttempts with a delay between each.
// GATT stacks (especially on Android) often need a short pause after connect()
// before they are ready to enumerate services.
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
      console.warn(`BitChat: getPrimaryService attempt ${attempt}/${maxAttempts}:`, err?.name);
      if (err?.name === "NotFoundError") throw err; // service absent — no point retrying
      if (attempt < maxAttempts) await sleep(delayMs);
    }
  }
  throw lastError;
}

export function useBitChat() {
  const [peerCount, setPeerCount] = useState(0);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const { toast } = useToast();

  // Stable ref so we can call toast inside async callbacks without stale closure issues
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Wire up a device that already has a live GATT server connection.
  // Returns true if the BitChat NUS service was found and subscribed.
  const setupPeer = useCallback(async (
    device: BluetoothDevice,
    server: BluetoothRemoteGATTServer,
    silent = false,
  ): Promise<boolean> => {
    let service: BluetoothRemoteGATTService;
    try {
      service = await getServiceWithRetry(server, BITCHAT_SERVICE);
    } catch {
      server.disconnect();
      return false;
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
      (window as any).bitchatSend = peers.length > 0 ? sendToPeers : undefined;
      setPeerCount(peers.length);
      if (!silent) {
        toastRef.current({
          title: "BitChat Peer Lost",
          description: `${device.name || "Peer"} disconnected from bridge.`,
          variant: "destructive",
        });
      }
    });

    peers.push({ device, rxChar, name: device.name || "BitChat" });
    (window as any).bitchatSend = sendToPeers;
    setPeerCount(peers.length);
    return true;
  }, []);

  // Silent background reconnect to any previously authorized BitChat devices.
  // Calls navigator.bluetooth.getDevices() — no picker shown.
  const autoConnect = useCallback(async () => {
    if (autoConnectRan) return;
    autoConnectRan = true;

    const nav = navigator as any;
    if (!("bluetooth" in nav) || typeof nav.bluetooth.getDevices !== "function") return;

    let known: BluetoothDevice[] = [];
    try {
      known = await nav.bluetooth.getDevices();
    } catch {
      return;
    }

    if (known.length === 0) return;

    setIsAutoConnecting(true);
    console.log(`BitChat auto-connect: trying ${known.length} known device(s)`);

    for (const device of known) {
      try {
        if (peers.some((p) => p.device === device)) continue;
        const server = await device.gatt!.connect();
        await sleep(300);
        const ok = await setupPeer(device, server, true);
        if (ok) console.log(`BitChat auto-connect: linked "${device.name || device.id}"`);
      } catch {
        // Out of range or refused — skip silently
      }
    }

    setIsAutoConnecting(false);
  }, [setupPeer]);

  // Manual connect — shows the browser device picker
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
      // acceptAllDevices: avoids empty picker when BitChat isn't advertising its NUS service UUID
      // optionalServices: grants access to NUS service after the user picks the device
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [BITCHAT_SERVICE],
      });

      const server = await device.gatt!.connect();
      await sleep(300); // let GATT stabilise before enumerating services

      const ok = await setupPeer(device, server, false);
      if (!ok) {
        toast({
          title: "BitChat Not Found on That Device",
          description: "Make sure the BitChat app is open and in the foreground on that device, then try again.",
          variant: "destructive",
        });
        return;
      }

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
  }, [toast, setupPeer]);

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
    isAutoConnecting,
    peerCount,
    connect,
    disconnect,
    autoConnect,
  };
}
