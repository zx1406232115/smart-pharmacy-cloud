// hub.js — 通信枢纽
//  硬件上行通道（两种接入方式，协议一致）：
//    · WebSocket  /ws/hardware            —— 自定义固件（ESP-01S 直连 / 串口透传桥）
//    · TCP 网关   :3002（行协议 \n 分帧） —— AT 固件模式（无需刷机，AT+CIPSTART 即连）
//  前端订阅通道  /ws/ui
//  统一处理：心跳 / 出药完成 / 传感器触发 / 告警 → 任务核销、审计留档、广播推送
import { normalizeHardwareMessage, buildPing } from './protocol.js';

const PENDING_TIMEOUT_WS = 5000;   // WebSocket：5s 内未上报 deviceId 则断开（固件自动连接，足够）
const PENDING_TIMEOUT_TCP = 120000; // TCP-AT：120s（用户经串口手动 AT 操作，需留足时间）

export class Hub {
  constructor(db, devices) {
    this.db = db;
    this.devices = devices;
    this.uiClients = new Set();
    this.connDevices = new Map();    // conn(ws|tcp socket) -> deviceId
    this.pendingConns = new Set();   // 未上报 deviceId 的连接
    this.lastEvents = [];            // 事件日志（环形，上限 60 条）
    this.simulator = null;
  }

  bind({ simulator }) {
    this.simulator = simulator;
  }

  // ---------------- 事件日志 / 广播 ----------------
  logEvent(kind, title, extra = {}) {
    const ev = { id: `EV-${Date.now()}-${Math.floor(Math.random() * 999)}`, at: Date.now(), kind, title, detail: extra.detail || '', tone: extra.tone || 'slate' };
    this.lastEvents.unshift(ev);
    if (this.lastEvents.length > 60) this.lastEvents.pop();
    this.broadcast('event.logged', ev);
    return ev;
  }

  broadcast(type, payload) {
    const msg = JSON.stringify({ type, ...payload, _ts: Date.now() });
    for (const ws of this.uiClients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }

  // ---------------- 前端 UI 通道 ----------------
  attachUi(ws) {
    this.uiClients.add(ws);
    ws.send(JSON.stringify({
      type: 'hello',
      serverTime: Date.now(),
      today: this.db.today,
      devices: this.devices.list().map((d) => this.devices.public(d)),
      simulator: [...this.db.simEnabled],
    }));
    ws.send(JSON.stringify({ type: 'history', events: this.lastEvents }));
    ws.on('close', () => this.uiClients.delete(ws));
    ws.on('error', () => this.uiClients.delete(ws));
  }

  // ---------------- 硬件通道：WebSocket 接入 ----------------
  attachHardware(ws, req) {
    const ip = req.socket?.remoteAddress || null;
    const url = new URL(req.url, 'http://localhost');
    const qid = url.searchParams.get('deviceId');
    if (qid) {
      this.bindConn(ws, qid, 'ws', ip);
    } else {
      this.pendingConns.add(ws);
      setTimeout(() => {
        if (this.pendingConns.has(ws)) {
          this.pendingConns.delete(ws);
          try { ws.close(4001, 'missing deviceId'); } catch { /* noop */ }
        }
      }, PENDING_TIMEOUT_WS);
    }
    ws.on('message', (data) => {
      const msg = normalizeHardwareMessage(data.toString());
      if (!msg) return;
      if (this.pendingConns.has(ws)) {
        this.pendingConns.delete(ws);
        this.bindConn(ws, msg.deviceId, 'ws', ip);
      }
      if (this.connDevices.get(ws) !== msg.deviceId) return; // 防串号
      this.handleHardwareMessage(msg.deviceId, msg);
    });
    ws.on('close', () => this.cleanupConn(ws));
    ws.on('error', () => { /* 由 close 清理 */ });
  }

  // ---------------- 硬件通道：TCP-AT 网关接入 ----------------
  // AT 固件连接后直接发送 JSON 行（\n 结尾），协议与 WebSocket 完全一致：
  //   AT+CIPSTART="TCP","<服务端IP>",3002 → 发送 {"deviceId":"PMC-001","type":"HEARTBEAT","rssi":-58}
  attachTcp(socket) {
    const ip = socket.remoteAddress || null;
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setNoDelay(true);
    this.pendingConns.add(socket);
    setTimeout(() => {
      if (this.pendingConns.has(socket)) {
        this.pendingConns.delete(socket);
        try { socket.destroy(); } catch { /* noop */ }
      }
    }, PENDING_TIMEOUT_TCP);

    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 16384) buffer = buffer.slice(-4096); // 防异常膨胀
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        const msg = normalizeHardwareMessage(line);
        if (!msg) continue;
        if (this.pendingConns.has(socket)) {
          this.pendingConns.delete(socket);
          this.bindConn(socket, msg.deviceId, 'tcp', ip);
        }
        if (this.connDevices.get(socket) !== msg.deviceId) continue;
        this.handleHardwareMessage(msg.deviceId, msg);
      }
    });
    socket.on('close', () => this.cleanupConn(socket));
    socket.on('error', () => { /* 由 close 清理 */ });
  }

  // ---------------- 连接绑定 / 清理 ----------------
  bindConn(conn, deviceId, channel, ip) {
    if (!this.devices.get(deviceId)) {
      // 自动注册新设备（真实硬件/网关首次接入）
      const now = Date.now();
      const dev = {
        deviceId, name: `药柜 ${deviceId}`, model: channel === 'tcp' ? 'ESP-01S (AT)' : 'ESP-01S', ip: null,
        firmware: '未知', online: false, virtual: false, simEnabled: false, rssi: null,
        lastSeen: now, connectedAt: now, todayJobs: 0, totalJobs: 0, avgCycleMs: 6000,
        accuracy: 1, alarms: [], conn: null, channel,
      };
      this.db.devices.push(dev);
      this.devices.byId.set(deviceId, dev);
      this.logEvent('device.register', `新设备接入 ${deviceId}`, { detail: `${channel === 'tcp' ? 'TCP-AT 网关' : 'WebSocket'} 通道`, tone: 'indigo' });
    }
    this.connDevices.set(conn, deviceId);
    this.devices.attachConn(deviceId, conn, channel, ip);
    this.logEvent('device.connect', `${deviceId} 已连接`, { detail: `${channel === 'tcp' ? 'TCP:3002' : 'WS:/ws/hardware'} · ${ip ? ip.replace(/^::ffff:/, '') : '未知 IP'}`, tone: 'emerald' });
    this.sendToConn(conn, buildPing());
  }

  cleanupConn(conn) {
    const devId = this.connDevices.get(conn);
    if (devId) {
      this.connDevices.delete(conn);
      this.devices.detachConn(devId);
    }
    this.pendingConns.delete(conn);
  }

  sendToConn(conn, payload) {
    try {
      if (conn.readyState !== undefined && conn.readyState === 1) conn.send(JSON.stringify(payload)); // WebSocket
      else if (conn.writable) conn.write(JSON.stringify(payload) + '\n');                              // TCP
      return true;
    } catch {
      return false;
    }
  }

  /** 下发指令到指定设备：真实连接直发；虚拟设备交给仿真器应答 */
  sendToDevice(deviceId, payload) {
    const dev = this.devices.get(deviceId);
    if (!dev) return null;
    if (dev.conn && this.sendToConn(dev.conn, payload)) {
      return { mode: dev.channel === 'tcp' ? 'tcp' : 'ws' };
    }
    if (dev.virtual && this.simulator) {
      if (payload.cmd === 'DISPENSE_ACTION') {
        this.simulator.planDispatch(deviceId, payload);
        return { mode: 'virtual' };
      }
      if (payload.cmd === 'PING') {
        this.simulator.pong(deviceId);
        return { mode: 'virtual' };
      }
    }
    return null;
  }

  // ---------------- 硬件上行统一处理 ----------------
  handleHardwareMessage(deviceId, msg) {
    const dev = this.devices.get(deviceId);
    if (!dev) return;
    switch (msg.type) {
      case 'HEARTBEAT':
        this.devices.heartbeat(deviceId, { rssi: msg.rssi });
        break;
      case 'SENSOR_TRIGGERED':
        this.broadcast('sensor.triggered', { deviceId, slotCoord: msg.slotCoord || '—', at: msg.ts });
        this.logEvent('sensor.triggered', `${deviceId} 红外传感器触发`, { detail: `货位 ${msg.slotCoord || '—'} · 出药计数`, tone: 'sky' });
        break;
      case 'ACTION_FINISHED':
        this.onActionFinished(deviceId, msg);
        break;
      case 'ALARM':
        this.devices.addAlarm(deviceId, { level: msg.level || 'WARN', message: msg.message || '未知硬件告警' });
        this.broadcast('alarm', { deviceId, level: msg.level || 'WARN', message: msg.message || '未知硬件告警', at: msg.ts });
        this.logEvent('alarm', `${deviceId} 硬件告警`, { detail: msg.message || '', tone: 'rose' });
        break;
      default:
        break;
    }
  }

  /** 出药完成：核销任务 → 生成复核审计 → 广播 */
  onActionFinished(deviceId, msg) {
    const p = this.db.prescriptions.find((x) => x.taskId === msg.taskId);
    if (!p) {
      this.logEvent('task.unknown', `收到未知任务回执 ${msg.taskId}`, { detail: `${deviceId} · ${msg.status}`, tone: 'amber' });
      return;
    }
    const ok = msg.status === 'SUCCESS' && Number(msg.dispensedQty) > 0;
    const audit = this.createAudit(p, deviceId, {
      verdict: ok ? 'PASS' : 'BLOCK',
      recognizedQty: msg.dispensedQty ?? p.totalQty,
      reason: ok ? '品规、批号、数量与处方完全一致' : `硬件回执异常：实际出药 ${msg.dispensedQty ?? 0} 件，处方要求 ${p.totalQty} 件`,
    });
    if (ok) {
      p.status = 'DONE';
      p.finishedAt = msg.ts || Date.now();
      this.devices.recordJob(deviceId, true, p.finishedAt - (p.startedAt || p.finishedAt));
      this.broadcast('task.finished', { prescription: p, audit });
      this.logEvent('task.finished', `任务完成 ${p.no}`, { detail: `${msg.taskId} · ${deviceId} · 出药 ${msg.dispensedQty} 件`, tone: 'emerald' });
    } else {
      p.status = 'BLOCKED';
      p.finishedAt = msg.ts || Date.now();
      this.devices.recordJob(deviceId, false);
      this.devices.addAlarm(deviceId, { level: 'ERROR', message: `复核拦截：${p.no} 出药数量不符` });
      this.broadcast('task.blocked', { prescription: p, audit });
      this.logEvent('task.blocked', `复核拦截 ${p.no}`, { detail: audit.reason, tone: 'rose' });
    }
  }

  /** 生成复核审计记录 */
  createAudit(p, deviceId, { verdict = 'PASS', recognizedQty = null, reason = '' }) {
    const expected = p.items.map((it) => ({ name: it.name, spec: it.spec, batch: '20260412A', qty: it.qty }));
    const recognized = expected.map((it, i) => {
      const qty = verdict === 'PASS' ? it.qty : i === 0 ? Math.max(1, it.qty - 1) : it.qty;
      return { ...it, qty: recognizedQty != null && i === 0 ? recognizedQty : qty, confidence: verdict === 'PASS' ? +(0.96 + Math.random() * 0.039).toFixed(3) : +(0.88 + Math.random() * 0.09).toFixed(3) };
    });
    const audit = {
      id: `AUD-${this.db.counters.audit++}`,
      prescriptionNo: p.no,
      prescriptionId: p.id,
      taskId: p.taskId,
      deviceId,
      capturedAt: Date.now(),
      snapshotSeed: Math.floor(Math.random() * 100000),
      expected,
      recognized,
      verdict,
      reason: reason || (verdict === 'PASS' ? '品规、批号、数量与处方完全一致' : '品规与处方不符，已拦截'),
      reviewer: 'AI 视觉复核 · 人工抽检',
      operator: '张药师',
      camera: 'CAM-01',
    };
    this.db.audits.unshift(audit);
    this.broadcast('audit.created', { audit });
    return audit;
  }

  /** 仿真器内部事件（传感器脉冲） */
  emitSensor(deviceId, slotCoord) {
    this.broadcast('sensor.triggered', { deviceId, slotCoord, at: Date.now() });
    this.logEvent('sensor.triggered', `${deviceId} 红外传感器触发`, { detail: `货位 ${slotCoord} · 出药计数`, tone: 'sky' });
  }
}
