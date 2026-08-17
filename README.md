# 智能药柜云端管理平台 · Smart Pharmacy Cloud Platform

> B/S 架构 · 局域网运行 · ESP-01S (ESP8266) IoT 双向通信 · 现代 SaaS 风格 UI

一套面向药房的**「取、储、查、管」四大核心业务 + 「设备运维、复核审计」两大运维视图**的云端管理平台。
电脑作为局域网服务端（Node.js），ESP-01S 通过 Wi-Fi 建立 WebSocket / TCP 长连接接收取药指令、上报出药反馈；
前端 React 18 提供现代化监控/操作界面。

---

## 🚀 一键启动

```bash
npm install        # 安装全部依赖（workspaces）
npm run dev        # 同时启动 服务端(:3001) + 前端(:5173)
```

浏览器打开 **http://127.0.0.1:5173** 即可。

生产模式（构建后由服务端托管）：

```bash
npm start          # 构建前端 → 服务端托管 → http://127.0.0.1:3001
```

> **空模板模式**：系统不内置任何假数据 —— 处方队列、库存、审计留档、设备台账均为空，
> 货位保持 3×3 物理结构（A1~C3 全部空闲）。真实数据来自业务录入与 ESP-01S 设备接入，
> 设备首次心跳即自动注册上线（设备运维页可查看通道、IP、信号强度并下发 PING 测试指令）。

---

## 📁 工程结构

```
smart-pharmacy/
├── server/                        # Node.js 服务端 (Express + ws)
│   ├── src/
│   │   ├── index.js               # 入口：HTTP + 双 WebSocket 通道 + 静态托管
│   │   ├── state.js               # 内存数据仓库（空模板：无假数据，货位/计数器结构）
│   │   ├── protocol.js            # ESP-01S JSON 协议（编解码/校验）
│   │   ├── deviceManager.js       # 设备在线状态管理器（心跳/超时巡检/作业量/节奏）
│   │   ├── hub.js                 # WS/TCP 枢纽：/ws/hardware + TCP 网关 + /ws/ui（前端）
│   │   ├── tcpGateway.js          # TCP-AT 网关（:3002，AT 固件免刷机直连）
│   │   ├── simulator.js           # 虚拟硬件仿真器（应答下发、随机拦截/告警）
│   │   ├── routes.js              # REST API（取药/储药/查询/货位/设备/审计/调试）
│   │   └── pinyin.js              # 药品拼音简码映射
│   └── scripts/smoke.mjs          # 端到端冒烟测试（API + WS + 仿真链路）
├── web/                           # 前端 (React 18 + Vite + Tailwind)
│   └── src/
│       ├── components/            # Sidebar/Topbar/StatCard/Badge/Modal/Toasts/SlotMatrix/VoucherModal...
│       ├── pages/                 # Dashboard/Dispense/Store/Query/Slots/Ops/Audit
│       ├── hooks/useUiSocket.js   # 前端 WS 订阅 + 实时数据联动
│       ├── store/useAppStore.js   # Zustand 全局状态（设备台账/事件日志/轻提示）
│       └── lib/                   # api 客户端 / 格式化 / 抓拍快照 SVG 生成器
└── firmware/
    ├── esp01s_serial_bridge/      # 【推荐】串口透传桥固件：主控(串口) ↔ ESP-01S ↔ WebSocket ↔ 平台
    └── smart_cabinet_esp01s/      # 独立出药控制固件骨架（ESP-01S 直驱货位执行机构）
```

---

## 🌐 硬件通信协议（ESP-01S ↔ 服务端）

WebSocket 长连接，端点 `ws://<服务端IP>:3001/ws/hardware`，JSON 文本帧。

### 下行（Server → ESP-01S）取药任务

```json
{
  "cmd": "DISPENSE_ACTION",
  "taskId": "TASK-20260730-001",
  "slots": [
    { "coord": "A-03", "trayIndex": 1, "qty": 1 },
    { "coord": "B-07", "trayIndex": 2, "qty": 2 }
  ],
  "ts": 1789...
}
```

### 上行（ESP-01S → Server）状态与事件

| type | 说明 | 关键字段 |
| --- | --- | --- |
| `HEARTBEAT` | 周期心跳（30s） | `rssi` |
| `ACTION_FINISHED` | 出药完成回执 | `taskId, dispensedQty, status` |
| `SENSOR_TRIGGERED` | 出药口红外计数 | `slotCoord` |
| `ALARM` | 硬件告警 | `message, level` |

```json
{
  "deviceId": "PMC-001",
  "type": "ACTION_FINISHED",
  "taskId": "TASK-20260730-001",
  "dispensedQty": 1,
  "status": "SUCCESS",
  "rssi": -58
}
```

### 连接时序

1. ESP-01S 连 Wi-Fi → `ws.begin(服务端IP, 3001, "/ws/hardware")`（建议带 `?deviceId=PMC-001` 查询参数）
2. 上线立即上报一次 `HEARTBEAT`（服务端据此注册/上线设备，30s 无心跳自动离线）
3. 服务端下发 `DISPENSE_ACTION` → 固件逐货位驱动执行机构 → 上报 `ACTION_FINISHED`
4. 服务端核销任务 → 生成复核审计 → 广播到前端

前端订阅通道：`ws://<host>/ws/ui`（页面自动连接，事件类型见 `hub.js`）。

---

## 🖥️ 功能总览

| 模块 | 页面 | 能力 |
| --- | --- | --- |
| 总览 | `/` | 顶部 KPI（今日处方/已完成/队列/拦截 + 环比）、出药趋势柱状图、货位占用、设备状态、复核动态、库存预警 |
| 取药管理 | `/dispense` | 处方队列表格（脱敏取药人/品种/货位/状态）、**批量下发**到 ESP-01S、队列路径最短重排提示、**凭证弹窗（CODE128 条码 + 二维码，打印/下载）** |
| 储药管理 | `/store` | **扫码储药闭环**：机器扫 EAN-13 → 网页查库 → **未建档自动启动建档（名称/形状/尺寸/商品码自动录入）** → 确认储药按尺寸匹配货位（A 层大格/B 层中格/C 层小格）；另有手动入库登记与药品档案列表 |
| 药品查询 | `/query` | 品名/拼音简码/货位/效期区间组合检索、**效期临期（<90天）与低库存（<5件）双预警** |
| 货位看板 | `/slots` | **3层×3列（A1~C3）交互矩阵**，已占用/效期预警/空闲三态，悬浮三维坐标信息，点击详情 + 出库登记 |
| 设备运维 | `/ops` | 设备卡片（在线/离线、IP、信号、今日作业、告警历史）、平均节拍/准确率指标、**摄像头管理**（用户提供 IP 接入 `ip:81/stream`，用途可选：扫码 / 出药口复核 / 整机监控）、**扫码工作台**（视频流 BarcodeDetector 识别条码 → 自动接入扫码储药）、虚拟调试面板 |
| 复核审计 | `/audit` | 每次出药留档卡片流：**出药口抓拍快照、AI OCR 品规对照、处方原始品规**，一致/拦截标记，按处方号与时间范围追溯 |

### 设计规范（严格遵循）

- 底色 `#F8F9FD` · 卡片纯白 `rounded-2xl` + `border-slate-200/60` + 柔和微弥散阴影
- 主色 Indigo `#6366F1 / #4F46E5`，激活态 `#EEF2FF`
- 语义色：完成/一致=Emerald，待执行/处理中=Sky，效期预警=Amber，复核拦截=Rose
- 字体 Inter Variable（本地打包，离线可用）+ PingFang SC / Microsoft YaHei 回退
- 统计数字 `text-3xl/4xl font-bold tracking-tight`；卡片 `p-6`，间距 `gap-6`

---

## 📡 接入真实 ESP-01S（两种通道，任选其一）

你的 ESP-01S 已通过 USB 转串口（AT 指令）配好 WiFi 并与电脑同网段后，按以下方式接入。
**平台硬件通道支持两种接入方式，协议完全一致：**

| 通道 | 适用固件 | 接入方式 | 备注 |
| --- | --- | --- | --- |
| **WebSocket** `:3001/ws/hardware` | 自定义固件 | `ws.begin(IP, 3001, "/ws/hardware?deviceId=PMC-001")` | 推荐：串口透传桥固件 |
| **TCP-AT 网关** `:3002` | 原厂 AT 固件（无需刷机） | `AT+CIPSTART="TCP","<电脑IP>",3002` + 行协议 JSON | 你现在即可用 |

### 方案 A：AT 固件直连（当前即可用，无需刷机）

用串口调试助手（USB 转 TTL 连接 ESP-01S），每行末尾加回车，依次发送：

```text
AT+CWMODE=1
AT+CWJAP="你的WiFi名","你的WiFi密码"
AT+CIPMODE=1                                ← 透传模式（必须先设，否则 CIPSEND 报 ERROR）
AT+CIPSTART="TCP","192.168.0.100",3002      ← 换成电脑局域网 IP（设备运维页向导自动填充）
AT+CIPSEND                                  ← 进入透传，之后每行 JSON 直接发送
{"deviceId":"PMC-001","type":"HEARTBEAT","rssi":-58}
```

- 连接建立后 2 分钟内完成首条注册报文即可（服务端等待窗口 120 秒）
- 注册成功后服务端回发 `{"cmd":"PING",...}` 确认，串口可见即通道已通
- 之后每行 JSON 直接发送（`ACTION_FINISHED` / `SENSOR_TRIGGERED` / `ALARM`），平台下行指令原样输出到串口
- 退出透传：停 1 秒 → 发 `+++`（不带回车）→ 停 1 秒 → `AT+CIPMODE=0`
- 连接未断开即视为在线（不因手动心跳间隔长而闪断）；断开重连后自动恢复

### 方案 B：串口透传桥固件（药柜主控长期架构，推荐）

刷入 `firmware/esp01s_serial_bridge/esp01s_serial_bridge.ino`（Arduino IDE，Generic ESP8266 Module，依赖 WebSockets + ArduinoJson），架构变为：

```
药柜主控(STM32/Arduino/PLC) ──串口(115200, JSON 行)──> ESP-01S 桥固件 ──Wi-Fi/WebSocket──> 平台 :3001/ws/hardware
```

- 桥固件透明转发：主控串口发来的每行 JSON 原样上送平台（`ACTION_FINISHED` / `SENSOR_TRIGGERED` / `ALARM` 等），平台下行指令原样送达主控串口
- 桥固件自身维护连接与 30s 心跳（含 RSSI），`deviceId` 在固件顶部配置
- 主控无需了解任何网络细节，只面向串口收发业务 JSON

### 设备运维页能力（真实设备）

- 设备卡片：在线/离线、**通道标识**（WebSocket 直连 / TCP-AT 网关 / 虚拟仿真）、IP、信号强度、固件版本、最后心跳、今日作业量、平均节拍、准确率、告警历史
- **PING 测试指令**：向设备下发 `PING`，真实设备心跳回执即时刷新在线状态与 RSSI
- 真实设备接入后自动接管任务下发（负载均衡优先真实在线设备）
- 指令下发接口：`POST /api/devices/:id/command` `{ "cmd": "PING" | "DISPENSE_ACTION", ... }`

### 旧固件（独立出药控制）

`firmware/smart_cabinet_esp01s/` 为「ESP-01S 直接驱动货位执行机构」的固件骨架（无需主控，适合单柜极简场景）；若刷此固件，直接在 Arduino IDE 中修改顶部 `WIFI_SSID / WIFI_PASS / SERVER_HOST / DEVICE_ID` 后烧录。

> 内存提示：ESP-01S 仅 1MB Flash / ~50KB RAM，固件已按轻量编写；
> 若编译告警 RAM 不足，可将 `WEBSOCKETS_MAX_DATA_SIZE` 调至 1024 或精简任务货位上限 `MAX_JOBS`。

---

## 🔌 主要 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/kpis` | 顶部指标 + 出药趋势 |
| GET | `/api/prescriptions?status=&q=` | 处方列表 |
| POST | `/api/prescriptions/dispatch` | 批量下发 `{ids:[]}` |
| POST | `/api/inventory` | 入库登记（自动分配货位） |
| GET | `/api/query?q=&pinyin=&slot=&from=&to=` | 库存检索 |
| GET | `/api/slots/recommend?qty=` | 智能货位推荐 |
| POST | `/api/slots/:coord/outbound` | 货位出库 |
| GET | `/api/devices` | 设备台账 |
| GET | `/api/devices/:id` | 设备详情（含通道/IP/心跳） |
| POST | `/api/devices/:id/command` | 指令下发 `{cmd:"PING"\|"DISPENSE_ACTION",...}` |
| POST | `/api/devices/:id/simulator` | 虚拟仿真开关 |
| GET/POST | `/api/cameras` | 摄像头列表 / 接入（`{ip, port?, purpose, name?}`） |
| DELETE | `/api/cameras/:id` | 移除摄像头 |
| GET | `/api/cameras/:id/stream` | MJPEG 视频流代理（`<img>` 直接播放，解决跨域） |
| GET | `/api/cameras/:id/frame` | 最新 JPEG 帧（扫码识别轮询） |
| POST | `/api/storage/verify` | 扫码查库 `{barcode}` → 已建档/未建档 |
| POST | `/api/storage/register` | 启动建档 `{barcode, name, shape, size}`（条码唯一校验） |
| POST | `/api/storage/confirm` | 确认储药 → 按尺寸匹配货位入库 |
| GET | `/api/audits?prescriptionNo=&from=&to=&verdict=` | 复核留档检索 |
| POST | `/api/debug/simulate` | 调试面板事件注入 |

冒烟测试：`node server/scripts/smoke.mjs`（需服务端已启动，覆盖 API 空模板容错 + 硬件心跳注册 + TCP 网关双向通道 + 入库联动）。

---

## 🛠️ 技术栈

- **前端**：React 18 · Vite 5 · Tailwind CSS 3 · Lucide Icons · Zustand · jsbarcode（CODE128）· qrcode.react
- **后端**：Node.js · Express 4 · ws（双通道 WebSocket）· 内存数据仓库
- **硬件**：ESP8266 (ESP-01S) · Arduino · WebSockets / ArduinoJson
