# Bit Chat Bridge (BCB) — BLB: BitChat LoRa Bridge

A web PWA that bridges the BitChat BLE mesh network with the Meshtastic LoRa mesh network, enabling messages to travel between the two radio protocols.

## Architecture

**Frontend**: React + Vite (TypeScript) — `client/src/`
**Backend**: Express + PostgreSQL (Drizzle ORM) — `server/`
**Shared types**: `shared/`

### Key Files

| File | Purpose |
|---|---|
| `client/src/hooks/use-ble.ts` | Web Bluetooth hook — connects to Meshtastic node via BLE GATT |
| `client/src/hooks/use-serial.ts` | Web Serial hook — connects to Meshtastic node via USB serial |
| `client/src/hooks/use-bitchat.ts` | Web Bluetooth hook — connects to BitChat peers (NUS service) |
| `client/src/lib/meshtastic.ts` | Shared protocol logic: framing, protobuf encode/decode, node name registry |
| `client/src/lib/bridge.ts` | BLB bridge glue: wires `bitchatReceived` → `meshtasticSend` |
| `client/src/components/dashboard-header.tsx` | Header with BLE / USB / BChat connect buttons |
| `client/src/pages/dashboard.tsx` | Main chat UI |
| `server/storage.ts` | PostgreSQL message persistence |
| `client/public/sw.js` | Service worker for PWA offline support |
| `client/public/manifest.json` | PWA manifest |

## Transport Layer

### Meshtastic (LoRa)
- **BLE**: Connects to Meshtastic GATT service, writes to `toRadio` char, reads from `fromRadio` + `fromNum` notify
- **USB Serial**: Framing `0x94 0xC3 [MSB len] [LSB len] [payload]`, state-machine parser, 115200 baud
- **wantConfigId handshake** required immediately after connect (triggers firmware to forward LoRa packets)
- DTR/RTS signals asserted on serial connect

### BitChat BLE (Nordic UART Service)
- **Service UUID**: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- **TX char** (notify, we subscribe): `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`
- **RX char** (write, we send to): `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- Multiple peers supported simultaneously
- App acts as BLE central only (connects to BitChat devices, not an advertiser)

## BLB Bridge Logic

Raw BitChat bytes are carried over LoRa using Meshtastic **port 256** (PRIVATE_APP), preserving end-to-end encryption.

- **BitChat → LoRa**: `bitchatReceived` (set in `bridge.ts`) → `meshtasticSend(buildBitchatToRadio(bytes))`
- **LoRa → BitChat**: `processFromRadio` port 256 handler → `window.bitchatSend(bytes)` (set by `use-bitchat.ts`)

The BLB is active when both a Meshtastic transport AND at least one BitChat BLE peer are connected.

## Meshtastic BLE UUIDs
- Service: `6ba1b218-15a8-461f-9fa8-5dcae273eafd`
- toRadio (write): `f75c76d2-129e-4dad-a1dd-7866124401e7`
- fromRadio (read): `2c55e69e-4993-11ed-b878-0242ac120002`
- fromNum (notify): `ed9da18c-a800-4f66-a670-aa7547e34453`

## Important Notes
- Web Bluetooth and Web Serial only work in Chrome/Edge (not in iframes — use a standalone tab)
- Web Bluetooth cannot advertise as a peripheral — the app connects TO BitChat devices, not the other way around
- Service worker only registers in production (`import.meta.env.PROD`)
- `window.meshtasticSend`, `window.bitchatSend`, `window.bitchatReceived`, `window.queryClient` are globals used for cross-hook communication
