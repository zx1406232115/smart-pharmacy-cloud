// pages/Dashboard.jsx — 总览：KPI 指标栏 + 出药趋势 + 货位占用 + 设备/复核/预警动态
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList, CheckCircle2, Clock3, ShieldAlert, ArrowRight, Timer, Target,
} from 'lucide-react';
import StatCard from '../components/StatCard.jsx';
import Badge from '../components/Badge.jsx';
import SlotMatrix from '../components/SlotMatrix.jsx';
import SignalBars from '../components/SignalBars.jsx';
import { api } from '../lib/api.js';
import { useLiveData } from '../hooks/useUiSocket.js';
import { useAppStore } from '../store/useAppStore.js';
import { snapshotDataUri } from '../lib/snapshotSvg.js';
import { fmtDateTime, timeAgo, AUDIT_LABEL, AUDIT_TONE } from '../lib/format.js';

export default function Dashboard() {
  const [kpis, setKpis] = useState(null);
  const [slots, setSlots] = useState([]);
  const [audits, setAudits] = useState([]);
  const [alerts, setAlerts] = useState({ expiring: [], lowStock: [] });
  const storeDevices = useAppStore((s) => s.devices);
  const devices = Object.values(storeDevices);

  useLiveData(async () => {
    const [k, s, a, al] = await Promise.all([
      api.get('/kpis'), api.get('/slots'), api.get('/audits'), api.get('/inventory/alerts'),
    ]);
    setKpis(k); setSlots(s); setAudits(a.slice(0, 5)); setAlerts(al);
  }, []);

  if (!kpis) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-6 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="card h-32 animate-pulse" />)}
        </div>
        <div className="grid grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => <div key={i} className="card h-64 animate-pulse" />)}
        </div>
      </div>
    );
  }

  const occupied = slots.filter((s) => s.status !== 'FREE');
  const maxHour = Math.max(...kpis.dispenseByHour.map((h) => h.count), 1);
  const peak = kpis.dispenseByHour.reduce((a, b) => (b.count > a.count ? b : a));
  const hasDispense = kpis.dispenseByHour.some((h) => h.count > 0);
  const t = kpis.trends || {};

  return (
    <div className="space-y-6">
      {/* ① 顶部全局指标栏 */}
      <div className="grid grid-cols-2 gap-6 xl:grid-cols-4">
        <StatCard label="今日处方" value={kpis.total} unit="单" delta={t.total?.delta} deltaUp={t.total?.up} caption="较昨日同期" tone="indigo" icon={ClipboardList} />
        <StatCard label="已完成" value={kpis.done} unit="单" delta={t.done?.delta} deltaUp={t.done?.up} caption={`累计出药 ${kpis.dispensedQty} 件`} tone="emerald" icon={CheckCircle2} />
        <StatCard label="队列待执行" value={kpis.queued} unit="单" delta={t.queued?.delta} deltaUp={t.queued?.up} caption={`执行中 ${kpis.running} 单`} tone="amber" icon={Clock3} />
        <StatCard label="复核拦截" value={kpis.blocked} unit="次" delta={t.blocked?.delta} deltaUp={t.blocked?.up} caption="已触发人工复核" tone="rose" icon={ShieldAlert} />
      </div>

      {/* ② 出药趋势 + 货位占用 */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="card p-6 xl:col-span-2">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <h3 className="text-[15px] font-bold tracking-tight text-slate-900">今日出药趋势</h3>
              <p className="mt-0.5 text-xs text-slate-400">按时段分布 · 服务端实时汇总</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5"><Timer size={13} className="text-indigo-500" /> 平均节拍 {(kpis.avgCycle / 1000).toFixed(1)}s</span>
              <span className="inline-flex items-center gap-1.5"><Target size={13} className="text-emerald-500" /> 准确率 {(kpis.accuracy * 100).toFixed(1)}%</span>
            </div>
          </div>
          {hasDispense ? (
            <div className="flex h-44 items-end gap-2.5 px-1">
              {kpis.dispenseByHour.map((h) => (
                <div key={h.hour} className="group relative flex flex-1 flex-col items-center justify-end gap-1.5">
                  <div className="pointer-events-none absolute -top-9 z-20 hidden whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-medium text-white group-hover:block">
                    {h.hour}:00 时段 · {h.count} 单
                  </div>
                  <div
                    className={`w-full rounded-t-lg transition-all duration-300 group-hover:opacity-90 ${
                      h.count === peak.count
                        ? 'bg-gradient-to-t from-indigo-600 to-violet-400 shadow-float'
                        : 'bg-gradient-to-t from-indigo-200 to-indigo-300/80'
                    }`}
                    style={{ height: `${Math.max(4, (h.count / maxHour) * 100)}%` }}
                  />
                  <span className={`text-[10px] tabular-nums ${h.count === peak.count ? 'font-bold text-indigo-600' : 'text-slate-400'}`}>{h.hour}:00</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40">
              <p className="text-xs text-slate-400">暂无出药数据</p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-400">
            <span>峰值时段 <span className="font-semibold text-slate-700">{peak.hour}:00 · {peak.count} 单</span></span>
            <span>货位占用率 <span className="font-semibold text-slate-700">{kpis.occupancy}%</span></span>
            <span>效期预警 <span className="font-semibold text-amber-600">{kpis.expiring} 格</span></span>
            <span>低库存 <span className="font-semibold text-rose-500">{kpis.lowStock} 格</span></span>
          </div>
        </div>

        <div className="card p-6">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-[15px] font-bold tracking-tight text-slate-900">货位占用概览</h3>
              <p className="mt-0.5 text-xs text-slate-400">3 层 × 3 列 · A1 ~ C3</p>
            </div>
            <Link to="/slots" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
              查看看板 <ArrowRight size={12} />
            </Link>
          </div>
          <SlotMatrix slots={slots} compact />
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <Badge tone="indigo">已占用 {occupied.filter((s) => s.status === 'OCCUPIED').length}</Badge>
            <Badge tone="amber">效期预警 {occupied.filter((s) => s.status === 'WARNING').length}</Badge>
            <Badge tone="slate">空闲 {slots.length - occupied.length}</Badge>
          </div>
        </div>
      </div>

      {/* ③ 设备 / 复核 / 预警三联动 */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* 设备实时状态 */}
        <div className="card p-6">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-[15px] font-bold tracking-tight text-slate-900">设备实时状态</h3>
              <p className="mt-0.5 text-xs text-slate-400">WebSocket 心跳实时刷新</p>
            </div>
            <Link to="/ops" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
              设备运维 <ArrowRight size={12} />
            </Link>
          </div>
          <div className="space-y-2.5">
            {devices.map((d) => (
              <div key={d.deviceId} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 px-3.5 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${d.online ? 'animate-pulse-dot bg-emerald-400' : 'bg-rose-300'}`} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">{d.deviceId}</p>
                    <p className="truncate text-[11px] text-slate-400">{d.name}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs tabular-nums text-slate-500">{d.todayJobs} 单</span>
                  <Badge tone={d.online ? 'emerald' : 'rose'} dot>{d.online ? '在线' : '离线'}</Badge>
                </div>
              </div>
            ))}
            {!devices.length && <p className="py-6 text-center text-xs text-slate-400">暂无设备</p>}
          </div>
        </div>

        {/* 最新复核动态 */}
        <div className="card p-6">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-[15px] font-bold tracking-tight text-slate-900">最新复核动态</h3>
              <p className="mt-0.5 text-xs text-slate-400">每次出药自动留档 · AI 视觉复核</p>
            </div>
            <Link to="/audit" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
              复核审计 <ArrowRight size={12} />
            </Link>
          </div>
          <div className="space-y-2.5">
            {audits.map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-2.5">
                <img
                  src={snapshotDataUri(a.snapshotSeed, a.recognized[0]?.name, a.capturedAt)}
                  alt="抓拍"
                  className="h-11 w-16 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-800">{a.prescriptionNo}</p>
                  <p className="truncate text-[11px] text-slate-400">{a.recognized[0]?.name} · {fmtDateTime(a.capturedAt)}</p>
                </div>
                <Badge tone={AUDIT_TONE[a.verdict]}>{AUDIT_LABEL[a.verdict]}</Badge>
              </div>
            ))}
            {!audits.length && <p className="py-6 text-center text-xs text-slate-400">暂无复核记录</p>}
          </div>
        </div>

        {/* 库存预警 */}
        <div className="card p-6">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-[15px] font-bold tracking-tight text-slate-900">库存预警</h3>
              <p className="mt-0.5 text-xs text-slate-400">效期 &lt; 90 天 · 库存 &lt; 5 件</p>
            </div>
            <Link to="/query" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
              药品查询 <ArrowRight size={12} />
            </Link>
          </div>
          <div className="space-y-2.5">
            {alerts.expiring.slice(0, 3).map((s) => (
              <div key={s.coord} className="flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50/50 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-800">{s.drugName}</p>
                  <p className="text-[11px] text-slate-400">{s.coord} · 批号 {s.batchNo}</p>
                </div>
                <Badge tone="amber">剩 {s.daysLeft} 天</Badge>
              </div>
            ))}
            {alerts.lowStock.slice(0, 2).map((s) => (
              <div key={s.coord} className="flex items-center justify-between rounded-xl border border-rose-100 bg-rose-50/50 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-800">{s.drugName}</p>
                  <p className="text-[11px] text-slate-400">{s.coord} · 批号 {s.batchNo}</p>
                </div>
                <Badge tone="rose">仅剩 {s.qty} 件</Badge>
              </div>
            ))}
            {!alerts.expiring.length && !alerts.lowStock.length && (
              <p className="py-6 text-center text-xs text-slate-400">当前无预警项</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
