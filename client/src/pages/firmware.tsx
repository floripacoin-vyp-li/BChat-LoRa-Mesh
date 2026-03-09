import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Check, Copy, Download, ExternalLink, Cpu, Radio, Zap } from "lucide-react";

// Full firmware source — kept in sync with firmware/blb-esp32/blb-esp32.ino
const FIRMWARE_SOURCE = `/*
 * BLB Node — BitChat LoRa Bridge
 * ================================
 * Standalone hardware bridge: any BitChat phone connects via BLE (no pairing step),
 * messages are relayed over LoRa between BLB nodes.
 *
 * Supported boards (uncomment ONE):
 *   BOARD_TTGO_LORA32_V2  — ESP32 + SX1276,  ~$15
 *   BOARD_HELTEC_V3       — ESP32-S3 + SX1262, ~$20 (current gen, recommended)
 *
 * Required Arduino libraries (install via Library Manager):
 *   - RadioLib        (jgromes/RadioLib)         — LoRa radio driver
 *   - U8g2            (olikraus/U8g2)            — OLED display (optional)
 *   ESP32 BLE Arduino is included with the ESP32 board package.
 *
 * Board package URLs (add in Arduino IDE → Preferences → Additional Boards):
 *   ESP32:   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
 *
 * LoRa settings match Meshtastic LongFast (default channel) for maximum interop.
 * -----------------------------------------------------------------------
 * BLB Packet Format over LoRa:
 *   [MAGIC 3B: 0x42 0x4C 0x42] [TTL 1B] [ID 2B] [LEN 2B] [PAYLOAD N bytes]
 * -----------------------------------------------------------------------
 * Protocol: CC0 / Public Domain
 */

// ====================================================================
//  BOARD SELECTION — uncomment exactly one
// ====================================================================
#define BOARD_TTGO_LORA32_V2
// #define BOARD_HELTEC_V3

// ====================================================================
//  USER CONFIGURATION
// ====================================================================
#define BLB_NAME        "BLB-Bridge"  // BLE advertised name (visible to BitChat users)
#define LORA_FREQ       915.0         // MHz — 915.0 (Americas) | 868.0 (Europe) | 433.0 (Asia)
#define BLB_TTL         3             // Max hops per packet
#define OLED_ENABLED    true          // Set false to skip OLED initialisation

// ====================================================================
//  BOARD PIN DEFINITIONS
// ====================================================================
#if defined(BOARD_TTGO_LORA32_V2)
  // TTGO LoRa32 V2 — ESP32 + SX1276
  #include <SPI.h>
  #define LORA_CHIP_SX1276
  #define LORA_SCK      5
  #define LORA_MISO     19
  #define LORA_MOSI     27
  #define LORA_CS       18
  #define LORA_RST      14
  #define LORA_DIO0     26
  #define LORA_DIO1     33
  #define OLED_SDA      21
  #define OLED_SCL      22
  #define OLED_RST      16

#elif defined(BOARD_HELTEC_V3)
  // Heltec WiFi LoRa 32 V3 — ESP32-S3 + SX1262
  #include <SPI.h>
  #define LORA_CHIP_SX1262
  #define LORA_SCK      9
  #define LORA_MISO     11
  #define LORA_MOSI     10
  #define LORA_CS       8
  #define LORA_RST      12
  #define LORA_BUSY     13
  #define LORA_DIO1     14
  #define OLED_SDA      17
  #define OLED_SCL      18
  #define OLED_RST      21

#else
  #error "No board defined — uncomment one of the BOARD_xxx defines above."
#endif

// ====================================================================
//  INCLUDES
// ====================================================================
#include <RadioLib.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#if OLED_ENABLED
  #include <U8g2lib.h>
  #include <Wire.h>
#endif

// ====================================================================
//  BLE — BitChat Nordic UART Service (NUS) UUIDs
// ====================================================================
#define NUS_SERVICE_UUID  "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_CHAR_RX_UUID  "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_CHAR_TX_UUID  "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

// ====================================================================
//  BLB PACKET CONSTANTS
// ====================================================================
static const uint8_t BLB_MAGIC[3] = { 0x42, 0x4C, 0x42 };
#define BLB_HEADER_SIZE   8
#define BLB_MAX_PAYLOAD   235
#define DUP_FILTER_SIZE   16

// ====================================================================
//  RADIO SETUP
// ====================================================================
#if defined(LORA_CHIP_SX1276)
  SX1276 radio = new Module(LORA_CS, LORA_DIO0, LORA_RST, LORA_DIO1);
#elif defined(LORA_CHIP_SX1262)
  SX1262 radio = new Module(LORA_CS, LORA_DIO1, LORA_RST, LORA_BUSY);
#endif

#if OLED_ENABLED
  U8G2_SSD1306_128X64_NONAME_F_SW_I2C u8g2(U8G2_R0, OLED_SCL, OLED_SDA, OLED_RST);
#endif

BLEServer          *pServer    = nullptr;
BLECharacteristic  *pTxChar   = nullptr;
uint16_t            bleClients = 0;

uint16_t dupFilter[DUP_FILTER_SIZE];
uint8_t  dupHead = 0;

volatile bool  txPending = false;
uint8_t        txBuf[BLB_MAX_PAYLOAD];
size_t         txLen = 0;

volatile bool  loraFlag = false;
int16_t        lastRssi = 0;
char           lastMsg[32] = "--";

uint16_t randomId() { return (uint16_t)(esp_random() & 0xFFFF); }

bool isDuplicate(uint16_t id) {
  for (uint8_t i = 0; i < DUP_FILTER_SIZE; i++)
    if (dupFilter[i] == id) return true;
  return false;
}

void recordId(uint16_t id) {
  dupFilter[dupHead] = id;
  dupHead = (dupHead + 1) % DUP_FILTER_SIZE;
}

size_t buildPacket(uint8_t *out, const uint8_t *payload, size_t len, uint8_t ttl, uint16_t id) {
  out[0]=BLB_MAGIC[0]; out[1]=BLB_MAGIC[1]; out[2]=BLB_MAGIC[2];
  out[3]=ttl; out[4]=(id>>8)&0xFF; out[5]=id&0xFF;
  out[6]=(len>>8)&0xFF; out[7]=len&0xFF;
  memcpy(out+BLB_HEADER_SIZE, payload, len);
  return BLB_HEADER_SIZE+len;
}

const uint8_t* parsePacket(const uint8_t *buf, size_t len, uint8_t &ttl, uint16_t &id, uint16_t &plen) {
  if (len < BLB_HEADER_SIZE) return nullptr;
  if (buf[0]!=BLB_MAGIC[0]||buf[1]!=BLB_MAGIC[1]||buf[2]!=BLB_MAGIC[2]) return nullptr;
  ttl=buf[3]; id=((uint16_t)buf[4]<<8)|buf[5]; plen=((uint16_t)buf[6]<<8)|buf[7];
  if (!plen || plen>BLB_MAX_PAYLOAD || len<(size_t)(BLB_HEADER_SIZE+plen)) return nullptr;
  return buf+BLB_HEADER_SIZE;
}

#if OLED_ENABLED
void updateOled() {
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x10_tf);
  u8g2.drawStr(0,10,BLB_NAME);
  char line[22];
  snprintf(line,sizeof(line),"BLE peers: %u",bleClients);
  u8g2.drawStr(0,24,line);
  snprintf(line,sizeof(line),"RSSI: %d dBm",lastRssi);
  u8g2.drawStr(0,36,line);
  u8g2.setFont(u8g2_font_5x7_tf);
  u8g2.drawStr(0,50,"Last msg:");
  u8g2.drawStr(0,60,lastMsg);
  u8g2.sendBuffer();
}
#endif

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    bleClients++;
    BLEDevice::startAdvertising();
#if OLED_ENABLED
    updateOled();
#endif
  }
  void onDisconnect(BLEServer*) override {
    if (bleClients>0) bleClients--;
    BLEDevice::startAdvertising();
#if OLED_ENABLED
    updateOled();
#endif
  }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *chr) override {
    std::string val = chr->getValue();
    if (!val.length() || val.length()>BLB_MAX_PAYLOAD || txPending) return;
    memcpy(txBuf, val.data(), val.length());
    txLen=val.length(); txPending=true;
    size_t p=min((size_t)28,val.length());
    memcpy(lastMsg,val.data(),p); lastMsg[p]='\\0';
  }
};

void loraISR() { loraFlag=true; }

void setup() {
  Serial.begin(115200);
  memset(dupFilter,0,sizeof(dupFilter));

#if OLED_ENABLED
  Wire.begin(OLED_SDA,OLED_SCL);
  u8g2.begin();
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x10_tf);
  u8g2.drawStr(0,20,"BLB Node");
  u8g2.drawStr(0,34,"Starting...");
  u8g2.sendBuffer();
#endif

  SPI.begin(LORA_SCK,LORA_MISO,LORA_MOSI,LORA_CS);
#if defined(LORA_CHIP_SX1276)
  radio.begin(LORA_FREQ,125.0,9,7,RADIOLIB_SX127X_SYNC_WORD,17,8,0);
  radio.setDio0Action(loraISR,RISING);
#elif defined(LORA_CHIP_SX1262)
  radio.begin(LORA_FREQ,125.0,9,7,RADIOLIB_SX126X_SYNC_WORD_PRIVATE,17,8);
  radio.setDio1Action(loraISR,RISING);
#endif
  radio.startReceive();

  BLEDevice::init(BLB_NAME);
  pServer=BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());
  BLEService *svc=pServer->createService(NUS_SERVICE_UUID);
  pTxChar=svc->createCharacteristic(NUS_CHAR_TX_UUID,BLECharacteristic::PROPERTY_NOTIFY);
  pTxChar->addDescriptor(new BLE2902());
  BLECharacteristic *pRxChar=svc->createCharacteristic(NUS_CHAR_RX_UUID,
    BLECharacteristic::PROPERTY_WRITE|BLECharacteristic::PROPERTY_WRITE_NR);
  pRxChar->setCallbacks(new RxCallbacks());
  svc->start();
  BLEAdvertising *adv=BLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  BLEDevice::startAdvertising();

#if OLED_ENABLED
  updateOled();
#endif
}

void loop() {
  if (loraFlag) {
    loraFlag=false;
    uint8_t raw[BLB_MAX_PAYLOAD+BLB_HEADER_SIZE];
    int n=radio.readData(raw,sizeof(raw));
    lastRssi=(int16_t)radio.getRSSI();
    if (n>0) {
      uint8_t ttl; uint16_t id,plen;
      const uint8_t *pl=parsePacket(raw,n,ttl,id,plen);
      if (pl && !isDuplicate(id)) {
        recordId(id);
        if (bleClients>0) { pTxChar->setValue(const_cast<uint8_t*>(pl),plen); pTxChar->notify(); }
        if (ttl>1) {
          uint8_t fw[BLB_MAX_PAYLOAD+BLB_HEADER_SIZE];
          size_t fl=buildPacket(fw,pl,plen,ttl-1,id);
          radio.transmit(fw,fl);
        }
        size_t p=min((size_t)28,(size_t)plen);
        memcpy(lastMsg,pl,p); lastMsg[p]='\\0';
      }
    }
    radio.startReceive();
#if OLED_ENABLED
    updateOled();
#endif
  }

  if (txPending) {
    txPending=false;
    uint16_t id=randomId();
    while(isDuplicate(id)) id=randomId();
    recordId(id);
    uint8_t pkt[BLB_MAX_PAYLOAD+BLB_HEADER_SIZE];
    size_t pl=buildPacket(pkt,txBuf,txLen,BLB_TTL,id);
    radio.transmit(pkt,pl);
    radio.startReceive();
#if OLED_ENABLED
    updateOled();
#endif
  }
}`;

const BOARDS = [
  {
    name: "TTGO LoRa32 V2",
    chip: "ESP32 + SX1276",
    price: "~$15",
    define: "BOARD_TTGO_LORA32_V2",
    freq: "433 / 868 / 915 MHz",
    link: "https://www.aliexpress.com/w/wholesale-ttgo-lora32.html",
    notes: "Widely available, well-tested",
  },
  {
    name: "Heltec WiFi LoRa 32 V3",
    chip: "ESP32-S3 + SX1262",
    price: "~$20",
    define: "BOARD_HELTEC_V3",
    freq: "433 / 868 / 915 MHz",
    link: "https://heltec.org/project/wifi-lora-32-v3/",
    notes: "Current gen — recommended, USB-C",
  },
];

const STEPS = [
  {
    n: "1",
    title: "Install Arduino IDE 2.x",
    body: "Download from arduino.cc/en/software. Version 2.x required for library manager features.",
  },
  {
    n: "2",
    title: "Add ESP32 board package",
    body: (
      <>
        Open <span className="text-primary font-mono">Preferences → Additional Boards Manager URLs</span> and add:
        <br />
        <code className="text-xs bg-black/40 px-2 py-1 rounded block mt-2 break-all text-primary/80">
          https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
        </code>
        <br />
        Then open <span className="text-primary font-mono">Tools → Board → Boards Manager</span>, search <strong>esp32</strong>, install the <strong>esp32 by Espressif</strong> package.
      </>
    ),
  },
  {
    n: "3",
    title: "Install RadioLib",
    body: (
      <>
        Open <span className="text-primary font-mono">Tools → Manage Libraries</span>, search <strong>RadioLib</strong>, install the one by <em>jgromes</em>.
      </>
    ),
  },
  {
    n: "4",
    title: "Install U8g2 (OLED, optional)",
    body: (
      <>
        Search <strong>U8g2</strong> in Library Manager, install by <em>olikraus</em>. Skip if you set{" "}
        <code className="text-primary font-mono">#define OLED_ENABLED false</code>.
      </>
    ),
  },
  {
    n: "5",
    title: "Select your board",
    body: (
      <>
        <span className="text-primary font-mono">Tools → Board → esp32</span>:
        <br />• TTGO LoRa32 V2 → select <strong>TTGO LoRa32-OLED</strong>
        <br />• Heltec V3 → select <strong>Heltec WiFi LoRa 32(V3)</strong>
      </>
    ),
  },
];

export default function Firmware() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(FIRMWARE_SOURCE).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    const blob = new Blob([FIRMWARE_SOURCE], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "blb-esp32.ino";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen p-4 md:p-8 relative">
      <div className="absolute top-20 left-20 w-64 h-64 bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-20 right-20 w-96 h-96 bg-cyan-500/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-4xl mx-auto relative z-10">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/">
            <button className="flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm font-mono transition-colors">
              <ArrowLeft size={14} /> Back to Bridge
            </button>
          </Link>
        </div>

        <div className="glass-panel rounded-2xl p-6 md:p-8 mb-6">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-primary/20 border border-cyan-500/30 flex items-center justify-center">
              <Cpu className="text-cyan-400" size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
                BLB Node Firmware
                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">ESP32</span>
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Standalone hardware bridge — any BitChat phone connects automatically, no web app required.
              </p>
            </div>
          </div>

          {/* Concept */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 mb-6 font-mono text-sm space-y-1">
            <div className="flex items-center gap-3 text-primary">
              <Radio size={14} className="shrink-0" />
              <span>BitChat phone <span className="opacity-50">──BLE──</span> BLB Node <span className="opacity-50">──LoRa──</span> BLB Node <span className="opacity-50">──BLE──</span> BitChat phone</span>
            </div>
            <p className="text-muted-foreground text-xs pl-5 pt-1">
              The node advertises as a BitChat-compatible BLE peripheral (Nordic UART Service). Any nearby BitChat device connects to it automatically. LoRa carries messages between nodes over kilometres. End-to-end BitChat encryption is preserved — bytes pass through transparently.
            </p>
          </div>

          {/* Hardware */}
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Zap size={14} className="text-primary" /> Hardware
          </h2>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm font-mono border-collapse">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground text-xs uppercase">
                  <th className="text-left py-2 pr-4">Board</th>
                  <th className="text-left py-2 pr-4">Chip</th>
                  <th className="text-left py-2 pr-4">Price</th>
                  <th className="text-left py-2 pr-4">Frequencies</th>
                  <th className="text-left py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {BOARDS.map((b) => (
                  <tr key={b.name} className="border-b border-white/5 hover:bg-white/2">
                    <td className="py-2.5 pr-4">
                      <a href={b.link} target="_blank" rel="noreferrer"
                        className="text-primary hover:underline flex items-center gap-1">
                        {b.name} <ExternalLink size={10} />
                      </a>
                    </td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{b.chip}</td>
                    <td className="py-2.5 pr-4 text-green-400">{b.price}</td>
                    <td className="py-2.5 pr-4 text-muted-foreground">{b.freq}</td>
                    <td className="py-2.5 text-muted-foreground text-xs">{b.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Arduino Setup */}
          <h2 className="text-base font-semibold mb-3">Arduino IDE Setup</h2>
          <div className="space-y-3 mb-6">
            {STEPS.map((s) => (
              <div key={s.n} className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-primary/20 border border-primary/30 text-primary text-xs font-mono flex items-center justify-center shrink-0 mt-0.5">
                  {s.n}
                </div>
                <div className="text-sm text-muted-foreground">
                  <span className="text-foreground font-medium">{s.title} — </span>
                  {typeof s.body === "string" ? s.body : s.body}
                </div>
              </div>
            ))}
          </div>

          {/* Configuration */}
          <h2 className="text-base font-semibold mb-3">Configuration</h2>
          <div className="bg-black/30 border border-white/10 rounded-xl p-4 font-mono text-xs space-y-2 mb-6">
            {[
              ["BOARD_TTGO_LORA32_V2 / BOARD_HELTEC_V3", "Uncomment your board model at the top"],
              ["BLB_NAME", "BLE device name visible to BitChat users (default: BLB-Bridge)"],
              ["LORA_FREQ", "915.0 for Americas · 868.0 for Europe · 433.0 for Asia"],
              ["BLB_TTL", "Max relay hops (3 = up to 3× range extension)"],
              ["OLED_ENABLED", "Set to false if your board has no display"],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <span className="text-primary shrink-0 w-52">{k}</span>
                <span className="text-muted-foreground">{v}</span>
              </div>
            ))}
          </div>

          {/* Firmware Code */}
          <h2 className="text-base font-semibold mb-3">Firmware</h2>
          <div className="border border-white/10 rounded-xl overflow-hidden mb-6">
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-black/20">
              <span className="text-xs font-mono text-muted-foreground">blb-esp32.ino</span>
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  data-testid="button-copy-firmware"
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono bg-secondary border border-white/10 hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-all"
                >
                  {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={handleDownload}
                  data-testid="button-download-firmware"
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 transition-all"
                >
                  <Download size={12} /> Download
                </button>
              </div>
            </div>
            <pre className="p-4 text-xs font-mono text-muted-foreground overflow-x-auto overflow-y-auto max-h-[40vh] leading-relaxed custom-scrollbar">
              <code>{FIRMWARE_SOURCE}</code>
            </pre>
          </div>

          {/* Flash */}
          <h2 className="text-base font-semibold mb-3">Flashing</h2>
          <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside mb-6">
            <li>Open <code className="text-primary font-mono">blb-esp32.ino</code> in Arduino IDE</li>
            <li>Edit the <code className="text-primary font-mono">#define</code> values at the top to match your board and region</li>
            <li>Connect the ESP32 via USB. Some boards need the boot button held while plugging in</li>
            <li>Select the correct port under <span className="text-primary font-mono">Tools → Port</span></li>
            <li>Click <strong>Upload</strong> (→ arrow). The IDE will compile and flash in ~30 seconds</li>
            <li>Open Serial Monitor at 115200 baud — you should see <em>"BLB Node ready"</em></li>
          </ol>

          {/* Usage */}
          <h2 className="text-base font-semibold mb-3">Usage</h2>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              Once flashed, the node advertises itself as <code className="text-primary font-mono">BLB-Bridge</code> (or your custom name) over BLE.
              In the BitChat app, it will appear automatically in the nearby devices list — users tap to connect, no pairing prompt.
            </p>
            <p>
              Place multiple BLB nodes across an area. Each node relays packets it receives with TTL decremented by 1,
              so a message hops up to <code className="text-primary font-mono">BLB_TTL</code> times — effectively tripling range
              compared to single-hop BLE.
            </p>
            <p>
              The web app bridge (this site + Meshtastic USB) and BLB hardware nodes use the same packet format and LoRa RF settings,
              so they interoperate on the same LoRa channel.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
