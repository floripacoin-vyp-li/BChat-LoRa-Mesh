/*
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
#define NUS_CHAR_RX_UUID  "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  // phone writes here
#define NUS_CHAR_TX_UUID  "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  // we notify here

// ====================================================================
//  BLB PACKET CONSTANTS
// ====================================================================
static const uint8_t BLB_MAGIC[3] = { 0x42, 0x4C, 0x42 }; // "BLB"
#define BLB_HEADER_SIZE   8   // 3 magic + 1 TTL + 2 ID + 2 LEN
#define BLB_MAX_PAYLOAD   235 // LoRa practical limit with header
#define DUP_FILTER_SIZE   16  // ring buffer of seen packet IDs

// ====================================================================
//  RADIO SETUP
// ====================================================================
#if defined(LORA_CHIP_SX1276)
  SX1276 radio = new Module(LORA_CS, LORA_DIO0, LORA_RST, LORA_DIO1);
#elif defined(LORA_CHIP_SX1262)
  SX1262 radio = new Module(LORA_CS, LORA_DIO1, LORA_RST, LORA_BUSY);
#endif

// ====================================================================
//  OLED SETUP
// ====================================================================
#if OLED_ENABLED
  #if defined(BOARD_HELTEC_V3)
    U8G2_SSD1306_128X64_NONAME_F_SW_I2C u8g2(U8G2_R0, OLED_SCL, OLED_SDA, OLED_RST);
  #else
    U8G2_SSD1306_128X64_NONAME_F_SW_I2C u8g2(U8G2_R0, OLED_SCL, OLED_SDA, OLED_RST);
  #endif
#endif

// ====================================================================
//  GLOBAL STATE
// ====================================================================
BLEServer          *pServer       = nullptr;
BLECharacteristic  *pTxChar      = nullptr;  // we notify on this
uint16_t            bleClients    = 0;

// Duplicate-packet filter (ring buffer of 16-bit packet IDs)
uint16_t dupFilter[DUP_FILTER_SIZE];
uint8_t  dupHead = 0;

// Outbox: bytes queued from BLE to send over LoRa
volatile bool     txPending   = false;
uint8_t           txBuf[BLB_MAX_PAYLOAD];
size_t            txLen       = 0;

// Inbox: received LoRa packet waiting for BLE relay
volatile bool     rxPending   = false;
uint8_t           rxBuf[BLB_MAX_PAYLOAD + BLB_HEADER_SIZE];
size_t            rxLen       = 0;

// Stats for OLED
int16_t           lastRssi    = 0;
char              lastMsg[32] = "--";

// ====================================================================
//  HELPERS
// ====================================================================

uint16_t randomId() {
  return (uint16_t)(esp_random() & 0xFFFF);
}

bool isDuplicate(uint16_t id) {
  for (uint8_t i = 0; i < DUP_FILTER_SIZE; i++) {
    if (dupFilter[i] == id) return true;
  }
  return false;
}

void recordId(uint16_t id) {
  dupFilter[dupHead] = id;
  dupHead = (dupHead + 1) % DUP_FILTER_SIZE;
}

// Build a BLB LoRa packet from raw payload bytes
size_t buildPacket(uint8_t *out, const uint8_t *payload, size_t payloadLen, uint8_t ttl, uint16_t id) {
  out[0] = BLB_MAGIC[0];
  out[1] = BLB_MAGIC[1];
  out[2] = BLB_MAGIC[2];
  out[3] = ttl;
  out[4] = (id >> 8) & 0xFF;
  out[5] = id & 0xFF;
  out[6] = (payloadLen >> 8) & 0xFF;
  out[7] = payloadLen & 0xFF;
  memcpy(out + BLB_HEADER_SIZE, payload, payloadLen);
  return BLB_HEADER_SIZE + payloadLen;
}

// Parse a received LoRa buffer; returns payload pointer and fills ttl/id/payloadLen
// Returns nullptr if packet is invalid
const uint8_t* parsePacket(const uint8_t *buf, size_t len, uint8_t &ttl, uint16_t &id, uint16_t &payloadLen) {
  if (len < BLB_HEADER_SIZE) return nullptr;
  if (buf[0] != BLB_MAGIC[0] || buf[1] != BLB_MAGIC[1] || buf[2] != BLB_MAGIC[2]) return nullptr;
  ttl        = buf[3];
  id         = ((uint16_t)buf[4] << 8) | buf[5];
  payloadLen = ((uint16_t)buf[6] << 8) | buf[7];
  if (payloadLen == 0 || payloadLen > BLB_MAX_PAYLOAD) return nullptr;
  if (len < (size_t)(BLB_HEADER_SIZE + payloadLen)) return nullptr;
  return buf + BLB_HEADER_SIZE;
}

// ====================================================================
//  OLED
// ====================================================================
#if OLED_ENABLED
void updateOled() {
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x10_tf);
  u8g2.drawStr(0, 10, BLB_NAME);
  char line[22];
  snprintf(line, sizeof(line), "BLE peers: %u", bleClients);
  u8g2.drawStr(0, 24, line);
  snprintf(line, sizeof(line), "RSSI: %d dBm", lastRssi);
  u8g2.drawStr(0, 36, line);
  u8g2.setFont(u8g2_font_5x7_tf);
  u8g2.drawStr(0, 50, "Last msg:");
  u8g2.drawStr(0, 60, lastMsg);
  u8g2.sendBuffer();
}
#endif

// ====================================================================
//  BLE CALLBACKS
// ====================================================================
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *srv) override {
    bleClients++;
    Serial.printf("BLE: client connected (%u total)\n", bleClients);
    // Restart advertising so more clients can still connect
    BLEDevice::startAdvertising();
#if OLED_ENABLED
    updateOled();
#endif
  }
  void onDisconnect(BLEServer *srv) override {
    if (bleClients > 0) bleClients--;
    Serial.printf("BLE: client disconnected (%u remaining)\n", bleClients);
    BLEDevice::startAdvertising();
#if OLED_ENABLED
    updateOled();
#endif
  }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *chr) override {
    // Phone → BLE RX → queue for LoRa TX
    std::string val = chr->getValue();
    if (val.length() == 0 || val.length() > BLB_MAX_PAYLOAD) return;
    if (txPending) return;  // drop if busy (backpressure)
    memcpy(txBuf, val.data(), val.length());
    txLen    = val.length();
    txPending = true;
    Serial.printf("BLE→LoRa: queued %u bytes\n", (unsigned)txLen);
    // Preview for OLED
    size_t preview = min((size_t)28, val.length());
    memcpy(lastMsg, val.data(), preview);
    lastMsg[preview] = '\0';
  }
};

// ====================================================================
//  RADIO RECEIVE ISR
// ====================================================================
volatile bool loraFlag = false;
void loraISR() { loraFlag = true; }

// ====================================================================
//  SETUP
// ====================================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== BLB Node starting ===");

  memset(dupFilter, 0, sizeof(dupFilter));

  // --- OLED ---
#if OLED_ENABLED
  Wire.begin(OLED_SDA, OLED_SCL);
  u8g2.begin();
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x10_tf);
  u8g2.drawStr(0, 20, "BLB Node");
  u8g2.drawStr(0, 34, "Starting...");
  u8g2.sendBuffer();
#endif

  // --- LoRa ---
#if defined(LORA_CHIP_SX1276)
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);
  int state = radio.begin(LORA_FREQ, 125.0, 9, 7, RADIOLIB_SX127X_SYNC_WORD, 17, 8, 0);
#elif defined(LORA_CHIP_SX1262)
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);
  int state = radio.begin(LORA_FREQ, 125.0, 9, 7, RADIOLIB_SX126X_SYNC_WORD_PRIVATE, 17, 8);
#endif
  if (state != RADIOLIB_ERR_NONE) {
    Serial.printf("LoRa init failed: %d\n", state);
  } else {
    Serial.printf("LoRa ready: %.1f MHz, SF9, BW125, CR4/7\n", LORA_FREQ);
  }

#if defined(LORA_CHIP_SX1276)
  radio.setDio0Action(loraISR, RISING);
#elif defined(LORA_CHIP_SX1262)
  radio.setDio1Action(loraISR, RISING);
#endif
  radio.startReceive();

  // --- BLE ---
  BLEDevice::init(BLB_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService *svc = pServer->createService(NUS_SERVICE_UUID);

  // TX characteristic (we notify — phone subscribes to receive)
  pTxChar = svc->createCharacteristic(
    NUS_CHAR_TX_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pTxChar->addDescriptor(new BLE2902());

  // RX characteristic (phone writes — we receive)
  BLECharacteristic *pRxChar = svc->createCharacteristic(
    NUS_CHAR_RX_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  pRxChar->setCallbacks(new RxCallbacks());

  svc->start();

  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  BLEDevice::startAdvertising();

  Serial.printf("BLE advertising as \"%s\"\n", BLB_NAME);
  Serial.println("=== BLB Node ready ===");

#if OLED_ENABLED
  updateOled();
#endif
}

// ====================================================================
//  LOOP
// ====================================================================
void loop() {

  // --- Handle incoming LoRa packet ---
  if (loraFlag) {
    loraFlag = false;

    uint8_t rawBuf[BLB_MAX_PAYLOAD + BLB_HEADER_SIZE];
    int     received = radio.readData(rawBuf, sizeof(rawBuf));
    lastRssi = (int16_t)radio.getRSSI();

    if (received > 0) {
      uint8_t  ttl;
      uint16_t id, payloadLen;
      const uint8_t *payload = parsePacket(rawBuf, received, ttl, id, payloadLen);

      if (payload == nullptr) {
        Serial.println("LoRa: non-BLB packet ignored");
      } else if (isDuplicate(id)) {
        Serial.printf("LoRa: dup id=0x%04X ignored\n", id);
      } else {
        recordId(id);
        Serial.printf("LoRa←: id=0x%04X ttl=%u len=%u rssi=%d\n", id, ttl, payloadLen, lastRssi);

        // Relay to BLE clients
        if (bleClients > 0) {
          pTxChar->setValue(const_cast<uint8_t*>(payload), payloadLen);
          pTxChar->notify();
          Serial.printf("LoRa→BLE: notified %u client(s)\n", bleClients);
        }

        // Re-broadcast over LoRa if TTL allows (mesh relay)
        if (ttl > 1) {
          uint8_t fwdBuf[BLB_MAX_PAYLOAD + BLB_HEADER_SIZE];
          size_t  fwdLen = buildPacket(fwdBuf, payload, payloadLen, ttl - 1, id);
          radio.transmit(fwdBuf, fwdLen);
          Serial.printf("LoRa relay: ttl→%u\n", ttl - 1);
        }

        // Preview
        size_t prev = min((size_t)28, (size_t)payloadLen);
        memcpy(lastMsg, payload, prev);
        lastMsg[prev] = '\0';
      }
    }

    radio.startReceive();

#if OLED_ENABLED
    updateOled();
#endif
  }

  // --- Transmit queued BLE→LoRa packet ---
  if (txPending) {
    txPending = false;

    uint16_t id = randomId();
    while (isDuplicate(id)) id = randomId(); // ensure unique
    recordId(id);

    uint8_t pkt[BLB_MAX_PAYLOAD + BLB_HEADER_SIZE];
    size_t  pktLen = buildPacket(pkt, txBuf, txLen, BLB_TTL, id);

    int state = radio.transmit(pkt, pktLen);
    if (state == RADIOLIB_ERR_NONE) {
      Serial.printf("LoRa→: id=0x%04X len=%u\n", id, (unsigned)txLen);
    } else {
      Serial.printf("LoRa TX error: %d\n", state);
    }

    radio.startReceive();

#if OLED_ENABLED
    updateOled();
#endif
  }
}
