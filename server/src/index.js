// index.js — 智能药柜云端管理平台 · 服务端入口
// Express (REST) + ws (WebSocket 双通道) + 内存数据仓库 + 虚拟硬件仿真器
import express from 'express';
import http from 'http';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { createDb } from './state.js';
import { DeviceManager } from './deviceManager.js';
import { Hub } from './hub.js';
import { Simulator } from './simulator.js';
import { createTcpGateway } from './tcpGateway.js';
import { CameraManager } from './cameraManager.js';
import { createRouter } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);
const TCP_PORT = Number(process.env.TCP_PORT || 3002);

// ---------- 核心对象 ----------
const db = createDb();
const hub = new Hub(db, null);
const devices = new DeviceManager(db, { broadcast: (type, payload) => hub.broadcast(type, payload) });
hub.devices = devices;
const simulator = new Simulator({ db, devices, hub });
hub.bind({ simulator });
const cameras = new CameraManager(db);

// ---------- Express ----------
const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', createRouter({ db, devices, hub, simulator, cameras }));

// 生产模式：托管前端构建产物（npm run build 后）
const webDist = path.join(__dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

// 错误兜底
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ message: '服务内部错误', detail: err.message });
});

// ---------- HTTP + WebSocket ----------
// 单 WSS + 手动按路径路由：ws 库多个带 path 的 WSS 共用同一 HTTP server 时，
// 路径不匹配的升级请求会被先注册的监听器 abort(400)，故在此统一分发。
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
wss.on('connection', (ws, req) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/ws/hardware') hub.attachHardware(ws, req);
  else if (pathname === '/ws/ui') hub.attachUi(ws);
  else {
    try { ws.close(4004, 'unknown path'); } catch { /* noop */ }
  }
});

// ---------- TCP-AT 网关（AT 固件模式的 ESP-01S 直连）----------
createTcpGateway(hub, TCP_PORT);

server.listen(PORT, () => {
  simulator.start();
  setInterval(() => devices.sweep(), 10000);
  const online = devices.list().filter((d) => d.online).length;
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║   智能药柜云端管理平台 Smart Pharmacy Cloud Platform    ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log(`  REST API      http://127.0.0.1:${PORT}/api/kpis`);
  console.log(`  硬件通道 WS   ws://127.0.0.1:${PORT}/ws/hardware  (ESP-01S)`);
  console.log(`  硬件通道 TCP  tcp://127.0.0.1:${TCP_PORT}          (AT 固件直连)`);
  console.log(`  前端通道 WS   ws://127.0.0.1:${PORT}/ws/ui        (Web UI)`);
  console.log(`  设备在线      ${online}/${db.devices.length}  (空模板模式：真实设备接入后自动注册)`);
  console.log(`  今日处方      ${db.prescriptions.length} 单 · 复核留档 ${db.audits.length} 条`);
  console.log('');
});
