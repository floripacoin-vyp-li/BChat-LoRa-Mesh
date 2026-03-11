import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import { Mesh, Portnums } from "@meshtastic/protobufs";
import { serverReachable } from "@/hooks/use-connectivity";

// Serial framing constants (Meshtastic stream protocol)
export const SERIAL_START1 = 0x94;
export const SERIAL_START2 = 0xc3;
export const SERIAL_MAX_PACKET = 512;

// BLB (BitChat LoRa Bridge) — opaque BitChat bytes carried over LoRa
export const BITCHAT_PORT = 256; // Meshtastic PRIVATE_APP portnum

export function frameForSerial(payload: Uint8Array): Uint8Array {
  const len = payload.length;
  const framed = new Uint8Array(4 + len);
  framed[0] = SERIAL_START1;
  framed[1] = SERIAL_START2;
  framed[2] = (len >> 8) & 0xff;
  framed[3] = len & 0xff;
  framed.set(payload, 4);
  return framed;
}

// Node ID → short name registry, shared across both transports
const nodeNames = new Map<number, string>();

export function resolveNodeName(nodeNum: number): string {
  const name = nodeNames.get(nodeNum);
  if (name && name.trim().length > 0) return name.trim();
  return (nodeNum >>> 0).toString(16).toUpperCase();
}

function dispatchLocalMessage(detail: {
  id: number;
  sender: string;
  content: string;
  timestamp: string;
  transmitted: boolean;
  claimedBy: null;
  loraPacketId: string | undefined;
}) {
  window.dispatchEvent(new CustomEvent("local-message", { detail }));
}

export function processFromRadio(bytes: Uint8Array): void {
  try {
    const fromRadio = fromBinary(Mesh.FromRadioSchema, bytes);
    const variant = fromRadio.payloadVariant.case;
    console.log("Mesh: FromRadio packet:", variant);

    if (variant === "nodeInfo") {
      const nodeInfo = fromRadio.payloadVariant.value;
      const shortName = nodeInfo.user?.shortName;
      if (nodeInfo.num && shortName) {
        nodeNames.set(nodeInfo.num, shortName);
        console.log(`Mesh: Registered 0x${(nodeInfo.num >>> 0).toString(16).toUpperCase()} → "${shortName}"`);
      }
      return;
    }

    if (variant === "packet") {
      const packet = fromRadio.payloadVariant.value;
      const payloadCase = packet.payloadVariant.case;
      const senderLabel = resolveNodeName(packet.from);
      const loraPacketId = packet.id ? String(packet.id) : undefined;
      console.log(`Mesh: Packet from "${senderLabel}", type: ${payloadCase}, packetId: ${loraPacketId}`);

      if (payloadCase === "decoded") {
        const decoded = packet.payloadVariant.value;

        if (decoded.portnum === Portnums.PortNum.TEXT_MESSAGE_APP) {
          const text = new TextDecoder().decode(decoded.payload);
          console.log("Mesh: Text message:", text);
          if (text.trim().length > 0) {
            const content = `[${senderLabel}] ${text}`;

            if (!serverReachable) {
              console.log("Mesh: Server unreachable — routing incoming packet to local cache");
              dispatchLocalMessage({
                id: Date.now(),
                sender: "node",
                content,
                timestamp: new Date().toISOString(),
                transmitted: true,
                claimedBy: null,
                loraPacketId,
              });
              return;
            }

            fetch("/api/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sender: "node", content, transmitted: true, loraPacketId }),
            }).then(() => {
              (window as any).queryClient?.invalidateQueries({ queryKey: ["/api/messages"] });
            }).catch((err) => {
              console.warn("Mesh: Server POST failed — routing incoming packet to local cache:", err);
              dispatchLocalMessage({
                id: Date.now(),
                sender: "node",
                content,
                timestamp: new Date().toISOString(),
                transmitted: true,
                claimedBy: null,
                loraPacketId,
              });
            });
          }
        } else if (decoded.portnum === BITCHAT_PORT) {
          const blbBytes = decoded.payload;
          console.log(`BLB: LoRa → BitChat (${blbBytes.length}B from ${senderLabel})`);
          (window as any).bitchatSend?.(blbBytes);

          const content = `[BLB] LoRa → BitChat: ${blbBytes.length}B from ${senderLabel}`;

          if (!serverReachable) {
            console.log("Mesh: Server unreachable — routing BLB packet to local cache");
            dispatchLocalMessage({
              id: Date.now(),
              sender: "system",
              content,
              timestamp: new Date().toISOString(),
              transmitted: true,
              claimedBy: null,
              loraPacketId,
            });
            return;
          }

          fetch("/api/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sender: "system", content, transmitted: true, loraPacketId }),
          }).then(() => {
            (window as any).queryClient?.invalidateQueries({ queryKey: ["/api/messages"] });
          }).catch((err) => {
            console.warn("Mesh: Server POST failed — routing BLB packet to local cache:", err);
            dispatchLocalMessage({
              id: Date.now(),
              sender: "system",
              content,
              timestamp: new Date().toISOString(),
              transmitted: true,
              claimedBy: null,
              loraPacketId,
            });
          });
        }
      } else if (payloadCase === "encrypted") {
        console.log("Mesh: Encrypted packet — channel key mismatch or non-default channel");
      }
    }
  } catch (e) {
    console.warn("Mesh: Could not parse FromRadio packet:", e);
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

export function buildBitchatToRadio(bytes: Uint8Array): Uint8Array {
  const packet = create(Mesh.MeshPacketSchema, {
    to: 0xffffffff,
    wantAck: false,
    payloadVariant: {
      case: "decoded",
      value: create(Mesh.DataSchema, {
        portnum: BITCHAT_PORT,
        payload: bytes,
      }),
    },
  });
  const toRadio = create(Mesh.ToRadioSchema, {
    payloadVariant: { case: "packet", value: packet },
  });
  return toBinary(Mesh.ToRadioSchema, toRadio);
}

function dispatchSystemLocal(content: string): void {
  console.log("Mesh: Server unreachable — routing system message to local cache");
  dispatchLocalMessage({
    id: Date.now(),
    sender: "system",
    content,
    timestamp: new Date().toISOString(),
    transmitted: true,
    claimedBy: null,
    loraPacketId: undefined,
  });
  window.dispatchEvent(new CustomEvent("ble-connected"));
}

export function postSystemMessage(content: string): void {
  if (!serverReachable) {
    dispatchSystemLocal(content);
    return;
  }

  fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: "system", content, transmitted: true }),
  }).then((res) => {
    if (!res.ok) throw new Error("server error");
    window.dispatchEvent(new CustomEvent("ble-connected"));
    (window as any).queryClient?.invalidateQueries({ queryKey: ["/api/messages"] });
  }).catch(() => {
    // Server unreachable (BLE-only with no internet) — show locally
    dispatchSystemLocal(content);
  });
}
