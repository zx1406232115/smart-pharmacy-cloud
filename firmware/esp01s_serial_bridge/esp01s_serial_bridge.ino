/*
 * esp01s_serial_bridge.ino — ESP-01S 串口透传桥（药柜主控 ↔ 云端平台）
 * =====================================================================
 *  架构：药柜主控(STM32/Arduino/PLC) ──串口──> ESP-01S ──Wi-Fi/WebSocket──> 网站服务端
 *          （业务 JSON 行）                          （/ws/hardware 通道）
 *
 *  工作方式（透明桥接）：
 *    · 串口收到的每一行（\n 结尾）原样经 WebSocket 转发给服务端
 *      —— 药柜主控只需维护自己的业务 JSON，例如：
 *        {"type":"HEARTBEAT","rssi":-58}
 *        {"type":"ACTION_FINISHED","taskId":"TASK-2026-08-16-100","dispensedQty":3,"status":"SUCCESS"}
 *        {"type":"SENSOR_TRIGGERED","slotCoord":"A-03"}
 *        {"type":"ALARM","message":"出药口卡料","level":"WARN"}
 *      —— deviceId 由桥固件在连接参数中声明，主控无需关心
 *    · 服务端下发的指令（如 DISPENSE_ACTION）原样输出到串口（\n 结尾），主控解析执行
 *    · 桥固件自身周期发送 HEARTBEAT（含 RSSI），保证设备在线状态与信号强度实时展示
 *
 *  Arduino IDE 配置：
 *    开发板 Generic ESP8266 Module / Flash 1MB / 115200
 *    依赖库：WebSockets (links2004)、ArduinoJson (bblanchon) —— 仅解析下行指令时用
 *
 *  接线（刷写完成后接药柜主控）：
 *    ESP-01S TX  → 主控 RX（注意电平转换，ESP-01S 为 3.3V TTL）
 *    ESP-01S RX  → 主控 TX
 *    主控必须共地（GND-GND）
 * =====================================================================
 */

#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ----------------------- 配置（刷入前必改）----------------------------
const char* WIFI_SSID     = "Pharmacy-Net";   // 药房局域网 SSID
const char* WIFI_PASS     = "12345678";       // Wi-Fi 密码
const char* SERVER_HOST   = "192.168.1.100";  // 电脑（服务端）局域网 IP
const uint16_t SERVER_PORT = 3001;
const char* DEVICE_ID     = "PMC-001";        // 设备编号，需与平台台账一致（自动注册）
const uint32_t SERIAL_BAUD = 115200;          // 与药柜主控串口波特率一致（9600/115200/…）
const uint32_t HEARTBEAT_MS = 30000;          // 心跳周期

WebSocketsClient ws;
uint32_t lastHeartbeat = 0;
String serialLine;                            // 串口行缓冲

// 心跳上报：{"deviceId":"PMC-001","type":"HEARTBEAT","rssi":-58,"bridge":{"tx":n,"rx":n}}
void sendHeartbeat() {
  if (!ws.isConnected()) return;
  char buf[160];
  snprintf(buf, sizeof(buf),
    "{\"deviceId\":\"%s\",\"type\":\"HEARTBEAT\",\"rssi\":%d,\"bridge\":{\"serialRx\":%lu}}",
    DEVICE_ID, WiFi.RSSI(), (unsigned long)serialLine.length());
  ws.sendTXT(buf);
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("[BRIDGE] 已连接服务端");
      sendHeartbeat();                        // 上线立即心跳（完成设备注册）
      break;
    case WStype_DISCONNECTED:
      Serial.println("[BRIDGE] 连接断开，自动重连中…");
      break;
    case WStype_TEXT: {
      // 服务端下行指令 → 转发给药柜主控（\n 结尾）
      Serial.write(payload, length);
      Serial.println();
      break;
    }
    default:
      break;
  }
}

void setup() {
  Serial.begin(SERIAL_BAUD);                  // 与药柜主控对接的串口
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print('.');
  }
  Serial.printf("\n[BRIDGE] %s 已连接 WiFi，IP=%s RSSI=%d\n", DEVICE_ID,
                WiFi.localIP().toString().c_str(), WiFi.RSSI());

  char path[48];
  snprintf(path, sizeof(path), "/ws/hardware?deviceId=%s", DEVICE_ID);
  ws.begin(SERVER_HOST, SERVER_PORT, path);
  ws.onEvent(webSocketEvent);
  ws.setReconnectInterval(3000);
  ws.enableHeartbeat(15000, 5000, 2);         // 底层保活
  lastHeartbeat = millis();
}

void loop() {
  ws.loop();

  // 周期心跳（30s）
  if (millis() - lastHeartbeat > HEARTBEAT_MS) {
    lastHeartbeat = millis();
    sendHeartbeat();
  }

  // 串口 → WebSocket：按行透传（主控发来的业务 JSON，\n 结尾）
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialLine.length() > 0) {
        if (ws.isConnected()) ws.sendTXT(serialLine);
        serialLine = "";
      }
    } else {
      if (serialLine.length() < 512) serialLine += c;   // 单行上限 512 字节
      else serialLine = "";
    }
  }
}
