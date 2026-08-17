// simulator.js — 虚拟硬件仿真器
// 未接入真实 ESP-01S 时，以"虚拟设备"身份应答：周期心跳保活、模拟出药时序
// （传感器脉冲 → 出药完成/复核拦截）、随机告警。真实设备接入后自动让位。
import { rand, randInt } from './state.js';

export class Simulator {
  constructor({ db, devices, hub }) {
    this.db = db;
    this.devices = devices;
    this.hub = hub;
    this.timer = null;
  }

  start() {
    // 空模板模式：无虚拟仿真设备，不启用心跳循环
    if (!this.db.simEnabled.size) return;
    // 默认启用的虚拟设备上线
    for (const id of this.db.simEnabled) {
      this.devices.heartbeat(id, { rssi: id === 'PMC-001' ? -58 : -66, quiet: true });
    }
    // 接管种子数据中"执行中"的处方：为它们安排仿真完成（重启后队列自动续跑）
    for (const p of this.db.prescriptions) {
      if (p.status === 'DISPENSING' && p.deviceId && this.db.simEnabled.has(p.deviceId)) {
        const dev = this.devices.get(p.deviceId);
        if (dev && dev.virtual) {
          const slots = p.items.map((it) => ({ coord: it.slotCoord, trayIndex: it.trayIndex, qty: it.qty }));
          const elapsed = Math.max(0, Date.now() - (p.startedAt || Date.now()));
          this.scheduleCompletion(p.deviceId, { taskId: p.taskId, slots }, Math.max(1500, 5000 - elapsed));
        }
      }
    }
    this.timer = setInterval(() => this.heartbeatTick(), 15000);
    this.hub.logEvent('simulator', '虚拟仿真器已启动', { detail: '未接入真实设备时由仿真器应答任务', tone: 'sky' });
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  heartbeatTick() {
    for (const id of this.db.simEnabled) {
      const dev = this.devices.get(id);
      if (!dev) continue;
      const drift = randInt(-6, 6);
      this.devices.heartbeat(id, { rssi: (dev.rssi ?? -60) + drift, quiet: true });
    }
  }

  /** 仿真执行一次 DISPENSE_ACTION */
  planDispatch(deviceId, payload) {
    this.scheduleCompletion(deviceId, payload, rand(3200, 5600));
  }

  /** PING 虚拟应答：立即回一次心跳（前端"发送测试指令"用） */
  pong(deviceId) {
    const dev = this.devices.get(deviceId);
    if (!dev) return;
    this.devices.heartbeat(deviceId, { rssi: (dev.rssi ?? -60) + randInt(-4, 4), quiet: true });
    this.hub.logEvent('cmd.pong', `${deviceId} 应答 PING`, { detail: `虚拟通道 · RSSI ${dev.rssi ?? '—'} dBm`, tone: 'emerald' });
  }

  /** 排定一次出药完成时序：传感器脉冲 → 结果判定 */
  scheduleCompletion(deviceId, payload, delay) {
    const dev = this.devices.get(deviceId);
    if (!dev) return;
    const { taskId, slots } = payload;
    const totalQty = slots.reduce((a, s) => a + s.qty, 0);

    // 1) 逐个货位发出传感器脉冲
    slots.forEach((s, i) => {
      setTimeout(() => {
        this.hub.emitSensor(deviceId, s.coord);
      }, 900 + i * 700);
    });

    // 2) 出药完成（含随机复核拦截 / 卡料告警）——作业量与节拍由 onActionFinished 统一记录
    setTimeout(() => {
      const roll = Math.random();
      if (roll < 0.06) {
        // 品规不符 → 复核拦截
        this.hub.handleHardwareMessage(deviceId, { deviceId, type: 'ACTION_FINISHED', taskId, dispensedQty: totalQty, status: 'FAILED' });
        this.hub.broadcast('alarm', { deviceId, level: 'ERROR', message: `复核拦截：${taskId} 品规识别不一致`, at: Date.now() });
      } else if (roll < 0.12) {
        // 数量不符 → 复核拦截
        this.hub.handleHardwareMessage(deviceId, { deviceId, type: 'ACTION_FINISHED', taskId, dispensedQty: Math.max(0, totalQty - 1), status: 'PARTIAL' });
        this.hub.broadcast('alarm', { deviceId, level: 'WARN', message: `复核拦截：${taskId} 出药数量不足`, at: Date.now() });
      } else {
        // 成功（小概率附带一次卡料重试告警）
        if (Math.random() < 0.05) {
          this.devices.addAlarm(deviceId, { level: 'WARN', message: '出药口红外计数超时，已自动重试成功' });
          this.hub.logEvent('alarm', `${deviceId} 卡料重试`, { detail: '自动重试成功，不影响任务', tone: 'amber' });
        }
        this.hub.handleHardwareMessage(deviceId, { deviceId, type: 'ACTION_FINISHED', taskId, dispensedQty: totalQty, status: 'SUCCESS' });
      }
    }, delay);
  }
}
