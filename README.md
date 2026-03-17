# BitChat Bridge (BCB)

**A web-based LoRa mesh terminal — connect a Meshtastic radio to the browser and relay messages across the mesh, from anywhere.**

---

## What It Is

BitChat Bridge is a full-stack web application that turns any browser tab into a Meshtastic LoRa mesh terminal. It lets users connect a Meshtastic-compatible radio to the browser over Bluetooth (BLE) or USB Serial, then send and receive mesh radio messages in real time. Users without a local radio can still participate by routing messages through any connected operator acting as a gateway.

The app also includes a hardware bridge companion: an ESP32 firmware (BLB Node) that any nearby BitChat phone can connect to automatically over BLE, with LoRa relaying messages between nodes.

---

## Objectives

- Provide a browser-native interface for Meshtastic LoRa mesh networks — no app install required.
- Enable multi-operator mesh relay: messages queued in the shared backend are picked up and transmitted by whichever connected operator wins an atomic claim.
- Support fully offline operation when a local radio is available.
- Protect private conversations with end-to-end encryption using ECDH key exchange directly in the browser.
- Distribute a ready-to-flash ESP32 firmware to extend LoRa coverage with low-cost hardware nodes.

---

## Features

### Radio Connectivity
- **Web Bluetooth (BLE)** — Connects to any Meshtastic node advertising over BLE. Uses the Meshtastic GATT service (TORADIO / FROMRADIO / FROMNUM characteristics) to send and receive packets.
- **USB Serial** — Connects to Meshtastic nodes over USB at 115200 baud via the Web Serial API. Full framing parser handles the `0x94 0xC3 [len MSB] [len LSB] [payload]` packet format.
- **Auto-reconnect** — BLE connections attempt up to 3 automatic reconnect cycles on unexpected disconnection before reporting failure.

### Mesh Relay (Multi-Operator)
- Connected clients register as **operators** via a heartbeat API. The server tracks which operators have a live radio.
- Pending messages are polled every 2 seconds. Each operator atomically claims a message (HTTP 409 on conflict) and transmits it over their local radio — ensuring each message is sent exactly once even with multiple simultaneous operators.
- Non-operator users can still send messages, which are queued server-side and relayed by the next available operator.

### Offline Mode
- When offline with a local radio connected, the app operates in **Local BLE Only** mode — messages can still be transmitted over the mesh.
- The connection status banner adapts in real time: full uplink, gateway-only, offline with radio, or fully severed.

### Gateway Presence Detection
- On load the app fetches the current active operator count, then listens for real-time updates via SSE. When no local radio is connected but a remote gateway is live, the banner reports **Gateway Active — LoRa uplink via remote operator**.

### Real-Time Updates via SSE
- The backend streams new messages to all connected clients using **Server-Sent Events (SSE)**, eliminating the need for constant polling on the frontend.

### End-to-End Encrypted Private Messages
- Each user generates an **ECDH key pair** (P-256) on first use, stored persistently in **IndexedDB** (`bcb-crypto` database). The contact list (aliases and public keys) is stored in `localStorage`.
- Contacts are added by sharing a public key (displayed as a **QR code** or copied as base64 text).
- Private messages are encrypted with AES-GCM using a derived shared key and transmitted over the mesh as opaque payloads. They appear in the public chat log only as "Private message".
- The contacts panel supports adding, removing, and chatting with multiple contacts, with per-contact unread counts.

### QR Code Sharing
- Users can display their public key as a QR code for others to scan, enabling frictionless contact exchange without typing.

### Alias System
- Users claim a short alias (nickname) stored server-side. Aliases are unique and used as the sender identifier for all messages.
- The alias is set once at first use and persists across sessions.

### Firmware Page
- A dedicated in-app page provides the complete **BLB Node ESP32 firmware** (Arduino `.ino`), ready to copy or download.
- Supports two hardware targets: TTGO LoRa32 V2 (ESP32 + SX1276, ~$15) and Heltec WiFi LoRa 32 V3 (ESP32-S3 + SX1262, ~$20).
- Includes step-by-step Arduino IDE setup instructions, hardware comparison table, and flashing guide.
- BLB nodes advertise as BitChat-compatible BLE peripherals (Nordic UART Service) and relay LoRa packets with configurable TTL for multi-hop range extension.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Routing | wouter |
| Data fetching | TanStack Query v5 |
| Forms | react-hook-form + Zod |
| Backend | Node.js, Express 5 |
| Database | PostgreSQL via Drizzle ORM |
| Schema validation | Zod + drizzle-zod |
| Real-time | Server-Sent Events (SSE) |
| Crypto | Web Crypto API (ECDH P-256, AES-GCM) |
| QR codes | qrcode (generation), jsqr (scanning) |
| Radio protocol | @meshtastic/protobufs |

---

## Local Setup

### Prerequisites
- Node.js 20+
- PostgreSQL (running locally or remotely)

### Steps

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd <repo-dir>
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**

   Create a `.env` file (or set these in your shell):
   ```
   DATABASE_URL=postgresql://user:password@localhost:5432/bcb
   ```

4. **Push the database schema**
   ```bash
   npm run db:push
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

   The app is served at `http://localhost:5000`.

---

## Browser Requirements

| Feature | Required Browser |
|---|---|
| Web Bluetooth (BLE) | Chrome 85+ or Edge 85+ (desktop / Android) |
| Web Serial (USB) | Chrome 89+ (desktop) · Chrome 126+ (Android with USB OTG) |
| General app | Any modern browser (Firefox, Safari) for non-radio features |

> **Note:** Both Web Bluetooth and Web Serial are only available in secure contexts. When running on a remote host (not `localhost`), the server **must be served over HTTPS**. On `localhost`, plain HTTP is sufficient for development.

---

## BLB Hardware Node

The Firmware page (`/firmware`) provides a self-contained ESP32 sketch that acts as a BitChat-compatible LoRa bridge — no web app required on the hardware side. Phones running BitChat connect to the node automatically over BLE; the node relays messages between nodes over LoRa.

**Supported boards:**
- TTGO LoRa32 V2 (ESP32 + SX1276) — ~$15
- Heltec WiFi LoRa 32 V3 (ESP32-S3 + SX1262) — ~$20, recommended

The BLB nodes interoperate with the web app bridge on the same LoRa channel and packet format.

---

## License

MIT
