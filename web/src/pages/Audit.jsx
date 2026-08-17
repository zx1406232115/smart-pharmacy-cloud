// pages/Audit.jsx — 复核审计：出药抓拍留档卡片流 + AI OCR 品规对照 + 时间/处方追溯
import { useMemo, useState } from 'react';
import { ShieldCheck, Search, RotateCcw, Camera, ScanLine, BadgeCheck, Ban, FileText } from 'lucide-react';
import Badge from '../components/Badge.jsx';
import { api } from '../lib/api.js';
import { useLiveData } from '../hooks/useUiSocket.js';
import { snapshotDataUri } from '../lib/snapshotSvg.js';
import { AUDIT_LABEL, AUDIT_TONE, fmtFullDate, fmtDateTime } from '../lib/format.js';

const EMPTY = { prescriptionNo: '', from: '', to: '', verdict: 'ALL' };

function diffField(a, b) {
  return String(a ?? '').trim() !== String(b ?? '').trim();
}

function AuditCard({ audit }) {
  const blocked = audit.verdict === 'BLOCK';
  const img = snapshotDataUri(audit.snapshotSeed, audit.recognized[0]?.name, audit.capturedAt);
  return (
    <div className={`card card-hover flex flex-col overflow-hidden ${blocked ? 'ring-2 ring-rose-200' : ''}`}>
      {/* 抓拍快照 */}
      <div className="relative">
        <img src={img} alt="出药口抓拍" className="aspect-[16/10] w-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/80 to-transparent px-4 pb-2.5 pt-8">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-white">
            <Camera size={11} /> {audit.camera} · {fmtDateTime(audit.capturedAt)}
          </p>
        </div>
        <div className="absolute right-3 top-3">
          <Badge tone={AUDIT_TONE[audit.verdict]} className={blocked ? '!bg-rose-600 !text-white !border-rose-600 shadow-lg' : 'shadow-sm'}>
            {blocked ? <Ban size={11} /> : <BadgeCheck size={11} />}
            {AUDIT_LABEL[audit.verdict]}
          </Badge>
        </div>
      </div>

      {/* 品规对照 */}
      <div className="flex-1 p-5">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-bold tracking-tight text-slate-900">{audit.prescriptionNo}</p>
            <p className="mt-0.5 truncate font-mono text-[10.5px] text-slate-400">{audit.taskId} · {audit.deviceId}</p>
          </div>
          <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500">{audit.operator}</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <FileText size={10} /> 处方原始品规
            </p>
            {audit.expected.map((it, i) => (
              <div key={i} className="mb-2 last:mb-0">
                <p className="text-[11.5px] font-semibold text-slate-700">{it.name}</p>
                <p className="text-[10.5px] text-slate-400">{it.spec}</p>
                <p className="text-[10.5px] text-slate-400">批号 {it.batch} · ×{it.qty}</p>
              </div>
            ))}
          </div>
          <div className={`rounded-xl border p-3 ${blocked ? 'border-rose-200 bg-rose-50/40' : 'border-indigo-100 bg-brand-50/40'}`}>
            <p className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <ScanLine size={10} /> AI 视觉识别（OCR）
            </p>
            {audit.recognized.map((it, i) => {
              const exp = audit.expected[i];
              const bad = exp && (diffField(it.name, exp.name) || diffField(it.spec, exp.spec) || diffField(it.batch, exp.batch) || it.qty !== exp.qty);
              return (
                <div key={i} className={`mb-2 rounded-md p-1.5 last:mb-0 ${bad ? 'bg-white ring-1 ring-rose-200' : ''}`}>
                  <p className={`text-[11.5px] font-semibold ${bad ? 'text-rose-600' : 'text-slate-700'}`}>
                    {it.name} {bad && <span className="text-[9px]">✕ 不符</span>}
                  </p>
                  <p className={`text-[10.5px] ${bad ? 'text-rose-500' : 'text-slate-400'}`}>{it.spec}</p>
                  <p className={`text-[10.5px] ${bad ? 'text-rose-500' : 'text-slate-400'}`}>批号 {it.batch} · ×{it.qty}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-slate-100 bg-white px-3 py-2">
          <p className={`text-[11px] leading-relaxed ${blocked ? 'text-rose-600' : 'text-slate-500'}`}>
            {blocked ? '⛔ ' : '✅ '}{audit.reason}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {audit.recognized.map((it, i) => (
            <span key={i} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${Number(it.confidence) >= 0.95 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
              {(it.confidence * 100).toFixed(1)}%
            </span>
          ))}
          <span className="ml-auto text-[10px] text-slate-300">识别置信度</span>
        </div>
      </div>

      {/* 页脚 */}
      <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-5 py-2.5 text-[10.5px] text-slate-400">
        <span>{audit.reviewer}</span>
        <span className="tabular-nums">{fmtFullDate(audit.capturedAt)}</span>
      </div>
    </div>
  );
}

export default function Audit() {
  const [filters, setFilters] = useState(EMPTY);
  const [list, setList] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  useLiveData(async () => {
    const r = await api.get('/audits');
    setList(r);
  }, []);

  const run = async (f = filters) => {
    setLoading(true);
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v); });
    try {
      setList(await api.get(`/audits?${params.toString()}`));
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  const stats = useMemo(() => {
    const pass = list.filter((a) => a.verdict === 'PASS').length;
    return {
      pass,
      block: list.length - pass,
      rate: list.length ? ((pass / list.length) * 100).toFixed(1) : '—',
    };
  }, [list]);

  return (
    <div className="space-y-6">
      {/* 筛选区 */}
      <div className="card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-indigo-600">
              <ShieldCheck size={17} />
            </div>
            <div>
              <h3 className="text-[15px] font-bold tracking-tight text-slate-900">复核留档检索</h3>
              <p className="text-xs text-slate-400">按处方编号、时间范围与复核结果追溯回溯</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="emerald" dot>通过 {stats.pass}</Badge>
            <Badge tone="rose" dot>拦截 {stats.block}</Badge>
            <Badge tone="indigo">通过率 {stats.rate}%</Badge>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div>
            <label className="label">处方编号</label>
            <input className="input" value={filters.prescriptionNo} onChange={set('prescriptionNo')} placeholder="RX-… 或任务号" />
          </div>
          <div>
            <label className="label">起始日期</label>
            <input type="date" className="input" value={filters.from} onChange={set('from')} />
          </div>
          <div>
            <label className="label">截止日期</label>
            <input type="date" className="input" value={filters.to} onChange={set('to')} />
          </div>
          <div>
            <label className="label">复核结果</label>
            <select className="select" value={filters.verdict} onChange={set('verdict')}>
              <option value="ALL">全部</option>
              <option value="PASS">一致 · 通过</option>
              <option value="BLOCK">拦截 · 品规不符</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button className="btn-ghost" onClick={() => { setFilters(EMPTY); setSearched(false); }}>
              <RotateCcw size={14} />
            </button>
            <button className="btn-primary flex-1" onClick={() => run()} disabled={loading}>
              <Search size={14} /> {loading ? '检索中…' : '检索'}
            </button>
          </div>
        </div>
      </div>

      {/* 卡片流 */}
      <div>
        <p className="mb-3 text-xs text-slate-400">
          {searched ? `检索命中 ${list.length} 条留档记录` : `共 ${list.length} 条留档记录 · 每次出药自动留存抓拍与 OCR 结果`}
        </p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-3">
          {list.map((a) => <AuditCard key={a.id} audit={a} />)}
          {!list.length && (
            <div className="card col-span-full flex flex-col items-center justify-center py-20 text-center">
              <Camera size={26} className="text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-500">未找到匹配的复核记录</p>
              <p className="mt-1 text-xs text-slate-400">可调整处方编号或时间范围后重试</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
