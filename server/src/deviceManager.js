// deviceManager.js — 硬件设备在线状态管理器
// 维护设备台账：在线状态、IP、RSSI、心跳时间、作业量、运行节奏（节拍/准确率）、告警历史。

const HEARTBEAT_TIMEOUT = 25000; // 超过 25s 未心跳视为离线（真实设备）

export class DeviceManager {
  constructor(db, { broadcast }) {
    this.db = db;
    this.broadcast = broadcast; // (type, payload) => void，由 Hub 注入
    this.byId = new Map(db.devices.map((d) => [d.deviceId, d]));
    // 初始化通道标识：种子虚拟设备 → 'virtual'
    for (const d of this.byId.values()) {
      if (d.channel === undefined) d.channel = d.virtual ? 'virtual' : null;
    }
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  list() {
    return [...this.byId.values()];
  }

  /** 挑选任务下发设备：优先真实在线设备，其次虚拟仿真设备；按今日作业量升序 */
  pickForTask() {
    const online = this.list()
      .filter((d) => d.online)
      .sort((a, b) => (a.todayJobs - b.todayJobs) || (a.virtual - b.virtual));
    return online[0] || null;
  }

  onlineCount() {
    return this.list().filter((d) => d.online).length;
  }

  /** 心跳：更新在线状态 / RSSI / IP / 最后心跳时间 */
  heartbeat(deviceId, { rssi = null, ip = null, quiet = false } = {}) {
    const dev = this.get(deviceId);
    if (!dev) return null;
    const wasOffline = !dev.online;
    dev.online = true;
    if (Number.isFinite(rssi)) dev.rssi = rssi;
    if (ip) dev.ip = ip.replace(/^::ffff:/, '');
    dev.lastSeen = Date.now();
    if (wasOffline) {
      dev.connectedAt = Date.now();
      this.broadcast('device.updated', { device: this.public(dev), change: 'online' });
      this.broadcast('event.logged', { at: Date.now(), kind: 'device.online', title: `${dev.deviceId} 设备上线`, detail: `${dev.name} · ${dev.ip}`, tone: 'emerald' });
    } else if (!quiet) {
      this.broadcast('device.updated', { device: this.public(dev), change: 'heartbeat' });
    }
    return dev;
  }

  /** 绑定真实连接（WebSocket 或 TCP-AT 网关），并登记来源 IP */
  attachConn(deviceId, conn, channel, ip) {
    const dev = this.get(deviceId);
    if (!dev) return;
    dev.conn = conn;
    dev.channel = channel; // 'ws' | 'tcp'
    if (ip) dev.ip = ip.replace(/^::ffff:/, '');
    dev.lastSeen = Date.now();
    this.heartbeat(deviceId, { rssi: dev.rssi, quiet: true });
  }

  detachConn(deviceId) {
    const dev = this.get(deviceId);
    if (!dev) return;
    dev.conn = null;
  }

  addAlarm(deviceId, { level = 'WARN', message }) {
    const dev = this.get(deviceId);
    if (!dev) return;
    dev.alarms.unshift({ at: Date.now(), level, message });
    if (dev.alarms.length > 20) dev.alarms.pop();
    this.broadcast('device.updated', { device: this.public(dev), change: 'alarm' });
  }

  recordJob(deviceId, ok = true, cycleMs = null) {
    const dev = this.get(deviceId);
    if (!dev) return;
    dev.todayJobs += 1;
    dev.totalJobs += 1;
    if (Number.isFinite(cycleMs)) dev.avgCycleMs = Math.round(dev.avgCycleMs * 0.9 + cycleMs * 0.1);
    dev.accuracy = dev.accuracy * 0.95 + (ok ? 0.995 : 0.88) * 0.05;
  }

  /**
   * 周期巡检离线检测：
   *  连接存在（WS/TCP 未断开）→ 保持在线（AT 手动模式心跳间隔长，连接在即为在线，RSSI 由心跳刷新）
   *  连接断开 → 超过心跳宽限期（25s）未重连/未心跳 → 标记离线
   */
  sweep(now = Date.now()) {
    for (const dev of this.list()) {
      if (dev.online && !dev.virtual && !dev.conn && now - dev.lastSeen > HEARTBEAT_TIMEOUT) {
        dev.online = false;
        dev.rssi = null;
        this.broadcast('device.updated', { device: this.public(dev), change: 'offline' });
        this.broadcast('event.logged', { at: now, kind: 'device.offline', title: `${dev.deviceId} 设备离线`, detail: `${dev.name} · 连接断开，心跳超时`, tone: 'rose' });
      }
    }
  }

  /** 启用/停用虚拟仿真（前端虚拟调试面板） */
  setSimulator(deviceId, enabled) {
    const dev = this.get(deviceId);
    if (!dev) return null;
    dev.simEnabled = enabled;
    if (enabled) {
      dev.virtual = true;
      dev.channel = 'virtual';
      dev.online = true;
      dev.lastSeen = Date.now();
      this.broadcast('device.updated', { device: this.public(dev), change: 'sim.on' });
    } else {
      dev.virtual = false;
      if (!dev.conn) {
        dev.online = false;
        dev.rssi = null;
        dev.channel = null;
      }
      this.broadcast('device.updated', { device: this.public(dev), change: 'sim.off' });
    }
    return dev;
  }

  reboot(deviceId) {
    const dev = this.get(deviceId);
    if (!dev) return null;
    dev.online = false;
    dev.rssi = null;
    this.broadcast('device.updated', { device: this.public(dev), change: 'rebooting' });
    this.broadcast('event.logged', { at: Date.now(), kind: 'device.reboot', title: `${dev.deviceId} 重启指令已下发`, detail: '固件重启中…', tone: 'sky' });
    return dev;
  }

  public(dev) {
    const { conn, ...rest } = dev;
    return rest;
  }
}
