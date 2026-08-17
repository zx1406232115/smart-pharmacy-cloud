// state.js — 内存数据仓库（空模板模式）
// 不内置任何假数据：处方、库存、审计、设备台账均为空，
// 货位保持 3×3 物理结构（A1~C3，按尺寸分层），等待真实业务数据与真实设备接入。
import { pinyinCode } from './pinyin.js';

export { pinyinCode } from './pinyin.js';

export const pad2 = (n) => String(n).padStart(2, '0');
export const pad3 = (n) => String(n).padStart(3, '0');
export const pad4 = (n) => String(n).padStart(4, '0');

export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function daysUntil(iso) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso) - start) / 86400000);
}
/** [min,max) 随机数 / 整数（仅供虚拟调试面板与仿真器等调试设施使用） */
export const rand = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(rand(min, max + 1));

/** 按机械路径（trayIndex）重排货位 */
export const snakeSort = (slots) => [...slots].sort((a, b) => (a.trayIndex - b.trayIndex));
export function coordsToRoute(coords) {
  return coords.map((c, i) => `${i > 0 ? ' → ' : ''}${c}`).join('');
}

// ---------------- 货位模板：3 层 × 3 列（A1 ~ C3，共 9 格，全部空闲）----------------
// 货位按物理尺寸分层：A 层 = 大格（90~120mm）、B 层 = 中格（50~90mm）、C 层 = 小格（10~50mm）
// 建档药品按形状/尺寸匹配格位，机器储药时放入对应货位。
const LAYERS = 3;   // 层数（A、B、C）
const COLS = 3;     // 每层列数
export const SLOT_LAYERS = LAYERS;
export const SLOT_COLS = COLS;

/** 层 → 格位尺寸 */
export const SLOT_SIZE_BY_LAYER = { 1: 'large', 2: 'medium', 3: 'small' };

function buildSlots() {
  const slots = [];
  const layerLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
  for (let layer = 1; layer <= LAYERS; layer++) {
    for (let col = 1; col <= COLS; col++) {
      const trayIndex = (layer - 1) * COLS + col; // 1..9 机械路径序号（蛇形）
      slots.push({
        coord: `${layerLetters[layer - 1]}-${pad2(col)}`,
        layer,
        col,
        trayIndex,
        size: SLOT_SIZE_BY_LAYER[layer], // large / medium / small
        status: 'FREE',
        drugId: null,
        drugName: null,
        spec: null,
        batchNo: null,
        qty: 0,
        expDate: null,
        updatedAt: null,
      });
    }
  }
  return slots;
}

// ---------------- 药品档案：条码（EAN-13）+ 形状 + 尺寸 ----------------
// 形状：box 盒装 / bottle 瓶装
// 尺寸：large 大(90~120mm) / medium 中(50~90mm) / small 小(10~50mm)
export const SHAPES = ['box', 'bottle'];
export const SIZES = ['large', 'medium', 'small'];
export const SIZE_LABEL = { large: '大 (90~120mm)', medium: '中 (50~90mm)', small: '小 (10~50mm)' };
export const SHAPE_LABEL = { box: '盒装', bottle: '瓶装' };

// ---------------- 总入口：空模板 ----------------
export function createDb() {
  return {
    today: todayStr(),
    drugs: [],            // 药品档案（扫码建档，含 barcode/shape/size）
    slots: buildSlots(),  // 9 个空闲货位（物理结构，非数据）
    inventory: [],        // 入库记录
    prescriptions: [],    // 处方队列
    audits: [],           // 复核审计留档
    devices: [],          // 设备台账（真实设备接入时自动注册）
    cameras: [],          // 摄像头（ESP32-CAM，用户提供 IP，用途：扫码/复核/监控）
    maixScan: null,       // MaixCam Pro 扫码设备最近一次上报 { barcode, device, found, drugName, at }
    maixHeartbeat: null,  // MaixCam Pro 心跳 { device, at }
    dispenseByHour: Array.from({ length: 11 }, (_, i) => ({ hour: i + 8, count: 0 })), // 08:00~18:00 空模板
    counters: { task: 1, audit: 1, inventory: 1, drug: 1, camera: 1 },
    kpiTrends: null,      // 无历史数据，不展示环比
    simEnabled: new Set(), // 无虚拟仿真设备
  };
}

export const nextId = (db, prefix) => {
  const n = db.counters[prefix] + 1;
  db.counters[prefix] = n;
  return `${prefix}-${pad3(n)}`;
};
