// SignalBars.jsx — Wi-Fi 信号强度指示（三格）
import { rssiInfo } from '../lib/format.js';

export default function SignalBars({ rssi }) {
  const info = rssiInfo(rssi);
  const color = { emerald: 'bg-emerald-400', sky: 'bg-sky-400', amber: 'bg-amber-400', rose: 'bg-rose-400', slate: 'bg-slate-300' }[info.tone];
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex items-end gap-0.5">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`w-1 rounded-sm ${i <= info.bars ? color : 'bg-slate-200'}`} style={{ height: `${4 + i * 3}px` }} />
        ))}
      </span>
      <span className="text-xs tabular-nums text-slate-500">{rssi != null ? `${rssi} dBm · ${info.label}` : '—'}</span>
    </span>
  );
}
