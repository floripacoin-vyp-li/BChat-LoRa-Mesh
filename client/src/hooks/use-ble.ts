import { useState, useCallback } from "react";
import { useToast } from "./use-toast";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import { Mesh, Portnums } from "@meshtastic/protobufs";

interface BLEState {
  isConnected: boolean;
  deviceName: string | null;
  isConnecting: boolean;
}

// Correct Meshtastic BLE UUIDs (firmware 2.x)
const SERVICE_UUID = "6ba1b218-15a8-461f-9fa8-5dcae273eafd";
const TORADIO_UUID = "f75c76d2-129e-4dad-a1dd-7866124401e7";
const FROMRADIO_UUID = "2c55e69e-4993-11ed-b878-0242ac120002";
const FROMNUM_UUID = "ed9da18c-a800-4f66-a670-aa7547e34453";

async function readAllFromRadio(fromRadioChar: BluetoothRemoteGATTCharacteristic): Promise<void> {
  while (true) {
    const data = await fromRadioChar.readValue();
    if (data.byteLength === 0) break;
    processFromRadio(new Uint8Array(data.buffer));
  }
}

function processFromRadio(bytes: Uint8Array): void {
  try {
    const fromRadio = fromBinary(Mesh.FromRadioSchema, bytes);
    console.log("BLE: FromRadio packet:", fromRadio.payloadVariant.case);

    if (fromRadio.payloadVariant.case === "packet") {
      const packet = fromRadio.payloadVariant.value;
      const from = packet.from >>> 0;
      const payloadCase = packet.payloadVariant.case;
      console.log(`BLE: Mesh packet from node 0x${from.toString(16)}, payload: ${payloadCase}`);

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
              body: JSON.stringify({
                sender: "node",
                content: `[${from.toString(16).toUpperCase()}] ${text}`,
              }),
            }).then(() => {
              (window as any).queryClient?.invalidateQueries({ queryKey: ["/api/messages"] });
            });
          }
        }
      } else if (payloadCase === "encrypted") {
        console.log("BLE: Encrypted packet — node may use a non-default channel key");
      }
    }
  } catch (e) {
    console.warn("BLE: Could not parse FromRadio packet:", e);
  }
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
      } catch (e) {
        console.error("BLE: Meshtastic service NOT found. Is the node powered on and in BLE mode?");
        setState({ isConnected: false, deviceName: null, isConnecting: false });
        toast({
          title: "Meshtastic Service Not Found",
          description: "Device does not expose the Meshtastic BLE service. Check that your node has BLE enabled in its config.",
          variant: "destructive",
        });
        return;
      }

      const toRadioChar = await service.getCharacteristic(TORADIO_UUID);
      const fromRadioChar = await service.getCharacteristic(FROMRADIO_UUID);
      const fromNumChar = await service.getCharacteristic(FROMNUM_UUID);

      (window as any).meshtasticToRadio = toRadioChar;
      (window as any).meshtasticDevice = device;

      setState({
        isConnected: true,
        deviceName: device.name || "Meshtastic Node",
        isConnecting: false,
      });

      // Initial sync: read all pending packets from node
      console.log("BLE: Reading initial packets from radio...");
      await readAllFromRadio(fromRadioChar);

      // Subscribe to fromNum — fires when a new packet is available in fromRadio
      await fromNumChar.startNotifications();
      fromNumChar.addEventListener("characteristicvaluechanged", async () => {
        console.log("BLE: fromNum notify — reading fromRadio...");
        await readAllFromRadio(fromRadioChar);
      });

      console.log("BLE: Fully initialised. Listening for LoRa messages.");

      // Post connection system message
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
