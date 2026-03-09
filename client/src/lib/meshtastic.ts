import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import { Mesh, Portnums } from "@meshtastic/protobufs";

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
      console.log(`Mesh: Packet from "${senderLabel}", type: ${payloadCase}`);

      if (payloadCase === "decoded") {
        const decoded = packet.payloadVariant.value;

        if (decoded.portnum === Portnums.PortNum.TEXT_MESSAGE_APP) {
          const text = new TextDecoder().decode(decoded.payload);
          console.log("Mesh: Text message:", text);
          if (text.trim().length > 0) {
            fetch("/api/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sender: "node", content: `[${senderLabel}] ${text}` }),
            }).then(() => {
              (window as any).queryClient?.invalidateQueries({ queryKey: ["/api/messages"] });
            });
          }
        } else if (decoded.portnum === BITCHAT_PORT) {
          // BLB: raw BitChat bytes arrived over LoRa — relay to connected BLE peers
          const bytes = decoded.payload;
          console.log(`BLB: LoRa → BitChat (${bytes.length}B from ${senderLabel})`);
          (window as any).bitchatSend?.(bytes);
          fetch("/api/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sender: "system",
              content: `[BLB] LoRa → BitChat: ${bytes.length}B from ${senderLabel}`,
            }),
          }).then(() => {
            (window as any).queryClient?.invalidateQueries({ queryKey: ["/api/messages"] });
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

export function postSystemMessage(content: string): void {
  fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sender: "system", content }),
  }).then(() => {
    window.dispatchEvent(new CustomEvent("ble-connected"));
    (window as any).queryClient?.invalidateQueries({ queryKey: ["/api/messages"] });
  });
}
