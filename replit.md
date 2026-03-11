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
| `client/src/components/dashboard-header.tsx` | Header with BLE / USB / BChat / Firmware nav buttons |
| `client/src/pages/dashboard.tsx` | Main chat UI |
| `client/src/pages/firmware.tsx` | `/firmware` page — ESP32 setup guide + firmware download |
| `firmware/blb-esp32/blb-esp32.ino` | Arduino sketch for standalone BLB hardware node |
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

## BLB Node — ESP32 Hardware Firmware

A standalone hardware companion that lets ANY nearby BitChat phone connect automatically (no web app, no pairing prompt). The ESP32 advertises as a BitChat-compatible BLE peripheral (Nordic UART Service) and relays messages over LoRa between nodes.

### Firmware location
`firmware/blb-esp32/blb-esp32.ino` — single Arduino sketch, also displayed/downloadable at `/firmware` in the web app.

### Supported Hardware
| Board | Radio | Price |
|---|---|---|
| TTGO LoRa32 V2 | SX1276 | ~$15 |
| Heltec WiFi LoRa 32 V3 (recommended) | SX1262 | ~$20 |

### Required Arduino Libraries
- **RadioLib** (jgromes) — unified LoRa driver for SX1276 + SX1262
- **U8g2** (olikraus) — OLED display (optional)
- ESP32 BLE Arduino — bundled with the ESP32 board package

### BLB LoRa Packet Format
```
[MAGIC: 0x42 0x4C 0x42] [TTL: 1B] [ID: 2B random] [LEN: 2B] [PAYLOAD: N bytes]
```
- Magic = ASCII "BLB"
- TTL starts at 3; each relay hop decrements it. Dropped at 0.
- ID is random per-packet; 16-ID ring buffer prevents echo loops.
- Payload = raw BitChat bytes (end-to-end encryption preserved).

### LoRa RF Settings (Meshtastic LongFast compatible)
- SF9, BW 125 kHz, CR 4/7, 17 dBm
- Frequency: 915 MHz (Americas) / 868 MHz (Europe) / 433 MHz (Asia)

### Configuration `#define`s at top of sketch
| Define | Default | Description |
|---|---|---|
| `BOARD_TTGO_LORA32_V2` or `BOARD_HELTEC_V3` | TTGO | Board selection |
| `BLB_NAME` | "BLB-Bridge" | BLE advertised name |
| `LORA_FREQ` | 915.0 | LoRa frequency in MHz |
| `BLB_TTL` | 3 | Max relay hops |
| `OLED_ENABLED` | true | Enable OLED display |

### Web App `/firmware` Page
Provides: hardware table with purchase links, Arduino IDE setup steps, configuration guide, full firmware code with Copy + Download buttons, flashing instructions, usage guide.

## Multi-User / Gateway Awareness

- **Operator heartbeat**: When a BCB client connects a radio (BLE or USB), it sends `POST /api/operator/heartbeat` every 10s. Server tracks active operators with a 20s TTL and broadcasts `operator-status` SSE events when the count changes.
- **Non-operator clients** receive `operator-status` events via `use-message-stream.ts` (relayed as `gateway-status` window events). The `use-gateway-presence.ts` hook exposes `gatewayOnline: boolean`.
- **Dashboard banner states** (priority order):
  1. `!isOnline && isConnected` → amber "Offline · Local BLE Only"
  2. `!isOnline && !isConnected` → red "Offline · No Radio — BLE required"
  3. `isOnline && isConnected` → green "Uplink Established: device"
  4. `isOnline && !isConnected && gatewayOnline` → green "Gateway Active — LoRa uplink via remote operator"
  5. `isOnline && !isConnected && !gatewayOnline` → red "Uplink Severed"
- **ChatInput** disables input + send button with hint when `!isOnline && !isConnected`

## Alias Uniqueness

Each user alias is registered server-side and bound to an ECDH public key in the `users` table:
- `POST /api/users/claim` — registers `{ alias, publicKey }`. Returns 200 if free or same key (idempotent), 409 if taken by a different key.
- `GET /api/users/:alias` — returns `{ alias, publicKey }` for a given alias (foundation for Option C secure DMs without QR scan).
- On app load, if a stored alias is found in localStorage, it is silently re-claimed (handles returning users).
- The `AliasDialog` shows a loading state ("Checking...") while the claim is in flight, and an inline error if the alias is already taken.
- `claimAlias(alias)` in `useAlias` returns `"ok"` or `"taken"` — only `"ok"` closes the dialog.

## Important Notes
- Web Bluetooth and Web Serial only work in Chrome/Edge (not in iframes — use a standalone tab)
- Web Bluetooth cannot advertise as a peripheral — the app connects TO BitChat devices, not the other way around
- Service worker only registers in production (`import.meta.env.PROD`)
- `window.meshtasticSend`, `window.bitchatSend`, `window.bitchatReceived`, `window.queryClient` are globals used for cross-hook communication
