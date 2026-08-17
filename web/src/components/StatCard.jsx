// StatCard.jsx — 顶部全局指标卡（大号加粗统计数字 + 环比 + 图标）
import { TrendingUp, TrendingDown } from 'lucide-react';

const TONES = {
  indigo: 'bg-brand-50 text-indigo-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  sky: 'bg-sky-50 text-sky-600',
  slate: 'bg-slate-100 text-slate-600',
};

export default function StatCard({ label, value, unit, delta, deltaUp = true, caption, tone = 'indigo', icon: Icon }) {
  return (
    <div className="card card-hover p-6 animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-slate-500">{label}</p>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">{value}</span>
            {unit && <span className="text-sm font-medium text-slate-400">{unit}</span>}
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            {delta !== undefined && delta !== null && (
              <span
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  deltaUp ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'
                }`}
              >
                {deltaUp ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                {deltaUp ? '+' : ''}
                {delta}
                {typeof delta === 'number' && delta > 3 ? '%' : ''}
              </span>
            )}
            {caption && <span className="truncate text-xs text-slate-400">{caption}</span>}
          </div>
        </div>
        <div className={`shrink-0 rounded-xl p-2.5 ${TONES[tone] || TONES.indigo}`}>
          <Icon size={20} strokeWidth={1.8} />
        </div>
      </div>
    </div>
  );
}
