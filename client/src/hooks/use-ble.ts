import { useState, useCallback } from "react";
import { useToast } from "./use-toast";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import { Mesh, Portnums } from "@meshtastic/protobufs";

interface BLEState {
  isConnected: boolean;
  deviceName: string | null;
  isConnecting: boolean;
}

const SERVICE_UUID   = "6ba1b218-15a8-461f-9fa8-5dcae273eafd";
const TORADIO_UUID   = "f75c76d2-129e-4dad-a1dd-7866124401e7";
const FROMRADIO_UUID = "2c55e69e-4993-11ed-b878-0242ac120002";
const FROMNUM_UUID   = "ed9da18c-a800-4f66-a670-aa7547e34453";

// Module-level state — persists across React re-renders and reconnect attempts
let isReading = false;
let cachedDevice: BluetoothDevice | null = null;
let onDisconnectHandler: (() => void) | null = null;
let fromNumHandler: (() => void) | null = null;
let cachedFromNumChar: BluetoothRemoteGATTCharacteristic | null = null;

// Node ID (number) → short name, populated from nodeInfo packets during config download
const nodeNames = new Map<number, string>();

function resolveNodeName(nodeNum: number): string {
  const name = nodeNames.get(nodeNum);
  if (name && name.trim().length > 0) return name.trim();
  return (nodeNum >>> 0).toString(16).toUpperCase();
}

async function readAllFromRadio(fromRadioChar: BluetoothRemoteGATTCharacteristic): Promise<void> {
  if (isReading) {
    console.log("BLE: read already in progress, skipping");
    return;
  }
  isReading = true;
  try {
    while (true) {
      const data = await fromRadioChar.readValue();
      if (data.byteLength === 0) break;
      console.log(`BLE: fromRadio packet received — ${data.byteLength} bytes`);
      processFromRadio(new Uint8Array(data.buffer));
    }
  } catch (e) {
    console.warn("BLE: readAllFromRadio error:", e);
  } finally {
    isReading = false;
  }
}

function processFromRadio(bytes: Uint8Array): void {
  try {
    const fromRadio = fromBinary(Mesh.FromRadioSchema, bytes);
    const variant = fromRadio.payloadVariant.case;
    console.log("BLE: FromRadio packet:", variant);

    // Capture short names from nodeInfo packets delivered during config download
    if (variant === "nodeInfo") {
      const nodeInfo = fromRadio.payloadVariant.value;
      const shortName = nodeInfo.user?.shortName;
      if (nodeInfo.num && shortName) {
        nodeNames.set(nodeInfo.num, shortName);
        console.log(`BLE: Registered node 0x${(nodeInfo.num >>> 0).toString(16).toUpperCase()} → "${shortName}"`);
      }
      return;
    }

    if (variant === "packet") {
      const packet = fromRadio.payloadVariant.value;
      const payloadCase = packet.payloadVariant.case;
      const senderLabel = resolveNodeName(packet.from);
      console.log(`BLE: Mesh packet from "${senderLabel}", payload: ${payloadCase}`);

      if (payloadCase === "decoded") {
        const decoded = packet.payloadVariant.value;
        console.log("BLE: Portnum:", decoded.portnum);
        if (decoded.portnum === Portnums.PortNum.TEXT_MESSAGE_APP) {
          const text = new TextDecoder().decode(decoded.payload);
          console.log("BLE: Text message received:", text);
          if (text.trim().length > 0) {
            fetch("/api/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sender: "node", content: `[${senderLabel}] ${text}` }),
            }).then(() => {
              (window as any).queryClient?.invalidateQueries({ queryKey: ["/api/messages"] });
            });
          }
        }
      } else if (payloadCase === "encrypted") {
        console.log("BLE: Encrypted packet — channel key mismatch or non-default channel");
      }
    }
  } catch (e) {
    console.warn("BLE: Could not parse FromRadio packet:", e);
  }
}

export function buildWantConfig(): Uint8Array {
  const nonce = Math.floor(Math.random() * 0xffffffff) + 1;
  const toRadio = create(Mesh.ToRadioSchema, {
    payloadVariant: { case: "wantConfigId", value: nonce },
  });
  return toBinary(Mesh.ToRadioSchema, toRadio);
}

export function buildTextToRadio(text: string): Uint8Array {
  const packet = create(Mesh.MeshPacketSchema, {
    to: 0xffffffff,
    wantAck: false,
    payloadVariant: {
      case: "decoded",
      value: create(Mesh.DataSchema, {
        portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
        payload: new TextEncoder().encode(text),
      }),
    },
  });
  const toRadio = create(Mesh.ToRadioSchema, {
    payloadVariant: { case: "packet", value: packet },
  });
  return toBinary(Mesh.ToRadioSchema, toRadio);
}

function cleanupListeners(): void {
  // Remove previous disconnect handler so it doesn't fire stale state updates
  if (cachedDevice && onDisconnectHandler) {
    cachedDevice.removeEventListener("gattserverdisconnected", onDisconnectHandler);
    onDisconnectHandler = null;
  }
  // Remove previous fromNum handler to prevent duplicate message processing
  if (cachedFromNumChar && fromNumHandler) {
    cachedFromNumChar.removeEventListener("characteristicvaluechanged", fromNumHandler);
    fromNumHandler = null;
  }
  // Cancel previous poll
  clearInterval((window as any)._bleFromRadioPoll);
  isReading = false;
}

export function useBLE() {
  const [state, setState] = useState<BLEState>({
    isConnected: false,
    deviceName: null,
    isConnecting: false,
  });
  const { toast } = useToast();

  const connect = useCallback(async () => {
    if (!navigator || !(navigator as any).bluetooth) {
      toast({
        title: "Bluetooth Not Supported",
        description: "Web Bluetooth requires Chrome or Edge over HTTPS.",
        variant: "destructive",
      });
      return;
    }

    setState((prev) => ({ ...prev, isConnecting: true }));

    try {
      let device: BluetoothDevice;

      // Reuse the cached device to avoid forcing the user to re-pair after disconnect
      if (cachedDevice) {
        console.log("BLE: Reusing cached device:", cachedDevice.name);
        device = cachedDevice;
      } else {
        console.log("BLE: Requesting device...");
        device = await (navigator as any).bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [SERVICE_UUID],
        });
        cachedDevice = device;
        console.log("BLE: Device selected:", device.name);
      }

      // Clean up any leftover listeners from the previous session before connecting
      cleanupListeners();

      console.log("BLE: Connecting to GATT...");
      const server = await device.gatt!.connect();
      console.log("BLE: GATT connected");

      let service: BluetoothRemoteGATTService;
      try {
        service = await server.getPrimaryService(SERVICE_UUID);
        console.log("BLE: Meshtastic service found");
      } catch (e) {
        setState({ isConnected: false, deviceName: null, isConnecting: false });
        toast({
          title: "Meshtastic Service Not Found",
          description: "Check that your node has BLE enabled in its config.",
          variant: "destructive",
        });
        return;
      }

      const toRadioChar   = await service.getCharacteristic(TORADIO_UUID);
      const fromRadioChar = await service.getCharacteristic(FROMRADIO_UUID);
      const fromNumChar   = await service.getCharacteristic(FROMNUM_UUID);

      cachedFromNumChar = fromNumChar;
      (window as any).meshtasticToRadio = toRadioChar;
      (window as any).meshtasticDevice  = device;

      setState({
        isConnected: true,
        deviceName: device.name || "Meshtastic Node",
        isConnecting: false,
      });

      // REQUIRED handshake: tells the firmware to start forwarding received LoRa messages
      console.log("BLE: Sending wantConfigId handshake...");
      await toRadioChar.writeValue(buildWantConfig());

      // Initial drain — NodeInfo / config / any queued LoRa messages
      console.log("BLE: Initial fromRadio drain...");
      await readAllFromRadio(fromRadioChar);

      // Primary receive path: fromNum notifications
      try {
        await fromNumChar.startNotifications();
        fromNumHandler = async () => {
          console.log("BLE: fromNum notify fired — polling fromRadio");
          await readAllFromRadio(fromRadioChar);
        };
        fromNumChar.addEventListener("characteristicvaluechanged", fromNumHandler);
        console.log("BLE: fromNum notifications active");
      } catch (e) {
        console.warn("BLE: fromNum startNotifications failed, relying on poll only:", e);
      }

      // Fallback receive path: poll every 3 seconds
      const pollInterval = setInterval(() => {
        readAllFromRadio(fromRadioChar);
      }, 3000);
      (window as any)._bleFromRadioPoll = pollInterval;

      console.log("BLE: Fully initialised. Notifications + 3 s poll active.");

      fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "system",
          content: `UPLINK ESTABLISHED: Bridged to ${device.name || "Meshtastic Node"}. LoRa terminal active.`,
        }),
      }).then(() => {
        window.dispatchEvent(new CustomEvent("ble-connected"));
        (window as any).queryClient?.invalidateQueries({ queryKey: ["/api/messages"] });
      });

      // Register disconnect handler
      onDisconnectHandler = () => {
        console.log("BLE: gattserverdisconnected event fired");
        clearInterval((window as any)._bleFromRadioPoll);
        isReading = false;
        setState({ isConnected: false, deviceName: null, isConnecting: false });
        toast({ title: "Disconnected", description: "Node link lost.", variant: "destructive" });
      };
      device.addEventListener("gattserverdisconnected", onDisconnectHandler);

      toast({ title: "Connected", description: `Bridged to ${device.name}.` });
    } catch (error: any) {
      console.error("BLE Error:", error?.name, error?.message);
      setState({ isConnected: false, deviceName: null, isConnecting: false });
      // If a reconnect to a cached device fails, forget it so next click shows the picker
      if (cachedDevice && error?.name !== "NotFoundError") {
        console.warn("BLE: Cached device connect failed — clearing cache");
        cachedDevice = null;
      }
      if (error?.name !== "NotFoundError") {
        toast({
          title: "Connection Failed",
          description: error?.message || "BLE pairing failed.",
          variant: "destructive",
        });
      }
    } finally {
      setState((prev) => ({ ...prev, isConnecting: false }));
    }
  }, [toast]);

  const disconnect = useCallback(() => {
    cleanupListeners();
    if (cachedDevice?.gatt?.connected) {
      cachedDevice.gatt.disconnect();
    }
    setState({ isConnected: false, deviceName: null, isConnecting: false });
    toast({ title: "Disconnected", description: "Manually disconnected." });
  }, [toast]);

  return { ...state, connect, disconnect };
}
