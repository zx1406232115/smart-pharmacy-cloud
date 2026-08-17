// pages/Ops.jsx — 设备运维：硬件在线监控 + 摄像头管理（扫码/复核/监控）+ 虚拟调试面板
import { useEffect, useRef, useState } from 'react';
import {
  Cpu, Timer, Target, ClipboardCheck, AlertTriangle, Wifi, WifiOff, Radio, Zap,
  Power, Send, TerminalSquare, FlaskConical, Server, Cable,
  Camera, Plus, Trash2, ScanLine, Video, MonitorPlay,
} from 'lucide-react';
import StatCard from '../components/StatCard.jsx';
import Badge from '../components/Badge.jsx';
import SignalBars from '../components/SignalBars.jsx';
import Modal from '../components/Modal.jsx';
import CameraScanWorkbench from '../components/CameraScanWorkbench.jsx';
import { api } from '../lib/api.js';
import { useLiveData } from '../hooks/useUiSocket.js';
import { useAppStore, consoleLine } from '../store/useAppStore.js';
import { timeAgo, fmtTime } from '../lib/format.js';

const CHANNEL_BADGE = {
  tcp: { tone: 'sky', label: 'TCP-AT 网关' },
  ws: { tone: 'indigo', label: 'WebSocket 直连' },
  virtual: { tone: 'amber', label: '虚拟仿真' },
  none: { tone: 'slate', label: '未连接' },
};

const PURPOSE_BADGE = { scan: 'indigo', review: 'amber', monitor: 'sky' };

export default function Ops() {
  const [kpis, setKpis] = useState(null);
  const [devices, setDevices] = useState([]);
  const connected = useAppStore((s) => s.connected);
  const storeDevices = useAppStore((s) => s.devices);
  const events = useAppStore((s) => s.events);
  const consoleTone = useAppStore((s) => s.consoleTone);
  const toast = useAppStore((s) => s.toast);

  useLiveData(async () => {
    const [k, d] = await Promise.all([api.get('/kpis'), api.get('/devices')]);
    setKpis(k); setDevices(d);
  }, []);

  // ---- 摄像头管理 ----
  const [camData, setCamData] = useState({ cameras: [], purposes: [] });
  const [camForm, setCamForm] = useState({ ip: '', port: 81, purpose: 'scan', name: '' });
  const [previewCam, setPreviewCam] = useState(null);   // 监控/复核预览
  const [previewRetry, setPreviewRetry] = useState(0);  // 预览画面重试次数（防 onerror 无限循环）
  const [workbenchCam, setWorkbenchCam] = useState(null); // 扫码工作台

  const refreshCams = async () => setCamData(await api.get('/cameras'));
  useLiveData(refreshCams, []);
  useEffect(() => { const t = setInterval(refreshCams, 5000); return () => clearInterval(t); }, []); // 在线状态轮询

  const addCam = async () => {
    try {
      const r = await api.post('/cameras', camForm);
      toast({ tone: 'emerald', title: '摄像头已接入', desc: `${r.camera.name} · ${r.camera.ip}:${r.camera.port}` });
      setCamForm({ ip: '', port: 81, purpose: 'scan', name: '' });
      refreshCams();
    } catch (e) {
      toast({ tone: 'rose', title: '接入失败', desc: e.message });
    }
  };

  const removeCam = async (c) => {
    try {
      const r = await fetch(`/api/cameras/${c.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).message || '删除失败');
      toast({ tone: 'sky', title: `已移除 ${c.name}` });
      // 若删除的是正在预览/扫码的设备，联动关闭弹窗（避免孤儿连接导致页面异常）
      if (previewCam?.id === c.id) setPreviewCam(null);
      if (workbenchCam?.id === c.id) setWorkbenchCam(null);
      refreshCams();
    } catch (e) {
      toast({ tone: 'rose', title: '移除失败', desc: e.message });
    }
  };

  const setPurpose = async (c, purpose) => {
    try {
      await api.post(`/cameras/${c.id}/purpose`, { purpose });
      refreshCams();
    } catch (e) {
      toast({ tone: 'rose', title: '设置失败', desc: e.message });
    }
  };

  const purposeLabel = (key) => camData.purposes.find((p) => p.key === key)?.label || key;

  // ---- MaixCam Pro 扫码设备状态（HTTP 上报，轮询最近扫码/心跳）----
  const [maixScan, setMaixScan] = useState(null);
  const [maixHeartbeat, setMaixHeartbeat] = useState(null);
  const refreshMaix = async () => {
    try {
      const r = await api.get('/scan/device/last');
      setMaixScan(r?.scan || null);
      setMaixHeartbeat(r?.heartbeat || null);
    } catch { /* 服务重启等 */ }
  };
  useLiveData(refreshMaix, []);
  useEffect(() => { const t = setInterval(refreshMaix, 5000); return () => clearInterval(t); }, []);
  const maixOnline = (!!maixScan && Date.now() - maixScan.at < 15000) || (!!maixHeartbeat && Date.now() - maixHeartbeat.at < 45000);

  // 虚拟调试面板：事件注入表单
  const [inject, setInject] = useState({ deviceId: 'PMC-001', type: 'SENSOR_TRIGGERED', taskId: '', slotCoord: 'A-03', message: '' });
  const [sending, setSending] = useState(false);

  const sendInject = async () => {
    setSending(true);
    try {
      const payload = {};
      if (inject.taskId) payload.taskId = inject.taskId;
      if (inject.slotCoord) payload.slotCoord = inject.slotCoord;
      if (inject.message) payload.message = inject.message;
      await api.post('/debug/simulate', { deviceId: inject.deviceId, type: inject.type, payload });
      toast({ tone: 'sky', title: '事件已注入', desc: `${inject.deviceId} ← ${inject.type}（虚拟硬件应答）` });
    } catch (e) {
      toast({ tone: 'rose', title: '注入失败', desc: e.message });
    } finally {
      setSending(false);
    }
  };

  const toggleSim = async (d) => {
    try {
      await api.post(`/devices/${d.deviceId}/simulator`, { enabled: !d.simEnabled });
      toast({ tone: 'sky', title: `虚拟仿真已${!d.simEnabled ? '开启' : '关闭'}`, desc: `${d.deviceId} · ${!d.simEnabled ? '离线任务将自动应答' : '需接入真实设备或重新开启'}` });
    } catch (e) {
      toast({ tone: 'rose', title: '操作失败', desc: e.message });
    }
  };

  const reboot = async (d) => {
    try {
      const r = await api.post(`/devices/${d.deviceId}/reboot`);
      toast({ tone: 'sky', title: r.message, desc: '约 4 秒后恢复上线' });
    } catch (e) {
      toast({ tone: 'rose', title: '操作失败', desc: e.message });
    }
  };

  // 发送 PING 测试指令（真实设备将回心跳应答，日志可见）
  const [pinging, setPinging] = useState(null);
  const ping = async (d) => {
    setPinging(d.deviceId);
    try {
      const r = await api.post(`/devices/${d.deviceId}/command`, { cmd: 'PING' });
      toast({ tone: 'sky', title: `PING 已发送 → ${d.deviceId}`, desc: r.sent.mode === 'virtual' ? '虚拟通道已应答' : '已进入设备通道，等待心跳回执' });
    } catch (e) {
      toast({ tone: 'rose', title: '发送失败', desc: e.message });
    } finally {
      setPinging(null);
    }
  };

  // 控制台自动滚动
  const consoleRef = useRef(null);
  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = 0;
  }, [events]);

  const merged = Object.values({ ...devices.reduce((m, d) => ({ ...m, [d.deviceId]: d }), {}), ...storeDevices });
  const online = merged.filter((d) => d.online);

  return (
    <div className="space-y-6">
      {/* 通道状态条 */}
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 border-slate-200/70 bg-gradient-to-r from-white to-brand-50/50 p-5">
        <div className="flex items-center gap-2.5">
          <span className="rounded-xl bg-indigo-50 p-2 text-indigo-600"><Server size={16} /></span>
          <div>
            <p className="text-[13px] font-semibold text-slate-800">服务端实时通道</p>
            <p className={`inline-flex items-center gap-1.5 text-xs ${connected ? 'text-emerald-600' : 'text-rose-500'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'animate-pulse-dot bg-emerald-400' : 'bg-rose-400'}`} />
              {connected ? 'WebSocket 已连接 · 事件实时推送' : '重连中…'}
            </p>
          </div>
        </div>
        <div className="h-8 w-px bg-slate-200" />
        <div className="flex items-center gap-2.5">
          <span className="rounded-xl bg-emerald-50 p-2 text-emerald-600"><Radio size={16} /></span>
          <div>
            <p className="text-[13px] font-semibold text-slate-800">硬件通道</p>
            <p className="text-xs text-slate-500">
              <span className="font-semibold text-emerald-600">{online.length}</span> / {merged.length} 在线 · ESP-01S ↔ /ws/hardware
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {merged.map((d) => (
            <span key={d.deviceId} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${d.online ? 'border-emerald-100 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${d.online ? 'animate-pulse-dot bg-emerald-400' : 'bg-slate-300'}`} />
              {d.deviceId}
              {d.virtual && <FlaskConical size={10} className="text-indigo-400" />}
            </span>
          ))}
          {!merged.length && <span className="text-xs text-slate-300">暂无设备</span>}
        </div>
      </div>

      {/* MaixCam Pro 扫码设备 */}
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-3 border-slate-200/70 p-5">
        <div className="flex items-center gap-3">
          <span className={`rounded-xl p-2 ${maixOnline ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
            <ScanLine size={16} />
          </span>
          <div>
            <p className="text-[13.5px] font-bold tracking-tight text-slate-900">
              MaixCam Pro 扫码设备
              <Badge tone={maixOnline ? 'emerald' : 'slate'} dot className="ml-2">{maixOnline ? '在线' : '等待上报'}</Badge>
            </p>
            <p className="text-xs text-slate-400">HTTP 上报 → 储药流程自动带入 · 15 秒内上报视为在线</p>
          </div>
        </div>
        <div className="h-8 w-px bg-slate-200" />
        <div className="flex items-center gap-5 text-xs">
          <div>
            <p className="text-slate-400">最近识别</p>
            <p className="mt-0.5 font-mono text-[13px] font-bold text-slate-800">{maixScan?.barcode || '—'}</p>
          </div>
          <div>
            <p className="text-slate-400">建档状态</p>
            {maixScan ? (
              maixScan.found
                ? <p className="mt-0.5 font-semibold text-emerald-600">已建档 · {maixScan.drugName}</p>
                : <p className="mt-0.5 font-semibold text-amber-600">未建档</p>
            ) : (
              <p className="mt-0.5 text-slate-400">—</p>
            )}
          </div>
          <div>
            <p className="text-slate-400">上报时间</p>
            <p className="mt-0.5 font-medium text-slate-700">{maixScan?.at ? timeAgo(maixScan.at) : '—'}</p>
          </div>
        </div>
      </div>

      {/* 运行节奏指标 */}
      <div className="grid grid-cols-2 gap-6 xl:grid-cols-4">
        <StatCard label="平均节拍" value={kpis ? (kpis.avgCycle / 1000).toFixed(1) : '—'} unit="秒/单" caption="近 100 单滚动均值" tone="indigo" icon={Timer} />
        <StatCard label="连续运行准确率" value={kpis ? (kpis.accuracy * 100).toFixed(1) : '—'} unit="%" caption="含自动重试成功" tone="emerald" icon={Target} />
        <StatCard label="今日作业单量" value={kpis ? kpis.todayJobs : '—'} unit="单" caption="全设备合计" tone="sky" icon={ClipboardCheck} />
        <StatCard label="今日硬件告警" value={kpis ? kpis.alarmsToday : '—'} unit="次" caption="已自动记录归档" tone="rose" icon={AlertTriangle} />
      </div>

      {/* 设备卡片 */}
      {merged.length ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {merged.map((d) => (
          <div key={d.deviceId} className="card card-hover flex flex-col p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${d.online ? 'bg-brand-50 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                  <Cpu size={18} />
                </div>
                <div>
                  <p className="flex items-center gap-2 text-[14px] font-bold tracking-tight text-slate-900">
                    {d.deviceId}
                    {d.virtual && <span title="虚拟仿真设备"><FlaskConical size={12} className="text-indigo-400" /></span>}
                  </p>
                  <p className="text-[11px] text-slate-400">{d.name} · {d.model}</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <Badge tone={d.online ? 'emerald' : 'rose'} dot>{d.online ? '在线' : '离线'}</Badge>
                <Badge tone={CHANNEL_BADGE[d.channel || 'none'].tone}>
                  <Cable size={10} /> {CHANNEL_BADGE[d.channel || 'none'].label}
                </Badge>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-slate-50/70 p-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">IP 地址</span>
                <span className="font-mono font-medium text-slate-700">{d.ip || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">信号强度</span>
                <SignalBars rssi={d.rssi} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">固件版本</span>
                <span className="font-mono font-medium text-slate-700">{d.firmware || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">最后心跳</span>
                <span className="font-medium text-slate-700">{d.lastSeen ? timeAgo(d.lastSeen) : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">今日作业</span>
                <span className="font-bold tabular-nums text-indigo-600">{d.todayJobs} 单</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">累计作业</span>
                <span className="tabular-nums font-medium text-slate-700">{d.totalJobs.toLocaleString()} 单</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">平均节拍</span>
                <span className="tabular-nums font-medium text-slate-700">{(d.avgCycleMs / 1000).toFixed(1)} s</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">准确率</span>
                <span className={`tabular-nums font-bold ${d.accuracy >= 0.99 ? 'text-emerald-600' : 'text-amber-600'}`}>{(d.accuracy * 100).toFixed(1)}%</span>
              </div>
            </div>

            {/* 告警历史 */}
            <div className="mt-4 flex-1">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <AlertTriangle size={11} /> 硬件告警历史
              </p>
              <div className="max-h-24 space-y-1.5 overflow-y-auto pr-1">
                {d.alarms.length ? d.alarms.slice(0, 4).map((a, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-1.5">
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${a.level === 'ERROR' ? 'bg-rose-400' : a.level === 'WARN' ? 'bg-amber-400' : 'bg-sky-400'}`} />
                    <div className="min-w-0">
                      <p className="truncate text-[11px] text-slate-600">{a.message}</p>
                      <p className="text-[10px] text-slate-300">{timeAgo(a.at)} · {a.level}</p>
                    </div>
                  </div>
                )) : (
                  <p className="rounded-lg border border-dashed border-slate-200 px-2.5 py-2 text-center text-[11px] text-slate-300">无告警记录</p>
                )}
              </div>
            </div>

            {/* 操作 */}
            <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
              <button className="btn-outline flex-1 !py-1.5 text-xs" onClick={() => ping(d)} disabled={pinging === d.deviceId}>
                <Send size={12} /> {pinging === d.deviceId ? '发送中…' : 'PING 测试'}
              </button>
              <button className="btn-outline flex-1 !py-1.5 text-xs" onClick={() => reboot(d)}>
                <Power size={12} /> 重启
              </button>
              <button
                className={`flex-1 !py-1.5 text-xs ${d.simEnabled ? 'btn-soft' : 'btn-outline'}`}
                onClick={() => toggleSim(d)}
              >
                <Zap size={12} /> 仿真 {d.simEnabled ? '开' : '关'}
              </button>
            </div>
          </div>
          ))}
        </div>
      ) : (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <Cpu size={26} className="text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-500">暂无设备</p>
          <p className="mt-1 text-xs text-slate-400">ESP-01S 接入后自动注册，实时显示在线状态、IP 与信号强度</p>
        </div>
      )}

      {/* 摄像头管理（ESP32-CAM：用户提供 IP，:81/stream 视频流） */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="rounded-xl bg-slate-900 p-2 text-sky-400"><Camera size={16} /></span>
            <div>
              <h3 className="text-[15px] font-bold tracking-tight text-slate-900">摄像头管理</h3>
              <p className="text-xs text-slate-400">用户提供摄像头 IP（<span className="font-mono">ip:81/stream</span>），选择用途：扫码 / 出药口复核 / 整机监控</p>
            </div>
          </div>
          <Badge tone={camData.cameras.length ? 'emerald' : 'slate'} dot>
            {camData.cameras.length} 路 · {camData.cameras.filter((c) => c.online).length} 在线
          </Badge>
        </div>

        {/* 接入表单 */}
        <div className="grid grid-cols-2 gap-3 border-b border-slate-100 bg-slate-50/50 px-6 py-4 lg:grid-cols-5">
          <div>
            <label className="label">摄像头 IP <span className="text-rose-400">*</span></label>
            <input className="input font-mono" placeholder="192.168.0.50" value={camForm.ip} onChange={(e) => setCamForm((f) => ({ ...f, ip: e.target.value }))} />
          </div>
          <div>
            <label className="label">端口</label>
            <input type="number" className="input" value={camForm.port} onChange={(e) => setCamForm((f) => ({ ...f, port: Number(e.target.value) || 81 }))} />
          </div>
          <div>
            <label className="label">用途 <span className="text-rose-400">*</span></label>
            <select className="select" value={camForm.purpose} onChange={(e) => setCamForm((f) => ({ ...f, purpose: e.target.value }))}>
              {camData.purposes.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">名称（可选）</label>
            <input className="input" placeholder="如：扫码摄像头" value={camForm.name} onChange={(e) => setCamForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full" onClick={addCam} disabled={!camForm.ip.trim()}>
              <Plus size={14} /> 接入摄像头
            </button>
          </div>
        </div>

        {/* 摄像头列表 */}
        <div className="p-6">
          {camData.cameras.length ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {camData.cameras.map((c) => (
                <div key={c.id} className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-soft transition-all hover:shadow-soft-lg">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${c.online ? 'bg-sky-50 text-sky-600' : 'bg-slate-100 text-slate-400'}`}>
                        <Camera size={16} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-bold text-slate-900">{c.name}</p>
                        <p className="font-mono text-[11px] text-slate-400">{c.ip}:{c.port}/stream</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {/* 刚添加且尚未收到帧 → 连接中；收到过帧后按在线/离线判定 */}
                      <Badge
                        tone={c.online ? 'emerald' : !c.lastFrameAt && Date.now() - (c.createdAt || 0) < 15000 ? 'sky' : 'rose'}
                        dot
                      >
                        {c.online ? '在线' : !c.lastFrameAt && Date.now() - (c.createdAt || 0) < 15000 ? '连接中' : '离线'}
                      </Badge>
                      <Badge tone={PURPOSE_BADGE[c.purpose]}>{purposeLabel(c.purpose)}</Badge>
                    </div>
                  </div>

                  <p className="mt-3 text-[10.5px] text-slate-400">
                    最近画面 {c.lastFrameAt ? timeAgo(c.lastFrameAt) : '无'}
                  </p>

                  {/* 用途切换 */}
                  <select
                    className="select mt-2 !py-1.5 text-xs"
                    value={c.purpose}
                    onChange={(e) => setPurpose(c, e.target.value)}
                  >
                    {camData.purposes.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>

                  <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                    <button className="btn-outline flex-1 !py-1.5 text-xs" onClick={() => { setPreviewCam(c); setPreviewRetry(0); }}>
                      <MonitorPlay size={12} /> 查看视频
                    </button>
                    {c.purpose === 'scan' && (
                      <button className="btn-primary flex-1 !py-1.5 text-xs" onClick={() => setWorkbenchCam(c)}>
                        <ScanLine size={12} /> 扫码储药
                      </button>
                    )}
                    <button className="btn-ghost !px-2 !py-1.5 text-xs !text-rose-500" onClick={() => removeCam(c)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-12 text-center">
              <Camera size={26} className="text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-500">尚未接入摄像头</p>
              <p className="mt-1 text-xs text-slate-400">填写上方 IP（如 192.168.0.50）并选择用途即可接入，视频流将实时代理到本页面</p>
            </div>
          )}
        </div>
      </div>

      {/* 监控/复核预览弹窗 */}
      <Modal
        open={!!previewCam}
        onClose={() => { setPreviewCam(null); setPreviewRetry(0); }}
        title={previewCam ? `${previewCam.name} · 实时画面` : ''}
        subtitle={previewCam ? `${previewCam.ip}:${previewCam.port}/stream · ${purposeLabel(previewCam.purpose)}` : ''}
        width="max-w-2xl"
      >
        {previewCam && (
          <div>
            {previewRetry < 3 ? (
              <img
                key={previewRetry}
                src={`/api/cameras/${previewCam.id}/stream`}
                alt="实时画面"
                className="w-full rounded-xl border border-slate-200 bg-slate-950 object-contain"
                onError={() => setPreviewRetry((r) => r + 1)}
              />
            ) : (
              <div className="flex h-64 w-full flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-center">
                <WifiOff size={24} className="text-slate-300" />
                <p className="mt-2 text-sm font-medium text-slate-500">画面中断</p>
                <p className="mt-1 text-xs text-slate-400">摄像头无响应，请检查设备后重新打开</p>
              </div>
            )}
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
              <Video size={12} />
              {previewCam.purpose === 'review'
                ? '出药口复核用途：后续将在此叠加 AI 抓拍与品规对照（当前仅实时画面）'
                : '实时监控画面，由服务端代理转发（解决跨域）'}
            </p>
          </div>
        )}
      </Modal>

      {/* 扫码工作台弹窗 */}
      <Modal
        open={!!workbenchCam}
        onClose={() => { setWorkbenchCam(null); }}
        title={workbenchCam ? `扫码工作台 · ${workbenchCam.name}` : ''}
        subtitle="从视频流识别条形码 → 自动接入扫码储药（查库 / 建档 / 确认储药）"
        width="max-w-4xl"
      >
        {workbenchCam && (
          <CameraScanWorkbench
            cam={workbenchCam}
            onClose={() => setWorkbenchCam(null)}
            onStored={() => { refreshCams(); }}
          />
        )}
      </Modal>

      {/* 虚拟调试面板 */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="rounded-xl bg-slate-900 p-2 text-emerald-400"><TerminalSquare size={16} /></span>
            <div>
              <h3 className="text-[15px] font-bold tracking-tight text-slate-900">硬件连接监控 · 虚拟调试面板</h3>
              <p className="text-xs text-slate-400">模拟硬件应答，联调 DISPENSE_ACTION 全链路；真实 ESP-01S 接入后自动切换为真实通道</p>
            </div>
          </div>
          <Badge tone={connected ? 'emerald' : 'rose'} dot>{connected ? '实时通道正常' : '通道断开'}</Badge>
        </div>

        <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2">
          {/* 左：事件日志控制台 */}
          <div>
            <p className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              实时事件日志
              <span className="inline-flex items-center gap-1 font-normal normal-case tracking-normal text-slate-300">
                <Wifi size={11} className={connected ? 'text-emerald-400' : 'text-rose-400'} />
                {connected ? 'LIVE' : 'OFFLINE'}
              </span>
            </p>
            <div ref={consoleRef} className="h-72 overflow-y-auto rounded-xl bg-slate-950 p-4 font-mono text-[11px] leading-relaxed shadow-inner">
              {events.map((ev) => (
                <p key={ev.id} className={`whitespace-nowrap ${consoleTone(ev.tone)}`}>
                  <span className="text-slate-600">{fmtTime(ev.at || ev._ts)}</span>{' '}
                  <span className="text-slate-500">[{ev.kind}]</span>{' '}
                  {ev.title}
                  {ev.detail ? <span className="text-slate-500"> · {ev.detail}</span> : null}
                </p>
              ))}
              {!events.length && <p className="text-slate-600">等待事件…</p>}
            </div>
          </div>

          {/* 右：事件注入 */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">模拟硬件应答 · 事件注入</p>
            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">目标设备（未注册时自动创建）</label>
                  <input className="input font-mono" value={inject.deviceId} onChange={(e) => setInject((s) => ({ ...s, deviceId: e.target.value }))} placeholder="PMC-001" />
                </div>
                <div>
                  <label className="label">事件类型</label>
                  <select className="select" value={inject.type} onChange={(e) => setInject((s) => ({ ...s, type: e.target.value }))}>
                    <option value="HEARTBEAT">HEARTBEAT 心跳</option>
                    <option value="SENSOR_TRIGGERED">SENSOR_TRIGGERED 出药计数</option>
                    <option value="ACTION_FINISHED">ACTION_FINISHED 出药完成</option>
                    <option value="ALARM">ALARM 硬件告警</option>
                  </select>
                </div>
                <div>
                  <label className="label">任务号 taskId（可选）</label>
                  <input className="input" value={inject.taskId} onChange={(e) => setInject((s) => ({ ...s, taskId: e.target.value }))} placeholder="TASK-…" />
                </div>
                <div>
                  <label className="label">货位 slotCoord（可选）</label>
                  <input className="input" value={inject.slotCoord} onChange={(e) => setInject((s) => ({ ...s, slotCoord: e.target.value }))} placeholder="A-03" />
                </div>
                <div className="col-span-2">
                  <label className="label">告警内容 message（ALARM 时必填）</label>
                  <input className="input" value={inject.message} onChange={(e) => setInject((s) => ({ ...s, message: e.target.value }))} placeholder="如：出药口红外计数超时" />
                </div>
              </div>
              <button className="btn-primary mt-4 w-full" onClick={sendInject} disabled={sending}>
                <Send size={14} /> {sending ? '注入中…' : '注入事件（模拟硬件应答）'}
              </button>
              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
                <WifiOff size={12} className="mt-0.5 shrink-0" />
                提示：注入事件由服务端仿真通道应答并广播全端，与真实 ESP-01S 上报走同一处理链路。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
