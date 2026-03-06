import { useState, useCallback } from "react";
import { useToast } from "./use-toast";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import { Mesh, Portnums } from "@meshtastic/protobufs";

interface BLEState {
  isConnected: boolean;
  deviceName: string | null;
  isConnecting: boolean;
}

// Meshtastic BLE UUIDs (firmware 2.x)
const SERVICE_UUID    = "6ba1b218-15a8-461f-9fa8-5dcae273eafd";
const TORADIO_UUID    = "f75c76d2-129e-4dad-a1dd-7866124401e7"; // WRITE
const FROMRADIO_UUID  = "2c55e69e-4993-11ed-b878-0242ac120002"; // READ
const FROMNUM_UUID    = "ed9da18c-a800-4f66-a670-aa7547e34453"; // NOTIFY

function postMessage(sender: string, content: string): void {
  fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender, content }),
  }).then(() => {
    (window as any).queryClient?.invalidateQueries({ queryKey: ["/api/messages"] });
  }).catch(err => console.error("BLE: Failed to post message:", err));
}

function processFromRadioBytes(bytes: Uint8Array): void {
  try {
    const fromRadio = fromBinary(Mesh.FromRadioSchema, bytes);
    const variant = fromRadio.payloadVariant.case;
    console.log("BLE: FromRadio variant:", variant);

    if (variant === "packet") {
      const packet = fromRadio.payloadVariant.value;
      const from = packet.from >>> 0; // node ID (unsigned)
      const payloadVariant = packet.payloadVariant.case;
      console.log(`BLE: Mesh packet from node 0x${from.toString(16)}, payload: ${payloadVariant}`);

      if (payloadVariant === "decoded") {
        const decoded = packet.payloadVariant.value;
        console.log("BLE: Portnum:", decoded.portnum);

        if (decoded.portnum === Portnums.PortNum.TEXT_MESSAGE_APP) {
          const text = new TextDecoder().decode(decoded.payload);
          console.log("BLE: Text message:", text);
          if (text.trim().length > 0) {
            postMessage("node", `[${from.toString(16).toUpperCase()}] ${text}`);
          }
        }
      } else if (payloadVariant === "encrypted") {
        console.log("BLE: Encrypted packet received — node may be on a non-default channel key");
      }
    }
  } catch (e) {
    console.error("BLE: processFromRadio error:", e);
  }
}

async function drainFromRadio(fromRadioChar: BluetoothRemoteGATTCharacteristic): Promise<void> {
  let attempts = 0;
  while (attempts < 30) {
    try {
      const value = await fromRadioChar.readValue();
      if (value.byteLength === 0) {
        console.log("BLE: fromRadio queue drained");
        break;
      }
      console.log(`BLE: fromRadio packet ${attempts + 1} — ${value.byteLength} bytes`);
      processFromRadioBytes(new Uint8Array(value.buffer));
      attempts++;
    } catch (e) {
      console.error("BLE: drainFromRadio error:", e);
      break;
    }
  }
}

export function buildTextToRadio(text: string): Uint8Array {
  const packet = create(Mesh.MeshPacketSchema, {
    to: 0xffffffff,
    wantAck: true,
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
      console.log("BLE: Requesting device...");
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SERVICE_UUID],
      });

      console.log("BLE: Device selected:", device.name);
      const server = await device.gatt.connect();
      console.log("BLE: GATT connected");

      let service: BluetoothRemoteGATTService;
      try {
        service = await server.getPrimaryService(SERVICE_UUID);
        console.log("BLE: Meshtastic service found");
      } catch {
        setState({ isConnected: false, deviceName: null, isConnecting: false });
        toast({
          title: "Meshtastic Service Not Found",
          description: "Ensure BLE is enabled in your node's config.",
          variant: "destructive",
        });
        return;
      }

      const toRadioChar  = await service.getCharacteristic(TORADIO_UUID);
      const fromRadioChar = await service.getCharacteristic(FROMRADIO_UUID);
      const fromNumChar  = await service.getCharacteristic(FROMNUM_UUID);

      (window as any).meshtasticToRadio = toRadioChar;
      (window as any).meshtasticDevice  = device;

      setState({
        isConnected: true,
        deviceName: device.name || "Meshtastic Node",
        isConnecting: false,
      });

      // Subscribe to fromNum BEFORE draining — so we don't miss notifications
      // that arrive during the initial drain
      await fromNumChar.startNotifications();
      fromNumChar.addEventListener("characteristicvaluechanged", (event: Event) => {
        const v = (event.target as BluetoothRemoteGATTCharacteristic).value;
        if (v) {
          const fromNum = v.getUint32(0, true); // little-endian
          console.log(`BLE: fromNum notify — packet #${fromNum} available`);
        }
        // Drain the queue (fire-and-forget; errors logged inside)
        drainFromRadio(fromRadioChar).catch(e => console.error("BLE: drain error:", e));
      });

      // Drain any packets already queued (startup NodeInfo, MyInfo, etc.)
      console.log("BLE: Initial drain...");
      await drainFromRadio(fromRadioChar);

      // System message
      postMessage(
        "system",
        `UPLINK ESTABLISHED: Bridged to ${device.name || "Meshtastic Node"}. LoRa terminal active.`
      );
      window.dispatchEvent(new CustomEvent("ble-connected"));
      (window as any).queryClient?.invalidateQueries({ queryKey: ["/api/messages"] });

      const onDisconnect = () => {
        console.log("BLE: Disconnected");
        setState({ isConnected: false, deviceName: null, isConnecting: false });
        toast({ title: "Disconnected", description: "Node link lost.", variant: "destructive" });
      };

      device.addEventListener("gattserverdisconnected", onDisconnect);
      (window as any)._onDisconnect = onDisconnect;

      toast({ title: "Connected", description: `Bridged to ${device.name}.` });
    } catch (error: any) {
      console.error("BLE Error:", error);
      setState({ isConnected: false, deviceName: null, isConnecting: false });
      if (error.name !== "NotFoundError") {
        toast({
          title: "Connection Failed",
          description: error.message || "BLE pairing failed.",
          variant: "destructive",
        });
      }
    } finally {
      setState((prev) => ({ ...prev, isConnecting: false }));
    }
  }, [toast]);

  const disconnect = useCallback(() => {
    if ((window as any).meshtasticDevice) {
      (window as any).meshtasticDevice.gatt.disconnect();
    }
    setState({ isConnected: false, deviceName: null, isConnecting: false });
    toast({ title: "Disconnected", description: "Manually disconnected." });
  }, [toast]);

  return { ...state, connect, disconnect };
}
