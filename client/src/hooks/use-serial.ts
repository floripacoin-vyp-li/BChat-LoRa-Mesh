import { useState, useCallback } from "react";
import { useToast } from "./use-toast";
import {
  buildWantConfig,
  frameForSerial,
  processFromRadio,
  postSystemMessage,
  SERIAL_START1,
  SERIAL_START2,
  SERIAL_MAX_PACKET,
} from "@/lib/meshtastic";

interface SerialState {
  isConnected: boolean;
  deviceName: string | null;
  isConnecting: boolean;
}

// Module-level — persists across renders
let serialPort: SerialPort | null = null;
let serialReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let serialWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
let serialReading = false;

async function serialSend(bytes: Uint8Array): Promise<void> {
  if (!serialWriter) return;
  try {
    await serialWriter.write(frameForSerial(bytes));
  } catch (e) {
    console.warn("Serial: write error:", e);
  }
}

// State-machine parser for Meshtastic serial stream
// Framing: 0x94 0xC3 [MSB length] [LSB length] [payload...]
enum ParseState { WAIT_START1, WAIT_START2, READ_LEN_MSB, READ_LEN_LSB, READ_PAYLOAD }

async function runSerialReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onDone: () => void,
): Promise<void> {
  if (serialReading) return;
  serialReading = true;

  let state = ParseState.WAIT_START1;
  let payloadLen = 0;
  let payloadBuf = new Uint8Array(0);
  let payloadIdx = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      for (let i = 0; i < value.length; i++) {
        const byte = value[i];

        switch (state) {
          case ParseState.WAIT_START1:
            if (byte === SERIAL_START1) state = ParseState.WAIT_START2;
            break;

          case ParseState.WAIT_START2:
            if (byte === SERIAL_START2) state = ParseState.READ_LEN_MSB;
            else if (byte === SERIAL_START1) state = ParseState.WAIT_START2;
            else state = ParseState.WAIT_START1;
            break;

          case ParseState.READ_LEN_MSB:
            payloadLen = byte << 8;
            state = ParseState.READ_LEN_LSB;
            break;

          case ParseState.READ_LEN_LSB:
            payloadLen |= byte;
            if (payloadLen === 0 || payloadLen > SERIAL_MAX_PACKET) {
              console.warn("Serial: bad packet length", payloadLen, "— resyncing");
              state = ParseState.WAIT_START1;
            } else {
              payloadBuf = new Uint8Array(payloadLen);
              payloadIdx = 0;
              state = ParseState.READ_PAYLOAD;
            }
            break;

          case ParseState.READ_PAYLOAD:
            payloadBuf[payloadIdx++] = byte;
            if (payloadIdx === payloadLen) {
              console.log(`Serial: packet complete — ${payloadLen} bytes`);
              processFromRadio(payloadBuf.slice());
              state = ParseState.WAIT_START1;
            }
            break;
        }
      }
    }
  } catch (e) {
    if ((e as any)?.name !== "AbortError") {
      console.warn("Serial: reader error:", e);
    }
  } finally {
    serialReading = false;
    onDone();
  }
}

export function useSerial() {
  const [state, setState] = useState<SerialState>({
    isConnected: false,
    deviceName: null,
    isConnecting: false,
  });
  const { toast } = useToast();

  const connect = useCallback(async () => {
    if (!("serial" in navigator)) {
      toast({
        title: "Serial Not Supported",
        description: "Web Serial requires Chrome 89+ on desktop, or Chrome 126+ on Android with USB OTG.",
        variant: "destructive",
      });
      return;
    }

    setState((prev) => ({ ...prev, isConnecting: true }));

    try {
      console.log("Serial: Requesting port...");
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 115200 });
      serialPort = port;
      console.log("Serial: Port opened at 115200 baud");

      serialWriter = port.writable.getWriter();
      serialReader = port.readable.getReader();

      // Assert DTR+RTS — some firmware versions require this before forwarding packets
      try {
        await port.setSignals({ dataTerminalReady: true, requestToSend: true });
        console.log("Serial: DTR/RTS asserted");
      } catch (_) {
        console.log("Serial: setSignals not supported on this platform");
      }

      (window as any)._meshtasticTransport = "serial";
      (window as any).meshtasticSend = serialSend;
      window.dispatchEvent(new CustomEvent("meshtastic-ready", { detail: true }));

      // Determine a display name from port info if available
      let portLabel = "USB Serial";
      try {
        const info = await port.getInfo();
        if (info?.usbVendorId) portLabel = `USB ${info.usbVendorId.toString(16).toUpperCase()}`;
      } catch (_) {}

      setState({ isConnected: true, deviceName: portLabel, isConnecting: false });

      // Start the reader loop FIRST so no bytes are missed when the firmware
      // sends its config burst in response to the wantConfigId handshake below.
      // Reset the guard to ensure a clean start regardless of prior session state.
      serialReading = false;
      runSerialReader(serialReader, () => {
        if ((window as any)._meshtasticTransport === "serial") {
          (window as any).meshtasticSend = undefined;
          (window as any)._meshtasticTransport = null;
          window.dispatchEvent(new CustomEvent("meshtastic-ready", { detail: false }));
        }
        setState({ isConnected: false, deviceName: null, isConnecting: false });
        toast({ title: "Serial Disconnected", description: "USB link lost.", variant: "destructive" });
      });

      // Required handshake: triggers config download + LoRa forwarding.
      // Sent AFTER the reader is running so we catch every response byte.
      console.log("Serial: Sending wantConfigId handshake...");
      await serialSend(buildWantConfig());

      postSystemMessage(`UPLINK ESTABLISHED: Bridged to ${portLabel} via Serial. LoRa terminal active.`);
      toast({ title: "Serial Connected", description: `Bridged to ${portLabel}.` });

    } catch (error: any) {
      console.error("Serial Error:", error?.name, error?.message);
      setState({ isConnected: false, deviceName: null, isConnecting: false });
      if (error?.name !== "NotFoundError") {
        toast({
          title: "Serial Connection Failed",
          description: error?.message || "Could not open serial port.",
          variant: "destructive",
        });
      }
    } finally {
      setState((prev) => ({ ...prev, isConnecting: false }));
    }
  }, [toast]);

  const disconnect = useCallback(async () => {
    try {
      if (serialReader) {
        await serialReader.cancel();
        serialReader.releaseLock();
        serialReader = null;
      }
    } catch (_) {}
    try {
      if (serialWriter) {
        await serialWriter.close();
        serialWriter.releaseLock();
        serialWriter = null;
      }
    } catch (_) {}
    try {
      if (serialPort) {
        await serialPort.close();
        serialPort = null;
      }
    } catch (_) {}

    if ((window as any)._meshtasticTransport === "serial") {
      (window as any).meshtasticSend = undefined;
      (window as any)._meshtasticTransport = null;
      window.dispatchEvent(new CustomEvent("meshtastic-ready", { detail: false }));
    }

    setState({ isConnected: false, deviceName: null, isConnecting: false });
    toast({ title: "Disconnected", description: "Serial port closed." });
  }, [toast]);

  return { ...state, connect, disconnect };
}
