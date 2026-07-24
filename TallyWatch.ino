/*
  TallyWatch
  ----------
  Visual Entropy Productions -- live-event tally light for Bitfocus
  Companion. An ESP32-C3 that registers itself as a virtual Stream
  Deck-style surface with Companion (via the Satellite TCP protocol), then
  mirrors whatever button color Companion assigns to it onto an
  addressable RGB LED, so graphics operators can see which laptop is live
  to screen at a glance.

  How the button-to-LED mapping works:
    This firmware registers ONE virtual key (KEYS_TOTAL=1) with
    Companion. It does NOT need to know which page/row/column to
    watch -- that's set entirely inside Companion itself:
      Companion GUI -> Surfaces tab -> find this device -> Settings
      -> set "Current Page" / "Horizontal Offset" / "Vertical Offset"
      to the button you want mirrored. Companion then streams that
      button's background color to this device automatically.
    (Pages start at 1; row/column offsets start at 0.)

  Requires Companion 3.0.0 or newer (Satellite API v1.4+, ADD-DEVICE
  simple mode). Also set Companion's Surface/GUI network interface to
  "All Interfaces" (or a network this device can reach) or the device
  will spin red forever trying to connect.

  Hardware (as built):
    - ESP32-C3 "Super Mini" board, powered over its USB-C port
    - 1 WS2812B addressable RGB LED (BTF-Lighting single pixel), wired:
        LED DIN -> GPIO3 (LED_PIN)
        LED VCC -> 5V through a series silicon diode (1N4148/1N4007),
                   band toward the LED  ->  ~4.3V at the pixel
        LED GND -> GND
    - The board's onboard BOOT button doubles as the setup/reset button

  WS2812B supply note: the pixel reads data-high at 0.7 x its supply. On a
  straight 5V rail that's 3.5V and the C3 only drives 3.3V (flicker). Running
  the pixel off the 3V3 pin fixes the logic level but sits below the WS2812B's
  ~3.5V minimum, so green/blue wash out and colors skew red -- unacceptable on
  a tally light. One silicon diode lands ~4.3V: above the LED's minimum, and
  its 3.01V threshold leaves margin under the C3's 3.3V. See docs/wiring.md.
  LED_PIN is GPIO3 -- a plain GPIO, deliberately NOT one of the C3 strapping
  pins (GPIO2/8/9), so it can't interfere with boot.

  Libraries (install via Arduino Library Manager):
    - Adafruit NeoPixel by Adafruit
    - ArduinoJson by Benoit Blanchon (v7.x)
    (WiFiManager is NOT used -- setup mode hosts our own web UI instead,
    see webserver.h, so saved networks/static IP can be managed directly.)

  Board setup (Arduino IDE):
    - Boards manager: "esp32" by Espressif Systems
    - Board: "ESP32C3 Dev Module" (or your specific board variant)
    - USB CDC On Boot: "Enabled" (needed for Serial over the native USB
      port on most ESP32-C3 Super Mini boards)

  First-time setup / reconfiguring:
    1. Power up. It boots into normal mode and tries up to 3 saved WiFi
       networks in order. With none saved, it goes straight to setup mode.
    2. To (re)configure: hold the BOOT button for ~3-7 seconds until
       the LED breathes GREEN, then release. It starts an access point
       named "TallyWatch-Setup" (password "tally1234") hosting a setup
       page at 192.168.4.1.
    3. Connect a phone/laptop to that AP and browse to 192.168.4.1.
       Add WiFi network(s), your Companion PC's IP/port, device options.
    4. Hit Save -- it persists settings, reboots, and connects.
    5. Factory reset: hold BOOT past 7 seconds until the LED flashes
       WHITE, then release -- this wipes all saved settings.

  Status LED colors (matches the "familiar tally light" convention --
  each can be individually disabled from the Device settings page):
    - Breathing BLUE   : connecting to WiFi
    - Breathing RED    : WiFi is up, connecting to Companion
    - Breathing GREEN  : setup mode active
    - Solid WHITE      : factory-reset confirmation (always on, not
                         a toggleable indicator)
    - Otherwise        : mirroring Companion's assigned button color
                         (brighter ceiling when Ultra Bright is enabled)
*/

#include <WiFi.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <Adafruit_NeoPixel.h>
#include "web_routes.h"

// ---------------- Hardware config ----------------
#define LED_PIN      3      // WS2812B data line (GPIO3 -- non-strapping, safe)
#define LED_COUNT    1       // set to e.g. 8 if using a small LED ring
#define BOOT_PIN     9       // onboard BOOT button on the ESP32-C3 Super Mini

Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

// ---------------- Identity / version ----------------
const char* FW_VERSION = "1.0.0";
const char* FW_CODENAME = "First Light";
const char* HARDWARE_VERSION = "0100"; // parsed by the setup page as 01.00

const char* AP_SSID = "TallyWatch-Setup";
const char* AP_PASSWORD = "tally1234";

// ---------------- Persistent config ----------------
Preferences prefs;
TallySettings settings;
String deviceSerial; // stable id, generated once from MAC, e.g. "TallyWatch:AABBCCDDEEFF"

// ---------------- Web server (setup + normal operation) ----------------
WebServer server(80);
volatile bool restartPending = false;
unsigned long restartAtMs = 0;
bool servicesStarted = false;  // mDNS + HTTP started once WiFi is up

// ---------------- Live status / management ----------------
String lastColorHex = "#000000";    // last color Companion pushed (for /status + identify restore)
unsigned long identifyUntil = 0;    // while > millis(), the LED runs the locate-me blink
bool wasIdentifying = false;

// ---------------- Networking / protocol state ----------------
WiFiClient client;
unsigned long lastPingSent = 0;
unsigned long lastRxLine   = 0;
const unsigned long PING_INTERVAL_MS = 2000;
const unsigned long RX_TIMEOUT_MS    = 8000;
String rxBuffer;
bool deviceRegistered = false;
uint8_t ledBrightness = 120; // 0-255, overridden by Companion's BRIGHTNESS message

enum Phase { PHASE_WIFI, PHASE_COMPANION, PHASE_SYNCED };
Phase phase = PHASE_WIFI;

// ================= LED helpers =================
void showSolid(uint8_t r, uint8_t g, uint8_t b) {
  uint8_t br = settings.ultra_bright == "1" ? 255 : ledBrightness;
  strip.setBrightness(br);
  for (int i = 0; i < LED_COUNT; i++) strip.setPixelColor(i, strip.Color(r, g, b));
  strip.show();
}

// Breathing effect for a status color; call repeatedly from a loop that
// also checks for exit conditions (WiFi/Companion connecting, button etc).
void breatheStep(uint8_t r, uint8_t g, uint8_t b) {
  static float phaseAngle = 0;
  phaseAngle += 0.06;
  float level = (sin(phaseAngle) + 1.0) / 2.0; // 0..1
  uint8_t br = (uint8_t)(40 + level * 180);
  strip.setBrightness(br);
  for (int i = 0; i < LED_COUNT; i++) strip.setPixelColor(i, strip.Color(r, g, b));
  strip.show();
}

// Shows the breathing status color only if its indicator toggle is on;
// otherwise the LED stays dark for that state.
void indicatorStep(const String& enabled, uint8_t r, uint8_t g, uint8_t b) {
  if (enabled == "1") breatheStep(r, g, b);
  else showSolid(0, 0, 0);
}

void flashWhite(int times, int ms) {
  for (int i = 0; i < times; i++) {
    showSolid(255, 255, 255);
    delay(ms);
    showSolid(0, 0, 0);
    delay(ms);
  }
}

// Locate-me blink: a fast cyan flash so an operator can physically find which
// unit responded to the manager's "Identify" button.
void identifyBlinkStep() {
  bool on = (millis() / 150) % 2;
  if (on) showSolid(0, 210, 255);
  else showSolid(0, 0, 0);
}

// Re-apply the last Companion color (used when an identify blink ends).
void applyColorHex(const String& hex); // fwd decl
void restoreLastColor() {
  applyColorHex(lastColorHex);
}

// ================= Settings persistence =================
void loadSettings() {
  settings.ssid1 = prefs.getString("ssid1", "");
  settings.pass1 = prefs.getString("pass1", "");
  settings.ssid2 = prefs.getString("ssid2", "");
  settings.pass2 = prefs.getString("pass2", "");
  settings.ssid3 = prefs.getString("ssid3", "");
  settings.pass3 = prefs.getString("pass3", "");
  settings.dhcp = prefs.getString("dhcp", "1");
  settings.static_ip = prefs.getString("s_ip", "");
  settings.static_gateway = prefs.getString("s_gw", "");
  settings.static_subnet = prefs.getString("s_sub", "255.255.255.0");
  settings.static_dns = prefs.getString("s_dns", "");
  settings.wifi_indicator = prefs.getString("ind_wifi", "1");
  settings.companion_indicator = prefs.getString("ind_comp", "1");
  settings.setup_indicator = prefs.getString("ind_setup", "1");
  settings.ultra_bright = prefs.getString("ultra", "0");
  settings.companion_ip = prefs.getString("comp_ip", "");
  settings.companion_port = prefs.getString("comp_port", "16622");
  settings.label = prefs.getString("label", "");
}

void persistSettings() {
  prefs.putString("ssid1", settings.ssid1);
  prefs.putString("pass1", settings.pass1);
  prefs.putString("ssid2", settings.ssid2);
  prefs.putString("pass2", settings.pass2);
  prefs.putString("ssid3", settings.ssid3);
  prefs.putString("pass3", settings.pass3);
  prefs.putString("dhcp", settings.dhcp);
  prefs.putString("s_ip", settings.static_ip);
  prefs.putString("s_gw", settings.static_gateway);
  prefs.putString("s_sub", settings.static_subnet);
  prefs.putString("s_dns", settings.static_dns);
  prefs.putString("ind_wifi", settings.wifi_indicator);
  prefs.putString("ind_comp", settings.companion_indicator);
  prefs.putString("ind_setup", settings.setup_indicator);
  prefs.putString("ultra", settings.ultra_bright);
  prefs.putString("comp_ip", settings.companion_ip);
  prefs.putString("comp_port", settings.companion_port);
  prefs.putString("label", settings.label);
}

// ================= Setup mode (AP + custom web UI) =================
void enterSetupMode() {
  client.stop();
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_AP_STA); // AP for the portal, STA idle so /wifi can scan
  WiFi.softAP(AP_SSID, AP_PASSWORD);
  setupWebServerRoutes();
  server.begin();

  unsigned long setupStart = millis();
  const unsigned long SETUP_TIMEOUT_MS = 300000; // 5 min idle -> give up

  while (true) {
    server.handleClient();
    indicatorStep(settings.setup_indicator, 0, 180, 0);

    if (restartPending && millis() > restartAtMs) ESP.restart();
    if (millis() - setupStart > SETUP_TIMEOUT_MS) ESP.restart();

    delay(10);
  }
}

void factoryReset() {
  flashWhite(1, 400);
  prefs.clear();
  loadSettings(); // repopulate the in-RAM struct with defaults
  delay(500);
  ESP.restart();
}

// Call frequently from loop(); handles holding BOOT for 3-7s = setup,
// past 7s = factory reset. Non-blocking except while the button is
// actually held down.
void checkBootButton() {
  if (digitalRead(BOOT_PIN) != LOW) return;

  unsigned long pressStart = millis();
  bool didFactoryReset = false;
  while (digitalRead(BOOT_PIN) == LOW) {
    unsigned long held = millis() - pressStart;
    if (held > 7000) {
      showSolid(255, 255, 255);
      didFactoryReset = true;
    } else if (held > 3000) {
      indicatorStep(settings.setup_indicator, 0, 180, 0);
    }
    delay(20);
  }
  unsigned long totalHeld = millis() - pressStart;
  if (didFactoryReset) {
    factoryReset(); // does not return
  } else if (totalHeld > 3000) {
    enterSetupMode(); // does not return
  }
  // short presses (<3s) are ignored
}

// ================= WiFi (hand-rolled STA, up to 3 saved networks) =================
bool tryConnectSTA(const String& ssid, const String& pass, unsigned long timeoutMs) {
  if (ssid.length() == 0) return false;

  if (settings.dhcp != "1") {
    IPAddress ip, gw, sn, dns;
    if (ip.fromString(settings.static_ip) && gw.fromString(settings.static_gateway) &&
        sn.fromString(settings.static_subnet)) {
      if (!dns.fromString(settings.static_dns)) dns = gw;
      WiFi.config(ip, gw, sn, dns);
    }
  }

  WiFi.begin(ssid.c_str(), pass.c_str());
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > timeoutMs) {
      WiFi.disconnect(true);
      return false;
    }
    checkBootButton();
    indicatorStep(settings.wifi_indicator, 0, 0, 255);
    delay(20);
  }
  return true;
}

// Blocks until connected to one of the saved networks, or reboots to
// retry from scratch. Only called when at least one SSID is saved --
// setup() routes straight to enterSetupMode() otherwise.
void connectWiFi() {
  phase = PHASE_WIFI;
  String ssids[3]  = { settings.ssid1, settings.ssid2, settings.ssid3 };
  String passes[3] = { settings.pass1, settings.pass2, settings.pass3 };

  for (int i = 0; i < 3; i++) {
    if (tryConnectSTA(ssids[i], passes[i], 8000)) return;
  }
  delay(500); // all saved networks failed; reboot and try the whole list again
  ESP.restart();
}

// ================= Companion Satellite protocol =================
void sendLine(const String& line) {
  client.print(line);
  client.print("\n");
}

String getArg(const String& line, const String& key) {
  int idx = line.indexOf(key + "=");
  if (idx == -1) return "";
  idx += key.length() + 1;
  if (idx >= (int)line.length()) return "";
  if (line[idx] == '"') {
    int end = line.indexOf('"', idx + 1);
    if (end == -1) return "";
    return line.substring(idx + 1, end);
  } else {
    int end = line.indexOf(' ', idx);
    if (end == -1) end = line.length();
    return line.substring(idx, end);
  }
}

void applyColorHex(const String& hex) {
  lastColorHex = hex;
  if (identifyUntil > millis()) return; // don't disturb a locate-me blink in progress
  if (hex.length() >= 7 && hex[0] == '#') {
    long val = strtol(hex.substring(1).c_str(), NULL, 16);
    uint8_t r = (val >> 16) & 0xFF;
    uint8_t g = (val >> 8) & 0xFF;
    uint8_t b = val & 0xFF;
    showSolid(r, g, b);
  } else {
    showSolid(0, 0, 0);
  }
}

void handleLine(String line) {
  line.trim();
  if (line.length() == 0) return;
  lastRxLine = millis();

  if (line.startsWith("PING")) {
    String payload = line.length() > 5 ? line.substring(5) : "";
    sendLine("PONG " + payload);
    return;
  }

  if (line.startsWith("BEGIN")) {
    // Register as a 1-key virtual surface. Companion's own Surfaces
    // settings UI is what decides which button this mirrors.
    String cmd = "ADD-DEVICE DEVICEID=" + deviceSerial +
                 " PRODUCT_NAME=\"TallyWatch\"" +
                 " SERIAL=" + deviceSerial +
                 " BRIGHTNESS=true" +
                 " KEYS_TOTAL=1 KEYS_PER_ROW=1 BITMAPS=0 COLORS=hex TEXT=false";
    sendLine(cmd);
    return;
  }

  if (line.startsWith("ADD-DEVICE")) {
    if (line.indexOf("ERROR") != -1) {
      deviceRegistered = false;
    } else {
      deviceRegistered = true;
      phase = PHASE_SYNCED;
    }
    return;
  }

  if (line.startsWith("KEY-STATE")) {
    String devId = getArg(line, "DEVICEID");
    if (devId != deviceSerial) return;
    String color = getArg(line, "COLOR");
    applyColorHex(color);
    return;
  }

  if (line.startsWith("BRIGHTNESS")) {
    String devId = getArg(line, "DEVICEID");
    if (devId != deviceSerial) return;
    String val = getArg(line, "VALUE");
    if (val.length() > 0) {
      int pct = val.toInt();
      ledBrightness = (uint8_t)constrain(map(pct, 0, 100, 0, 255), 0, 255);
    }
    return;
  }

  // BEGIN's CAPS line, QUIT acks, KEYS-CLEAR, etc. are ignored -- fine
  // to no-op on anything we don't recognize.
}

void connectToCompanion() {
  deviceRegistered = false;
  phase = PHASE_COMPANION;
  rxBuffer = "";
  indicatorStep(settings.companion_indicator, 255, 0, 0); // keep the "connecting" indicator animating during retries

  int port = settings.companion_port.toInt();
  if (port <= 0) port = 16622;

  if (client.connect(settings.companion_ip.c_str(), port)) {
    lastRxLine = millis();
    lastPingSent = millis();
  } else {
    delay(200); // short backoff; indicatorStep above still gives visual feedback each retry
  }
}

// ================= Setup / loop =================
String macSerial() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char buf[28];
  snprintf(buf, sizeof(buf), "TallyWatch:%02X%02X%02X%02X%02X%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(buf);
}

// Bring up mDNS + the HTTP server once WiFi is connected, so the beacon is
// discoverable and manageable during normal operation (not just setup mode).
void startNetServices() {
  String host = "tallywatch-" + deviceSerial.substring(deviceSerial.indexOf(':') + 1);
  host.toLowerCase();
  if (MDNS.begin(host.c_str())) {
    MDNS.addService("tallywatch", "tcp", 80);
    MDNS.addServiceTxt("tallywatch", "tcp", "id", deviceSerial);
    MDNS.addServiceTxt("tallywatch", "tcp", "fw", FW_VERSION);
  }
  setupWebServerRoutes();
  server.begin();
}

void setup() {
  Serial.begin(115200);
  strip.begin();
  showSolid(0, 0, 0);

  pinMode(BOOT_PIN, INPUT_PULLUP);

  prefs.begin("tally", false);
  loadSettings();

  // Stable per-device ID, generated once (needs WiFi.macAddress, which
  // works even before connecting).
  deviceSerial = prefs.getString("serial", "");
  if (deviceSerial.length() == 0) {
    deviceSerial = macSerial();
    prefs.putString("serial", deviceSerial);
  }

  bool hasAnySavedNetwork = settings.ssid1.length() || settings.ssid2.length() || settings.ssid3.length();
  if (!hasAnySavedNetwork) {
    enterSetupMode(); // first boot ever -- does not return
  }
}

void loop() {
  checkBootButton();

  if (WiFi.status() != WL_CONNECTED) {
    servicesStarted = false; // rebuild mDNS/server after a reconnect
    connectWiFi(); // blocks until connected or reboots
    return;
  }

  if (!servicesStarted) {
    startNetServices();
    servicesStarted = true;
  }

  server.handleClient(); // management HTTP stays live during normal operation

  if (restartPending && millis() > restartAtMs) ESP.restart(); // e.g. after an OTA

  // Locate-me blink overrides the mirrored color while active.
  if (identifyUntil > millis()) {
    identifyBlinkStep();
  } else if (wasIdentifying) {
    wasIdentifying = false;
    restoreLastColor();
  }

  if (!client.connected()) {
    connectToCompanion();
    return;
  }

  if (phase != PHASE_SYNCED) {
    indicatorStep(settings.companion_indicator, 255, 0, 0);
  }

  while (client.available()) {
    char c = client.read();
    if (c == '\n') {
      handleLine(rxBuffer);
      rxBuffer = "";
    } else if (c != '\r') {
      rxBuffer += c;
    }
  }

  if (millis() - lastPingSent > PING_INTERVAL_MS) {
    sendLine("PING keepalive");
    lastPingSent = millis();
  }

  if (millis() - lastRxLine > RX_TIMEOUT_MS) {
    client.stop(); // will reconnect next loop
  }
}
