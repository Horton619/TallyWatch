/*
  TallyWatch setup-mode web server
  ---------------------------------
  Custom HTTP routes for the setup AP, replacing WiFiManager's generic
  portal. Serves the VEP-styled setup page (gzip-embedded from
  firmware/page_html_gz.h) and a small JSON API it talks to.

  This header is included exactly once, from TallyWatch.ino, near the top
  -- it declares the shared settings struct and expects the actual global
  instances (settings, deviceSerial, server, prefs) to be defined in the
  .ino below the include. Requires ArduinoJson (v7.x) via Library Manager.

  NOTE: named web_routes.h, NOT webserver.h -- on a case-insensitive
  filesystem (macOS) a local "webserver.h" collides with the ESP32 core's
  <WebServer.h>, so #include <WebServer.h> would wrongly resolve to this file.
*/
#pragma once

#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <Update.h>
#include "firmware/page_html_gz.h"

struct TallySettings {
    String ssid1, pass1, ssid2, pass2, ssid3, pass3;
    String dhcp = "1";
    String static_ip, static_gateway, static_dns;
    String static_subnet = "255.255.255.0";
    String wifi_indicator = "1", companion_indicator = "1", setup_indicator = "1";
    String ultra_bright = "0";
    String companion_ip;
    String companion_port = "16622";
    String label; // friendly name shown in the manager (e.g. "Camera 1")
};

extern TallySettings settings;
extern WebServer server;
extern Preferences prefs;
extern String deviceSerial;
extern const char* FW_VERSION;
extern const char* FW_CODENAME;
extern const char* HARDWARE_VERSION;

extern volatile bool restartPending;
extern unsigned long restartAtMs;

// Live status/management state (defined in TallyWatch.ino)
extern WiFiClient client;
extern bool deviceRegistered;
extern String lastColorHex;
extern unsigned long identifyUntil;
extern bool wasIdentifying;

void persistSettings(); // defined in TallyWatch.ino

inline String signalStrength(int32_t rssi) {
    if (rssi > -60) return "high";
    if (rssi > -75) return "medium";
    return "low";
}

inline void applySettingsFromJson(JsonDocument& doc) {
    settings.ssid1 = doc["ssid1"] | settings.ssid1;
    settings.pass1 = doc["pass1"] | settings.pass1;
    settings.ssid2 = doc["ssid2"] | settings.ssid2;
    settings.pass2 = doc["pass2"] | settings.pass2;
    settings.ssid3 = doc["ssid3"] | settings.ssid3;
    settings.pass3 = doc["pass3"] | settings.pass3;
    settings.dhcp = doc["dhcp"] | settings.dhcp;
    settings.static_ip = doc["static_ip"] | settings.static_ip;
    settings.static_gateway = doc["static_gateway"] | settings.static_gateway;
    settings.static_subnet = doc["static_subnet"] | settings.static_subnet;
    settings.static_dns = doc["static_dns"] | settings.static_dns;
    settings.wifi_indicator = doc["wifi_indicator"] | settings.wifi_indicator;
    settings.companion_indicator = doc["companion_indicator"] | settings.companion_indicator;
    settings.setup_indicator = doc["setup_indicator"] | settings.setup_indicator;
    settings.ultra_bright = doc["ultra_bright"] | settings.ultra_bright;
    settings.companion_ip = doc["companion_ip"] | settings.companion_ip;
    settings.companion_port = doc["companion_port"] | settings.companion_port;
    settings.label = doc["label"] | settings.label;
}

inline void handleRoot() {
    server.sendHeader("Content-Encoding", "gzip");
    server.send_P(200, "text/html", (const char*)PAGE_HTML_GZ, PAGE_HTML_GZ_LEN);
}

inline void handleGetConfig() {
    JsonDocument doc;
    doc["ssid1"] = settings.ssid1; doc["pass1"] = settings.pass1;
    doc["ssid2"] = settings.ssid2; doc["pass2"] = settings.pass2;
    doc["ssid3"] = settings.ssid3; doc["pass3"] = settings.pass3;
    doc["dhcp"] = settings.dhcp;
    doc["static_ip"] = settings.static_ip;
    doc["static_gateway"] = settings.static_gateway;
    doc["static_subnet"] = settings.static_subnet;
    doc["static_dns"] = settings.static_dns;
    doc["wifi_indicator"] = settings.wifi_indicator;
    doc["companion_indicator"] = settings.companion_indicator;
    doc["setup_indicator"] = settings.setup_indicator;
    doc["ultra_bright"] = settings.ultra_bright;
    doc["companion_ip"] = settings.companion_ip;
    doc["companion_port"] = settings.companion_port;
    doc["label"] = settings.label;
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
}

inline void handleGetWifi() {
    int n = WiFi.scanNetworks();
    JsonDocument doc;
    JsonArray list = doc["list"].to<JsonArray>();
    for (int i = 0; i < n; i++) {
        JsonObject o = list.add<JsonObject>();
        o["ssid"] = WiFi.SSID(i);
        o["strength"] = signalStrength(WiFi.RSSI(i));
    }
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
    WiFi.scanDelete();
}

inline void handleGetAbout() {
    JsonDocument doc;
    doc["device_id"] = deviceSerial;
    doc["firmware_version"] = FW_VERSION;
    doc["firmware_name"] = FW_CODENAME;
    int colonIdx = deviceSerial.indexOf(':');
    doc["serial_number"] = colonIdx >= 0 ? deviceSerial.substring(colonIdx + 1) : deviceSerial;
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    doc["mac_address"] = macStr;
    doc["hardware_version"] = HARDWARE_VERSION;
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
}

inline void handlePostSave() {
    String body = server.arg("plain");
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, body);
    if (err) {
        server.send(400, "text/plain", "Bad JSON");
        return;
    }
    applySettingsFromJson(doc);
    persistSettings();
    server.send(200, "text/plain", "OK - restarting");
    restartPending = true;
    restartAtMs = millis() + 400; // let the response flush before reboot
}

inline void handleGetReboot() {
    server.send(200, "text/plain", "Rebooting");
    restartPending = true;
    restartAtMs = millis() + 300;
}

// Live status the manager polls to build its dashboard.
inline void handleGetStatus() {
    JsonDocument doc;
    doc["device_id"] = deviceSerial;
    doc["label"] = settings.label;
    doc["firmware_version"] = FW_VERSION;
    doc["ip"] = WiFi.localIP().toString();
    doc["wifi_rssi"] = WiFi.RSSI();
    doc["companion_connected"] = client.connected() && deviceRegistered;
    doc["color"] = lastColorHex;
    doc["uptime_s"] = (uint32_t)(millis() / 1000);
    String out;
    serializeJson(doc, out);
    server.send(200, "application/json", out);
}

// Rename a beacon without a reboot (manager convenience).
inline void handleSetLabel() {
    if (server.hasArg("value")) {
        settings.label = server.arg("value");
        persistSettings();
    }
    server.send(200, "text/plain", "OK");
}

// Flash the LED so an operator can physically find this unit.
inline void handleIdentify() {
    identifyUntil = millis() + 5000;
    wasIdentifying = true;
    server.send(200, "text/plain", "OK");
}

// OTA firmware upload. The upload handler streams the .bin into the OTA
// partition; the completion handler replies and schedules a reboot.
inline void handleOtaUpload() {
    HTTPUpload& up = server.upload();
    if (up.status == UPLOAD_FILE_START) {
        Update.begin(UPDATE_SIZE_UNKNOWN);
    } else if (up.status == UPLOAD_FILE_WRITE) {
        Update.write(up.buf, up.currentSize);
    } else if (up.status == UPLOAD_FILE_END) {
        Update.end(true);
    }
}

inline void handleOtaDone() {
    bool ok = !Update.hasError();
    server.send(200, "text/plain", ok ? "OK - rebooting" : "FAILED");
    if (ok) {
        restartPending = true;
        restartAtMs = millis() + 800; // let the response flush, then reboot into new fw
    }
}

inline void setupWebServerRoutes() {
    static bool registered = false;
    if (registered) return; // routes persist across setup/normal mode transitions
    registered = true;
    server.on("/", HTTP_GET, handleRoot);
    server.on("/config", HTTP_GET, handleGetConfig);
    server.on("/wifi", HTTP_GET, handleGetWifi);
    server.on("/about", HTTP_GET, handleGetAbout);
    server.on("/status", HTTP_GET, handleGetStatus);
    server.on("/save", HTTP_POST, handlePostSave);
    server.on("/setlabel", HTTP_POST, handleSetLabel);
    server.on("/identify", HTTP_GET, handleIdentify);
    server.on("/reboot", HTTP_GET, handleGetReboot);
    server.on("/update/firmware", HTTP_POST, handleOtaDone, handleOtaUpload);
}
