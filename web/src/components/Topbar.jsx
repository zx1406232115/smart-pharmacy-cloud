// Topbar.jsx — 顶栏：页面标题 + 硬件状态 + 局域网时钟 + 操作员
import { useEffect, useState } from 'react';
import { Wifi, WifiOff, Radio } from 'lucide-react';
import { useAppStore } from '../store/useAppStore.js';
import { fmtTime } from '../lib/format.js';

export default function Topbar({ title, subtitle }) {
  const connected = useAppStore((s) => s.connected);
  const devices = useAppStore((s) => s.devices);
  const [now, setNow] = useState(Date.now());
  const online = Object.values(devices).filter((d) => d.online).length;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/60 bg-page/85 backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 px-8 py-3.5">
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-bold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="truncate text-xs text-slate-400">{subtitle}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {/* 实时通道状态 */}
          <div className="hidden items-center gap-2 rounded-full border border-slate-200/70 bg-white py-1.5 pl-3 pr-2 shadow-sm md:flex">
            <Radio size={13} className={connected ? 'text-indigo-500' : 'text-slate-300'} />
            <span className="text-xs font-medium text-slate-500">
              实时通道 <span className={connected ? 'text-emerald-600' : 'text-rose-500'}>{connected ? '已连接' : '重连中'}</span>
            </span>
            <span className="mx-0.5 h-3 w-px bg-slate-200" />
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${online > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
              {online > 0 ? <Wifi size={11} /> : <WifiOff size={11} />}
              硬件 {online}/{Object.keys(devices).length || '—'} 在线
            </span>
          </div>

          {/* 时钟 */}
          <div className="hidden rounded-full border border-slate-200/70 bg-white px-3.5 py-1.5 text-right shadow-sm sm:block">
            <p className="text-[13px] font-semibold tabular-nums leading-none text-slate-800">{fmtTime(now)}</p>
            <p className="mt-0.5 text-[10px] leading-none text-slate-400">
              {new Date(now).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })}
            </p>
          </div>

          {/* 操作员 */}
          <div className="flex items-center gap-2.5 rounded-full border border-slate-200/70 bg-white py-1 pl-1 pr-3 shadow-sm">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-[11px] font-bold text-white">
              张
            </span>
            <div className="hidden leading-tight sm:block">
              <p className="text-xs font-semibold text-slate-800">张药师</p>
              <p className="text-[10px] text-slate-400">药剂科 · 值班</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
