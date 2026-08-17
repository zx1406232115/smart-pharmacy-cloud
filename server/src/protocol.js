// protocol.js — ESP-01S 硬件 JSON 通信协议
// 下 行（Server -> ESP-01S）：
//   { "cmd": "DISPENSE_ACTION", "taskId": "TASK-20260730-001",
//     "slots": [ { "coord": "A-03", "trayIndex": 1, "qty": 1 } ], "ts": 1789... }
// 上 行（ESP-01S -> Server）：
//   { "deviceId": "PMC-001", "type": "HEARTBEAT" | "ACTION_FINISHED" | "SENSOR_TRIGGERED" | "ALARM",
//     "taskId": "...", "slotCoord": "A-03", "dispensedQty": 1, "status": "SUCCESS",
//     "rssi": -58, "message": "...", "level": "WARN", "ts": 1789... }

export const HW_EVENT_TYPES = ['HEARTBEAT', 'ACTION_FINISHED', 'SENSOR_TRIGGERED', 'ALARM'];

export function buildDispatch(taskId, slots) {
  return {
    cmd: 'DISPENSE_ACTION',
    taskId,
    slots: slots.map((s) => ({ coord: s.coord, trayIndex: s.trayIndex, qty: s.qty })),
    ts: Date.now(),
  };
}

export function buildPing() {
  return { cmd: 'PING', ts: Date.now() };
}

/** 解析上行报文，返回规范化消息；非法输入返回 null */
export function normalizeHardwareMessage(raw) {
  let msg;
  try {
    msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  if (!msg.deviceId || !HW_EVENT_TYPES.includes(msg.type)) return null;
  return {
    deviceId: String(msg.deviceId).trim(),
    type: msg.type,
    taskId: msg.taskId ? String(msg.taskId) : null,
    slotCoord: msg.slotCoord ? String(msg.slotCoord) : null,
    dispensedQty: Number.isFinite(msg.dispensedQty) ? msg.dispensedQty : null,
    status: msg.status ? String(msg.status) : null,
    rssi: Number.isFinite(msg.rssi) ? msg.rssi : null,
    message: msg.message ? String(msg.message) : null,
    level: msg.level ? String(msg.level) : null,
    ts: msg.ts || Date.now(),
  };
}
