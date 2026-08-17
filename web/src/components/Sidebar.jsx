// Sidebar.jsx — 左侧导航（Linear 风格：分组 + 图标 + 激活态）
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Pill, PackagePlus, Search, Grid3x3, Cpu, ShieldCheck, Wifi, WifiOff,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore.js';

const GROUPS = [
  {
    label: '核心业务',
    items: [
      { to: '/', label: '总览', icon: LayoutDashboard, end: true },
      { to: '/dispense', label: '取药管理', icon: Pill },
      { to: '/store', label: '储药管理', icon: PackagePlus },
      { to: '/query', label: '药品查询', icon: Search },
      { to: '/slots', label: '货位看板', icon: Grid3x3 },
    ],
  },
  {
    label: '运维视图',
    items: [
      { to: '/ops', label: '设备运维', icon: Cpu },
      { to: '/audit', label: '复核审计', icon: ShieldCheck },
    ],
  },
];

export default function Sidebar() {
  const devices = useAppStore((s) => s.devices);
  const online = Object.values(devices).filter((d) => d.online).length;
  const total = Object.keys(devices).length;

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-slate-200/60 bg-white">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 pb-5 pt-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-float">
          <Pill size={18} className="text-white" strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <p className="text-[13.5px] font-bold tracking-tight text-slate-900">智能药柜云端</p>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">Smart Cabinet Cloud</p>
        </div>
      </div>

      {/* 导航 */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <p className="mb-1.5 px-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-400/90">{g.label}</p>
            <div className="space-y-0.5">
              {g.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  className={({ isActive }) =>
                    `group flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-all ${
                      isActive
                        ? 'bg-brand-50 text-indigo-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <it.icon size={17} strokeWidth={isActive ? 2.2 : 1.8} className={isActive ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'} />
                      {it.label}
                      {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-indigo-500" />}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* 底部：硬件连接状态 */}
      <div className="border-t border-slate-100 px-4 py-4">
        <div className="rounded-xl bg-slate-50/80 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-600">硬件连接</p>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
              {total === 0 ? (
                '未接入设备'
              ) : online > 0 ? (
                <><Wifi size={12} className="text-emerald-500" /> {online}/{total} 在线</>
              ) : (
                <><WifiOff size={12} className="text-rose-400" /> {online}/{total} 在线</>
              )}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200/70">
            <div
              className={`h-full rounded-full transition-all duration-500 ${online > 0 ? 'bg-emerald-400' : 'bg-rose-300'}`}
              style={{ width: `${total ? (online / total) * 100 : 0}%` }}
            />
          </div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-slate-400">v1.0.0 · ESP-01S 通道</p>
        </div>
      </div>
    </aside>
  );
}
