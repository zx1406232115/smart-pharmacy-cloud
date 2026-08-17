// Toasts.jsx — 轻提示（右上角堆叠）
import { CheckCircle2, AlertTriangle, Info, ShieldAlert, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore.js';

const MAP = {
  emerald: { icon: CheckCircle2, cls: 'border-emerald-100 bg-white', iconCls: 'text-emerald-500' },
  rose: { icon: ShieldAlert, cls: 'border-rose-100 bg-white', iconCls: 'text-rose-500' },
  amber: { icon: AlertTriangle, cls: 'border-amber-100 bg-white', iconCls: 'text-amber-500' },
  sky: { icon: Info, cls: 'border-sky-100 bg-white', iconCls: 'text-sky-500' },
  indigo: { icon: Info, cls: 'border-indigo-100 bg-white', iconCls: 'text-indigo-500' },
};

export default function Toasts() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed right-5 top-5 z-[100] flex w-80 flex-col gap-2.5">
      {toasts.map((t) => {
        const m = MAP[t.tone] || MAP.sky;
        const Icon = m.icon;
        return (
          <div key={t.id} className={`card pointer-events-auto animate-fade-up border p-4 shadow-soft-lg ${m.cls}`}>
            <div className="flex items-start gap-3">
              <Icon size={18} className={`mt-0.5 shrink-0 ${m.iconCls}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{t.title}</p>
                {t.desc && <p className="mt-0.5 truncate text-xs text-slate-500">{t.desc}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-slate-300 hover:text-slate-500">
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
