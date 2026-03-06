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
const SERVICE_UUID   = "6ba1b218-15a8-461f-9fa8-5dcae273eafd";
const TORADIO_UUID   = "f75c76d2-129e-4dad-a1dd-7866124401e7";
const FROMRADIO_UUID = "2c55e69e-4993-11ed-b878-0242ac120002";
const FROMNUM_UUID   = "ed9da18c-a800-4f66-a670-aa7547e34453";

// Guard against concurrent reads on the same characteristic
let isReading = false;

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

    if (variant === "packet") {
      const packet = fromRadio.payloadVariant.value;
      const from = (packet.from >>> 0).toString(16).toUpperCase();
      const payloadCase = packet.payloadVariant.case;
      console.log(`BLE: Mesh packet from 0x${from}, payload: ${payloadCase}`);

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
              body: JSON.stringify({ sender: "node", content: `[${from}] ${text}` }),
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

      (window as any).meshtasticToRadio = toRadioChar;
      (window as any).meshtasticDevice  = device;
      isReading = false; // reset guard on new connection

      setState({
        isConnected: true,
        deviceName: device.name || "Meshtastic Node",
        isConnecting: false,
      });

      // Initial drain
      console.log("BLE: Initial fromRadio drain...");
      await readAllFromRadio(fromRadioChar);

      // Primary receive path: fromNum notifications
      try {
        await fromNumChar.startNotifications();
        fromNumChar.addEventListener("characteristicvaluechanged", async () => {
          console.log("BLE: fromNum notify fired — polling fromRadio");
          await readAllFromRadio(fromRadioChar);
        });
        console.log("BLE: fromNum notifications active");
      } catch (e) {
        console.warn("BLE: fromNum startNotifications failed, relying on poll only:", e);
      }

      // Fallback receive path: poll fromRadio every 3 seconds
      // Catches messages when notifications are silent (firmware quirks)
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

      const onDisconnect = () => {
        console.log("BLE: Disconnected");
        clearInterval((window as any)._bleFromRadioPoll);
        isReading = false;
        setState({ isConnected: false, deviceName: null, isConnecting: false });
        toast({ title: "Disconnected", description: "Node link lost.", variant: "destructive" });
      };

      device.addEventListener("gattserverdisconnected", onDisconnect);
      (window as any)._onDisconnect = onDisconnect;

      toast({ title: "Connected", description: `Bridged to ${device.name}.` });
    } catch (error: any) {
      console.error("BLE Error:", error?.name, error?.message);
      setState({ isConnected: false, deviceName: null, isConnecting: false });
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
    clearInterval((window as any)._bleFromRadioPoll);
    isReading = false;
    if ((window as any).meshtasticDevice) {
      (window as any).meshtasticDevice.gatt.disconnect();
    }
    setState({ isConnected: false, deviceName: null, isConnecting: false });
    toast({ title: "Disconnected", description: "Manually disconnected." });
  }, [toast]);

  return { ...state, connect, disconnect };
}
