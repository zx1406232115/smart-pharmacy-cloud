// store/useAppStore.js — 全局实时状态（Zustand）
// 维护：前端↔服务端 WS 连接、设备台账、事件控制台、轻提示、数据刷新信号。
import { create } from 'zustand';
import { fmtTime } from '../lib/format.js';

let socket = null;
let retryTimer = null;

const EVENT_TONE = { emerald: 'text-emerald-400', sky: 'text-sky-400', amber: 'text-amber-400', rose: 'text-rose-400', indigo: 'text-indigo-400', slate: 'text-slate-400' };

function connect(store) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws/ui`);
  socket.onopen = () => store.setState({ connected: true });
  socket.onclose = () => {
    store.setState({ connected: false });
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => connect(store), 3000);
  };
  socket.onerror = () => socket && socket.close();
  socket.onmessage = (e) => {
    try {
      store.getState().applyEvent(JSON.parse(e.data));
    } catch { /* 忽略坏帧 */ }
  };
}

export const useAppStore = create((set, get) => ({
  connected: false,
  devices: {},
  simulator: [],
  events: [],
  toasts: [],
  tick: 0,
  lastScan: null, // MaixCam Pro 扫码设备最近识别 { barcode, source, found, drugName, at }

  initSocket() {
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
    connect({ setState: set, getState: get });
  },

  bump: () => set((s) => ({ tick: s.tick + 1 })),

  toast(toast) {
    const id = `T-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, ...toast }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4600);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  applyEvent(ev) {
    const st = get();
    switch (ev.type) {
      case 'hello': {
        const devices = {};
        ev.devices.forEach((d) => { devices[d.deviceId] = d; });
        set({ devices, simulator: ev.simulator || [] });
        break;
      }
      case 'history':
        set((s) => ({ events: [...ev.events, ...s.events].slice(0, 60) }));
        break;
      case 'event.logged':
        set((s) => ({ events: [{ ...ev, at: ev.at || ev._ts }, ...s.events].slice(0, 60) }));
        break;
      case 'device.updated':
        set((s) => ({ devices: { ...s.devices, [ev.device.deviceId]: ev.device } }));
        if (ev.change === 'offline' && ev.device.virtual === false) {
          st.toast({ tone: 'rose', title: `${ev.device.deviceId} 设备离线`, desc: `${ev.device.name} · 心跳超时` });
        }
        break;
      case 'task.dispatched':
        set((s) => ({ tick: s.tick + 1 }));
        st.toast({ tone: 'indigo', title: `任务已下发 ${ev.prescription.taskId}`, desc: `${ev.prescription.no} · ${ev.prescription.deviceId}` });
        break;
      case 'task.finished':
        set((s) => ({ tick: s.tick + 1 }));
        st.toast({ tone: 'emerald', title: `出药完成 ${ev.prescription.no}`, desc: `出药 ${ev.prescription.totalQty} 件 · 复核一致` });
        break;
      case 'task.blocked':
        set((s) => ({ tick: s.tick + 1 }));
        st.toast({ tone: 'rose', title: `复核拦截 ${ev.prescription.no}`, desc: ev.audit?.reason || '品规与处方不符' });
        break;
      case 'audit.created':
      case 'inbound':
      case 'outbound':
      case 'sensor.triggered':
        set((s) => ({ tick: s.tick + 1 }));
        break;
      case 'scan.received': {
        set((s) => ({
          tick: s.tick + 1,
          lastScan: { barcode: ev.barcode, source: ev.source || 'maixcam', found: ev.found, drugName: ev.drugName, at: ev.at || ev._ts },
        }));
        st.toast({
          tone: ev.found ? 'emerald' : 'amber',
          title: `${ev.source || 'MaixCam'} 识别条码 ${ev.barcode}`,
          desc: ev.found ? `已建档：${ev.drugName} → 储药流程已带入` : '未建档 · 请在储药流程中补全建档',
        });
        break;
      }
      case 'alarm':
        st.toast({ tone: 'rose', title: `${ev.deviceId} 硬件告警`, desc: ev.message });
        break;
      default:
        break;
    }
  },

  consoleTone: (tone) => EVENT_TONE[tone] || EVENT_TONE.slate,
}));

// 供非组件代码取用
export const consoleLine = (ev) => {
  const tone = EVENT_TONE[ev.tone] || EVENT_TONE.slate;
  return `${fmtTime(ev.at || ev._ts)}  ${tone}  ${ev.title}${ev.detail ? '  ·  ' + ev.detail : ''}`;
};
