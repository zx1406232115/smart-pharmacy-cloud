// SlotMatrix.jsx — 交互式货位矩阵看板（层/列数由数据自动推导，当前模板 3 层 × 3 列）
// 可复用：总览迷你版 / 货位看板全量版
import { SIZE_LABEL } from '../lib/format.js';

const STATUS_STYLE = {
  OCCUPIED: 'border-indigo-200/80 bg-indigo-50/70 text-indigo-700 hover:border-indigo-300',
  WARNING: 'border-amber-300/80 bg-amber-50 text-amber-700 hover:border-amber-400',
  FREE: 'border-dashed border-slate-200 bg-slate-50/70 text-slate-400 hover:border-slate-300 hover:bg-slate-100/70',
};

const LAYER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function SlotMatrix({ slots = [], onSelect, selectedCoord, compact = false }) {
  const byCoord = {};
  slots.forEach((s) => { byCoord[s.coord] = s; });

  const layers = slots.length ? Math.max(...slots.map((s) => s.layer)) : 0;
  const cols = slots.length ? Math.max(...slots.map((s) => s.col)) : 0;
  if (!layers || !cols) {
    return <p className="py-10 text-center text-xs text-slate-400">暂无货位数据</p>;
  }
  const gridStyle = { gridTemplateColumns: `2rem repeat(${cols}, minmax(0, 1fr))` };

  return (
    <div className="space-y-2">
      {/* 列号头 */}
      <div className="grid gap-1.5" style={gridStyle}>
        <div />
        {Array.from({ length: cols }, (_, i) => (
          <div key={i} className={`text-center text-[10px] font-semibold uppercase tracking-wider text-slate-300 ${compact ? 'py-0.5' : 'py-1'}`}>
            {i + 1}
          </div>
        ))}
      </div>

      {/* 每层一行 */}
      {Array.from({ length: layers }, (_, li) => {
        const letter = LAYER_LETTERS[li] || String(li + 1);
        return (
          <div key={letter} className="grid gap-1.5" style={gridStyle}>
            <div className="flex items-center justify-center text-[11px] font-bold text-slate-300">{letter} 层</div>
            {Array.from({ length: cols }, (_, ci) => {
              const coord = `${letter}-${String(ci + 1).padStart(2, '0')}`;
              const slot = byCoord[coord];
              if (!slot) {
                return <div key={coord} className={`rounded-xl bg-slate-100/40 ${compact ? 'h-12' : 'h-[4.5rem]'}`} />;
              }
              const occupied = slot.status !== 'FREE';
              const selected = selectedCoord === coord;
              return (
                <div
                  key={coord}
                  onClick={() => onSelect && onSelect(slot)}
                  className={`group relative cursor-pointer rounded-xl border p-1.5 text-center transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm ${
                    STATUS_STYLE[slot.status]
                  } ${selected ? 'ring-2 ring-indigo-500 ring-offset-1' : ''}`}
                >
                  <p className={`font-semibold tabular-nums ${compact ? 'text-[9px]' : 'text-[10px]'}`}>{coord}</p>
                  {occupied ? (
                    <>
                      <p className={`mt-0.5 truncate font-medium ${compact ? 'text-[8.5px]' : 'text-[10.5px]'}`}>{slot.drugName}</p>
                      <p className={`tabular-nums ${compact ? 'text-[8.5px]' : 'text-[9.5px]'}`}>{slot.qty} 件</p>
                      {slot.status === 'WARNING' && (
                        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" />
                      )}
                    </>
                  ) : (
                    <p className={`mt-0.5 ${compact ? 'text-[8.5px]' : 'text-[9.5px]'}`}>空闲</p>
                  )}

                  {/* 悬浮三维坐标信息 */}
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-44 -translate-x-1/2 rounded-xl bg-slate-900 p-3 text-left shadow-xl group-hover:block">
                    <p className="flex items-center justify-between text-[11px] font-bold text-white">
                      {coord}
                      {slot.status === 'FREE' ? (
                        <span className="rounded-full bg-slate-700 px-1.5 py-0.5 text-[9px] font-medium text-slate-300">空闲</span>
                      ) : (
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${slot.status === 'WARNING' ? 'bg-amber-500/20 text-amber-300' : 'bg-indigo-500/20 text-indigo-300'}`}>
                          {slot.status === 'WARNING' ? '效期预警' : '已占用'}
                        </span>
                      )}
                    </p>
                    <p className="mt-1.5 text-[10px] text-slate-400">
                      第 {slot.layer} 层 · 第 {slot.col} 列 · 第 {slot.trayIndex} 格 · 格位{SIZE_LABEL[slot.size] || ''}
                    </p>
                    {occupied && (
                      <>
                        <p className="mt-1 text-[10px] leading-snug text-slate-200">{slot.drugName}</p>
                        <p className="text-[10px] text-slate-400">批号 {slot.batchNo}</p>
                        <p className="text-[10px] text-slate-400">
                          剩余 <span className="font-semibold text-white">{slot.qty}</span> 件 · 效期 {slot.expDate}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
