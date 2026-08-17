/*
 * smart_cabinet_esp01s.ino — 智能药柜 ESP-01S (ESP8266) 固件骨架
 * =====================================================================
 *  功能：连接局域网 Wi-Fi → 与服务端建立 WebSocket 长连接(/ws/hardware)
 *        接收 DISPENSE_ACTION 指令 → 驱动货位执行机构 → 上报完成/告警
 *        周期心跳 + 红外传感器出药计数上报
 *
 *  Arduino IDE 配置（ESP-01S）：
 *    开发板    : Generic ESP8266 Module
 *    Flash Size: 1MB (FS:64KB OTA:~470KB)
 *    Flash Mode: DIO / 80MHz / 115200
 *  依赖库    :
 *    - WebSockets  (links2004/WebSockets, v2.4.x)  ← ESP-01S 需用它
 *    - ArduinoJson (bblanchon/ArduinoJson, v6.x)
 *  内存提示   : ESP-01S 仅 1MB Flash / ~50KB RAM。
 *              若编译报 RAM 不足，可在 工具->Flash Size 选 1MB(FS:64KB)，
 *              并将 WEBSOCKETS_MAX_DATA_SIZE 改为 1024。
 *
 *  JSON 协议见根目录 README.md「硬件通信协议」章节。
 * =====================================================================
 */

#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ----------------------- 局域网配置（刷入前必改）------------------------
const char* WIFI_SSID     = "Pharmacy-Net";   // 药房局域网 SSID
const char* WIFI_PASS     = "12345678";       // Wi-Fi 密码
const char* SERVER_HOST   = "192.168.1.100";  // 电脑（服务端）局域网 IP
const uint16_t SERVER_PORT = 3001;
const char* WS_PATH       = "/ws/hardware";
const char* DEVICE_ID     = "PMC-001";        // 设备编号，需与服务端台账一致

// ----------------------- 引脚映射（按实际接线调整）----------------------
const uint8_t PIN_STATUS_LED = 2;   // GPIO2  板载 LED（低电平点亮，ESP-01S 板上蓝色 LED）
const uint8_t PIN_STEP       = 0;   // GPIO0  步进电机 STEP 脉冲（占位，需加 ULN2003/A4988 驱动）
const uint8_t PIN_DIR        = 0;   // GPIO0  同引脚示例：单电机时 STEP/DIR 复用一个引脚
const uint8_t PIN_SENSOR     = 3;   // RX(GPIO3) 出药口红外传感器输入（占位，外部上拉）

// ----------------------- 运行参数 --------------------------------------
const uint32_t HEARTBEAT_MS   = 30000;  // 心跳周期
const uint32_t SENSOR_DEBOUNCE = 300;   // 传感器消抖
const uint32_t STEP_DELAY_US  = 1200;   // 步进脉冲宽度（按电机调）
const uint8_t  MAX_JOBS       = 8;      // 单任务最多货位数

// ----------------------- 状态变量 --------------------------------------
WebSocketsClient ws;
bool      dispenseBusy   = false;
bool      sensorLast     = false;
uint32_t  lastHeartbeat  = 0;
uint32_t  lastSensorEdge = 0;

struct SlotJob {
  char coord[8];
  int  qty;
};
SlotJob jobs[MAX_JOBS];
uint8_t jobCount = 0;
char    activeTaskId[32] = "";

// ----------------------- 工具函数 --------------------------------------
void blinkLed(int times, int ms) {
  for (int i = 0; i < times; i++) {
    digitalWrite(PIN_STATUS_LED, LOW); delay(ms);
    digitalWrite(PIN_STATUS_LED, HIGH); delay(ms);
  }
}

// 上报 JSON：{"deviceId":"PMC-001","type":"...","taskId":"...","dispensedQty":n,"status":"...","rssi":-58}
void report(const char* type, const char* taskId, const char* status, int qty) {
  if (!ws.isConnected()) return;
  char buf[256];
  int rssi = WiFi.RSSI();
  snprintf(buf, sizeof(buf),
    "{\"deviceId\":\"%s\",\"type\":\"%s\",\"taskId\":\"%s\",\"dispensedQty\":%d,\"status\":\"%s\",\"rssi\":%d}",
    DEVICE_ID, type, taskId ? taskId : "", qty, status ? status : "OK", rssi);
  ws.sendTXT(buf);
  Serial.print("[TX] "); Serial.println(buf);
}

// 上报告警：{"deviceId":"...","type":"ALARM","message":"...","level":"WARN"}
void reportAlarm(const char* message, const char* level) {
  if (!ws.isConnected()) return;
  char buf[220];
  snprintf(buf, sizeof(buf),
    "{\"deviceId\":\"%s\",\"type\":\"ALARM\",\"message\":\"%s\",\"level\":\"%s\",\"rssi\":%d}",
    DEVICE_ID, message, level, WiFi.RSSI());
  ws.sendTXT(buf);
  Serial.print("[TX] "); Serial.println(buf);
}

// 驱动一个货位：电机脉冲 qty 次（每次脉冲 = 推出一盒）
// ★ 按实际执行机构改造：步进电机 / 电磁阀 / 舵机推板 / 指示灯联动
void driveSlot(const SlotJob& job) {
  Serial.printf("[DRV] 货位 %s 出药 %d 盒\n", job.coord, job.qty);
  digitalWrite(PIN_STATUS_LED, LOW);      // 工作指示灯亮
  for (int i = 0; i < job.qty; i++) {
    digitalWrite(PIN_STEP, HIGH);
    delayMicroseconds(STEP_DELAY_US);
    digitalWrite(PIN_STEP, LOW);
    delayMicroseconds(STEP_DELAY_US);
    // TODO: 等待红外传感器确认出药计数（带超时），计数不符时 reportAlarm(...)
    delay(400);
  }
  digitalWrite(PIN_STATUS_LED, HIGH);
  // TODO: 可在此驱动对应货位指示灯（GPIO 扩展 IO 口 / 74HC595）
}

// 执行完整取药任务：逐货位出药 → 上报 ACTION_FINISHED
void executeDispense() {
  dispenseBusy = true;
  int total = 0;
  for (uint8_t i = 0; i < jobCount; i++) {
    driveSlot(jobs[i]);
    total += jobs[i].qty;
  }
  report("ACTION_FINISHED", activeTaskId, "SUCCESS", total);
  dispenseBusy = false;
  jobCount = 0;
  activeTaskId[0] = '\0';
  blinkLed(2, 120);
}

// 解析服务端下发指令
void handleCommand(uint8_t* payload, size_t length) {
  StaticJsonDocument<1024> doc;          // ESP-01S 内存有限，任务货位不宜过多
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    reportAlarm("JSON 解析失败", "ERROR");
    return;
  }
  const char* cmd = doc["cmd"] | "";
  if (strcmp(cmd, "DISPENSE_ACTION") == 0) {
    if (dispenseBusy) {                   // 忙则拒绝新任务
      reportAlarm("设备忙，任务被拒绝", "WARN");
      return;
    }
    strncpy(activeTaskId, doc["taskId"] | "", sizeof(activeTaskId) - 1);
    jobCount = 0;
    JsonArray slots = doc["slots"].as<JsonArray>();
    for (JsonObject s : slots) {
      if (jobCount >= MAX_JOBS) break;
      strncpy(jobs[jobCount].coord, s["coord"] | "", sizeof(jobs[jobCount].coord) - 1);
      jobs[jobCount].qty = s["qty"] | 1;
      jobCount++;
    }
    Serial.printf("[CMD] DISPENSE_ACTION taskId=%s slots=%d\n", activeTaskId, jobCount);
    executeDispense();
  } else if (strcmp(cmd, "PING") == 0) {
    report("HEARTBEAT", nullptr, "OK", 0);   // PING 即回心跳
  }
}

// WebSocket 事件回调
void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("[WS] 已连接服务端");
      blinkLed(3, 100);
      report("HEARTBEAT", nullptr, "OK", 0);   // 上线立即心跳
      break;
    case WStype_DISCONNECTED:
      Serial.println("[WS] 连接断开，自动重连中…");
      dispenseBusy = false;
      break;
    case WStype_TEXT:
      handleCommand(payload, length);
      break;
    default:
      break;
  }
}

// ----------------------- 初始化 ----------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_STATUS_LED, OUTPUT);
  pinMode(PIN_STEP, OUTPUT);
  pinMode(PIN_SENSOR, INPUT_PULLUP);
  digitalWrite(PIN_STATUS_LED, HIGH);
  blinkLed(2, 150);

  Serial.printf("\n[BOOT] 智能药柜 %s 固件启动\n", DEVICE_ID);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print('.');
  }
  Serial.printf("\n[NET] 已连接 %s，IP=%s RSSI=%d dBm\n", WIFI_SSID, WiFi.localIP().toString().c_str(), WiFi.RSSI());

  ws.begin(SERVER_HOST, SERVER_PORT, WS_PATH);
  ws.onEvent(webSocketEvent);
  ws.setReconnectInterval(3000);        // 断线 3s 重连
  ws.enableHeartbeat(15000, 5000, 2);   // 底层 PING/PONG 保活
  lastHeartbeat = millis();
}

// ----------------------- 主循环 ----------------------------------------
void loop() {
  ws.loop();

  // 周期心跳（30s）
  if (millis() - lastHeartbeat > HEARTBEAT_MS) {
    lastHeartbeat = millis();
    report("HEARTBEAT", nullptr, "OK", 0);
  }

  // 红外传感器边沿检测：每次触发 = 出药口通过一盒
  bool now = digitalRead(PIN_SENSOR) == LOW;   // 低电平触发（按传感器极性调整）
  if (now != sensorLast && now) {
    if (millis() - lastSensorEdge > SENSOR_DEBOUNCE) {
      lastSensorEdge = millis();
      report("SENSOR_TRIGGERED", nullptr, "OK", 0);
    }
  }
  sensorLast = now;
}
