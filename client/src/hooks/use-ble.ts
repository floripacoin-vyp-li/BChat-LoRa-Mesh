import { useState, useCallback } from "react";
import { useToast } from "./use-toast";
import {
  buildWantConfig,
  processFromRadio,
  postSystemMessage,
} from "@/lib/meshtastic";

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

async function readAllFromRadio(fromRadioChar: BluetoothRemoteGATTCharacteristic): Promise<void> {
  if (isReading) return;
  isReading = true;
  try {
    while (true) {
      const data = await fromRadioChar.readValue();
      if (data.byteLength === 0) break;
      console.log(`BLE: fromRadio packet — ${data.byteLength} bytes`);
      processFromRadio(new Uint8Array(data.buffer));
    }
  } catch (e) {
    console.warn("BLE: readAllFromRadio error:", e);
  } finally {
    isReading = false;
  }
}

function cleanupListeners(): void {
  if (cachedDevice && onDisconnectHandler) {
    cachedDevice.removeEventListener("gattserverdisconnected", onDisconnectHandler);
    onDisconnectHandler = null;
  }
  if (cachedFromNumChar && fromNumHandler) {
    cachedFromNumChar.removeEventListener("characteristicvaluechanged", fromNumHandler);
    fromNumHandler = null;
  }
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

      cleanupListeners();

      console.log("BLE: Connecting to GATT...");
      const server = await device.gatt!.connect();
      console.log("BLE: GATT connected");

      let service: BluetoothRemoteGATTService;
      try {
        service = await server.getPrimaryService(SERVICE_UUID);
      } catch (e) {
        setState({ isConnected: false, deviceName: null, isConnecting: false });
        toast({
          title: "Meshtastic Service Not Found",
          description: "Check that your node has BLE enabled in its config.",
          variant: "destructive",
        });
        return;
      }

      // ── TORADIO is the only mandatory characteristic — without it TX is impossible ──
      // Android's GATT stack often fails characteristic discovery on the first attempt;
      // retry up to 3 times with a short delay before giving up.
      let toRadioChar: BluetoothRemoteGATTCharacteristic | null = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          toRadioChar = await service.getCharacteristic(TORADIO_UUID);
          break;
        } catch (e) {
          if (attempt === 3) throw e;
          console.warn(`BLE: TORADIO discovery attempt ${attempt} failed — retrying...`);
          await new Promise((r) => setTimeout(r, 600));
        }
      }
      if (!toRadioChar) throw new Error("TORADIO characteristic not found after retries");

      // Assign send function immediately using writeValueWithoutResponse (Android-compatible)
      // with graceful fallback to the deprecated writeValue for older browsers.
      (window as any).meshtasticDevice = device;
      (window as any)._meshtasticTransport = "ble";
      (window as any).meshtasticSend = async (bytes: Uint8Array) => {
        // Check the characteristic's actual property flags — not just method existence.
        // writeValueWithoutResponse exists on the prototype in all modern Chrome versions
        // but throws NotSupportedError if the characteristic doesn't advertise the property.
        if (toRadioChar.properties?.writeWithoutResponse) {
          return toRadioChar.writeValueWithoutResponse(bytes);
        }
        if (typeof (toRadioChar as any).writeValueWithResponse === "function") {
          return (toRadioChar as any).writeValueWithResponse(bytes);
        }
        return toRadioChar.writeValue(bytes);
      };
      window.dispatchEvent(new CustomEvent("meshtastic-ready", { detail: true }));

      // Mark connected immediately — RX characteristic failures below are non-fatal
      setState({
        isConnected: true,
        deviceName: device.name || "Meshtastic Node",
        isConnecting: false,
      });

      toast({ title: "BLE Connected", description: `Bridged to ${device.name || "Meshtastic Node"}.` });

      // ── FROMRADIO: optional — needed for reception; TX works without it ──────
      let fromRadioChar: BluetoothRemoteGATTCharacteristic | null = null;
      try {
        fromRadioChar = await service.getCharacteristic(FROMRADIO_UUID);
        console.log("BLE: FROMRADIO characteristic found");
      } catch (e) {
        console.warn("BLE: FROMRADIO not found — RX unavailable, TX still works:", e);
      }

      // ── FROMNUM: optional — only useful if FROMRADIO also succeeded ──────────
      let fromNumChar: BluetoothRemoteGATTCharacteristic | null = null;
      if (fromRadioChar) {
        try {
          fromNumChar = await service.getCharacteristic(FROMNUM_UUID);
          cachedFromNumChar = fromNumChar;
          console.log("BLE: FROMNUM characteristic found");
        } catch (e) {
          console.warn("BLE: FROMNUM not found — notifications unavailable, poll only:", e);
        }
      }

      // ── Phase 2: Handshake & notification setup (non-fatal) ─────────────────
      if (fromRadioChar) {
        try {
          console.log("BLE: Sending wantConfigId handshake...");
          await (async () => {
            const cfg = buildWantConfig();
            if (toRadioChar.properties?.writeWithoutResponse) {
              return toRadioChar.writeValueWithoutResponse(cfg);
            }
            if (typeof (toRadioChar as any).writeValueWithResponse === "function") {
              return (toRadioChar as any).writeValueWithResponse(cfg);
            }
            return toRadioChar.writeValue(cfg);
          })();

          console.log("BLE: Initial fromRadio drain...");
          await readAllFromRadio(fromRadioChar);
        } catch (e) {
          console.warn("BLE: Initial handshake failed — radio still usable for TX:", e);
        }

        if (fromNumChar) {
          try {
            await fromNumChar.startNotifications();
            fromNumHandler = async () => {
              console.log("BLE: fromNum notify fired");
              if (fromRadioChar) await readAllFromRadio(fromRadioChar);
            };
            fromNumChar.addEventListener("characteristicvaluechanged", fromNumHandler);
            console.log("BLE: fromNum notifications active");
          } catch (e) {
            console.warn("BLE: fromNum startNotifications failed, relying on poll only:", e);
          }
        }

        const pollInterval = setInterval(() => fromRadioChar && readAllFromRadio(fromRadioChar), 3000);
        (window as any)._bleFromRadioPoll = pollInterval;
      } else {
        console.warn("BLE: RX unavailable — TX only mode");
      }

      postSystemMessage(`UPLINK ESTABLISHED: Bridged to ${device.name || "Meshtastic Node"} via BLE. LoRa terminal active.`);

      onDisconnectHandler = () => {
        console.log("BLE: gattserverdisconnected");
        clearInterval((window as any)._bleFromRadioPoll);
        isReading = false;
        if ((window as any)._meshtasticTransport === "ble") {
          (window as any).meshtasticSend = undefined;
          (window as any)._meshtasticTransport = null;
          window.dispatchEvent(new CustomEvent("meshtastic-ready", { detail: false }));
        }
        setState({ isConnected: false, deviceName: null, isConnecting: false });
        toast({ title: "Disconnected", description: "Node link lost.", variant: "destructive" });
      };
      device.addEventListener("gattserverdisconnected", onDisconnectHandler);

    } catch (error: any) {
      // ── Phase 1 failure: GATT-level — truly unrecoverable ───────────────────
      console.error("BLE Error:", error?.name, error?.message);
      (window as any).meshtasticSend = undefined;
      (window as any)._meshtasticTransport = null;
      window.dispatchEvent(new CustomEvent("meshtastic-ready", { detail: false }));
      setState({ isConnected: false, deviceName: null, isConnecting: false });
      if (cachedDevice && error?.name !== "NotFoundError") {
        console.warn("BLE: Cached device failed — clearing cache");
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
    if ((window as any)._meshtasticTransport === "ble") {
      (window as any).meshtasticSend = undefined;
      (window as any)._meshtasticTransport = null;
    }
    setState({ isConnected: false, deviceName: null, isConnecting: false });
    toast({ title: "Disconnected", description: "Manually disconnected." });
  }, [toast]);

  return { ...state, connect, disconnect };
}
