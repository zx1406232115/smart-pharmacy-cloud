// pages/Query.jsx — 药品查询：品名/拼音简码/货位/效期区间检索 + 效期与低库存预警
import { useState } from 'react';
import { Search, RotateCcw, CalendarClock, PackageX, FileSearch } from 'lucide-react';
import Badge from '../components/Badge.jsx';
import { api } from '../lib/api.js';
import { useLiveData } from '../hooks/useUiSocket.js';
import { expInfo } from '../lib/format.js';

const EMPTY = { q: '', pinyin: '', slot: '', from: '', to: '' };

export default function Query() {
  const [filters, setFilters] = useState(EMPTY);
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [slots, setSlots] = useState([]);
  const [alerts, setAlerts] = useState({ expiring: [], lowStock: [] });
  const [loading, setLoading] = useState(false);

  useLiveData(async () => {
    const [s, a] = await Promise.all([api.get('/slots'), api.get('/inventory/alerts')]);
    setSlots(s); setAlerts(a);
  }, []);

  const run = async (f = filters) => {
    setLoading(true);
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v); });
    try {
      setResults(await api.get(`/query?${params.toString()}`));
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      {/* 检索区 */}
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-indigo-600">
            <FileSearch size={17} />
          </div>
          <div>
            <h3 className="text-[15px] font-bold tracking-tight text-slate-900">多维度检索</h3>
            <p className="text-xs text-slate-400">支持品名、拼音简码、货位坐标与效期区间组合过滤</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div>
            <label className="label">药品名称</label>
            <input className="input" value={filters.q} onChange={set('q')} placeholder="如：阿莫西林" />
          </div>
          <div>
            <label className="label">拼音简码</label>
            <input className="input uppercase" value={filters.pinyin} onChange={set('pinyin')} placeholder="如：AMXLJN" />
          </div>
          <div>
            <label className="label">货位</label>
            <select className="select" value={filters.slot} onChange={set('slot')}>
              <option value="">全部货位</option>
              {slots.map((s) => (
                <option key={s.coord} value={s.coord}>{s.coord}{s.status === 'FREE' ? '（空闲）' : ` · ${s.drugName || ''}`}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">效期起</label>
            <input type="date" className="input" value={filters.from} onChange={set('from')} />
          </div>
          <div>
            <label className="label">效期止</label>
            <input type="date" className="input" value={filters.to} onChange={set('to')} />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-3">
          <button className="btn-ghost" onClick={() => { setFilters(EMPTY); setSearched(false); }}>
            <RotateCcw size={14} /> 重置
          </button>
          <button className="btn-primary" onClick={() => run()} disabled={loading}>
            <Search size={14} /> {loading ? '查询中…' : '查询'}
          </button>
        </div>
      </div>

      {/* 检索结果 */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-6 pb-3 pt-5">
          <div>
            <h3 className="text-[15px] font-bold tracking-tight text-slate-900">检索结果</h3>
            <p className="mt-0.5 text-xs text-slate-400">{searched ? `命中 ${results.length} 条库存记录` : '查询后展示结果'}</p>
          </div>
          {searched && <Badge tone="indigo">{results.length} 条</Badge>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="bg-slate-50/70">
              <tr>
                <th className="th">药品</th>
                <th className="th">规格</th>
                <th className="th">国药准字</th>
                <th className="th">批号</th>
                <th className="th">货位</th>
                <th className="th">数量</th>
                <th className="th">有效期</th>
                <th className="th">状态</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const exp = expInfo(r.daysLeft);
                const low = r.qty < 5;
                return (
                  <tr key={r.coord} className="trow">
                    <td className="td">
                      <p className="text-[13px] font-medium text-slate-800">{r.drugName}</p>
                      <p className="font-mono text-[10.5px] text-slate-300">{r.drugId}</p>
                    </td>
                    <td className="td text-xs text-slate-500">{r.spec}</td>
                    <td className="td font-mono text-xs text-slate-500">{r.approvalNo}</td>
                    <td className="td font-mono text-xs text-slate-600">{r.batchNo}</td>
                    <td className="td">
                      <span className="rounded-md bg-brand-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-600">{r.coord}</span>
                    </td>
                    <td className="td">
                      <span className={`text-xs font-bold tabular-nums ${low ? 'text-rose-500' : 'text-slate-700'}`}>{r.qty}</span>
                      <span className="ml-1 text-[10.5px] text-slate-400">件</span>
                    </td>
                    <td className="td text-xs tabular-nums text-slate-500">{r.expDate}</td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={exp.tone}>{exp.label}</Badge>
                        {low && <Badge tone="rose">低库存</Badge>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {searched && !results.length && (
                <tr><td colSpan={8} className="px-4 py-14 text-center text-sm text-slate-400">未命中任何库存记录，请调整检索条件</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 预警区 */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="card p-6">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <span className="rounded-xl bg-amber-50 p-2 text-amber-600"><CalendarClock size={16} /></span>
              <div>
                <h3 className="text-[15px] font-bold tracking-tight text-slate-900">效期临期预警</h3>
                <p className="text-xs text-slate-400">有效期剩余 &lt; 90 天</p>
              </div>
            </div>
            <Badge tone="amber">{alerts.expiring.length} 项</Badge>
          </div>
          <div className="space-y-2">
            {alerts.expiring.map((s) => (
              <div key={s.coord} className="flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50/40 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-slate-800">{s.drugName} <span className="text-[11px] font-normal text-slate-400">{s.spec}</span></p>
                  <p className="text-[11px] text-slate-400">{s.coord} · 批号 {s.batchNo} · 效期至 {s.expDate}</p>
                </div>
                <Badge tone="amber">剩 {s.daysLeft} 天</Badge>
              </div>
            ))}
            {!alerts.expiring.length && <p className="py-8 text-center text-xs text-slate-400">暂无临期药品</p>}
          </div>
        </div>

        <div className="card p-6">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <span className="rounded-xl bg-rose-50 p-2 text-rose-500"><PackageX size={16} /></span>
              <div>
                <h3 className="text-[15px] font-bold tracking-tight text-slate-900">低库存预警</h3>
                <p className="text-xs text-slate-400">剩余数量 &lt; 5 件</p>
              </div>
            </div>
            <Badge tone="rose">{alerts.lowStock.length} 项</Badge>
          </div>
          <div className="space-y-2">
            {alerts.lowStock.map((s) => (
              <div key={s.coord} className="flex items-center justify-between rounded-xl border border-rose-100 bg-rose-50/40 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-slate-800">{s.drugName} <span className="text-[11px] font-normal text-slate-400">{s.spec}</span></p>
                  <p className="text-[11px] text-slate-400">{s.coord} · 批号 {s.batchNo} · 效期至 {s.expDate}</p>
                </div>
                <Badge tone="rose">仅剩 {s.qty} 件</Badge>
              </div>
            ))}
            {!alerts.lowStock.length && <p className="py-8 text-center text-xs text-slate-400">暂无低库存药品</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
