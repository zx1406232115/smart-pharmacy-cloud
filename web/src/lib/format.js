// format.js — 格式化与语义映射工具
export const pad2 = (n) => String(n).padStart(2, '0');

export function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
export function fmtDateTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
export function fmtFullDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
export function timeAgo(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}
export function fmtDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  return `${m} 分 ${s % 60} 秒`;
}

// ---- 处方状态 ----
export const PRESCRIPTION_LABEL = { DONE: '已完成', QUEUED: '待执行', DISPENSING: '执行中', BLOCKED: '已拦截' };
export const PRESCRIPTION_TONE = { DONE: 'emerald', QUEUED: 'sky', DISPENSING: 'sky', BLOCKED: 'rose' };

// ---- 效期 ----
export function expInfo(daysLeft) {
  if (daysLeft < 0) return { label: '已过期', tone: 'rose' };
  if (daysLeft < 90) return { label: `临期 · 剩 ${daysLeft} 天`, tone: 'amber' };
  return { label: `效期正常 · 剩 ${daysLeft} 天`, tone: 'emerald' };
}

// ---- 信号强度 ----
export function rssiInfo(rssi) {
  if (rssi == null) return { bars: 0, label: '无信号', tone: 'slate' };
  if (rssi >= -60) return { bars: 3, label: '信号强', tone: 'emerald' };
  if (rssi >= -75) return { bars: 2, label: '信号良', tone: 'sky' };
  if (rssi >= -88) return { bars: 1, label: '信号弱', tone: 'amber' };
  return { bars: 1, label: '信号差', tone: 'rose' };
}

// ---- 审计 ----
export const AUDIT_LABEL = { PASS: '一致 · 通过', BLOCK: '拦截 · 品规不符' };
export const AUDIT_TONE = { PASS: 'emerald', BLOCK: 'rose' };

// ---- 药品档案：形状 / 尺寸 ----
export const SHAPE_LABEL = { box: '盒装', bottle: '瓶装' };
export const SIZE_LABEL = { large: '大 (90~120mm)', medium: '中 (50~90mm)', small: '小 (10~50mm)' };
export const SIZE_SHORT = { large: '大', medium: '中', small: '小' };
