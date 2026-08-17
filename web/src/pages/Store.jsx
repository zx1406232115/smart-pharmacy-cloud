// pages/Store.jsx — 储药管理：扫码储药闭环（StorageFlow 组件）+ 手动入库 + 药品档案
import { useEffect, useMemo, useState } from 'react';
import {
  PackagePlus, Sparkles, MapPin, Boxes, Inbox, RefreshCw, CalendarDays, Archive,
  ScanBarcode,
} from 'lucide-react';
import Badge from '../components/Badge.jsx';
import StorageFlow from '../components/StorageFlow.jsx';
import { api } from '../lib/api.js';
import { useLiveData } from '../hooks/useUiSocket.js';
import { useAppStore } from '../store/useAppStore.js';
import { fmtDateTime, timeAgo, SHAPE_LABEL, SIZE_LABEL } from '../lib/format.js';

const EMPTY = { name: '', approvalNo: '', spec: '', batchNo: '', expDate: '', qty: '' };

export default function Store() {
  const toast = useAppStore((s) => s.toast);
  const lastScan = useAppStore((s) => s.lastScan);

  // ---- 手动入库登记 ----
  const [form, setForm] = useState(EMPTY);
  const [autoAssign, setAutoAssign] = useState(true);
  const [rec, setRec] = useState(null);
  const [recommending, setRecommending] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ---- 数据 ----
  const [records, setRecords] = useState([]);
  const [slots, setSlots] = useState([]);
  const [drugs, setDrugs] = useState([]);

  const refresh = async () => {
    const [r, s, d] = await Promise.all([api.get('/inventory'), api.get('/slots'), api.get('/drugs')]);
    setRecords(r); setSlots(s); setDrugs(d);
  };
  useLiveData(refresh, []);

  // 手动入库：智能货位推荐（防抖）
  useEffect(() => {
    if (!autoAssign || !(Number(form.qty) > 0)) { setRec(null); return; }
    setRecommending(true);
    const t = setTimeout(async () => {
      try {
        setRec(await api.get(`/slots/recommend?qty=${Number(form.qty)}`));
      } catch { setRec(null); }
      finally { setRecommending(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [autoAssign, form.name, form.qty]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // ---- 手动入库提交 ----
  async function submit() {
    setSubmitting(true);
    try {
      const r = await api.post('/inventory', { ...form, qty: Number(form.qty), autoAssign });
      toast({ tone: 'emerald', title: '入库登记成功', desc: `${form.name} × ${form.qty} → 货位 ${r.slotCoord}（${r.message}）` });
      setForm(EMPTY);
      setRec(null);
      refresh();
    } catch (e) {
      toast({ tone: 'rose', title: '入库失败', desc: e.message });
    } finally {
      setSubmitting(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const stats = useMemo(() => {
    const todayRecords = records.filter((r) => new Date(r.inAt).toISOString().slice(0, 10) === today);
    const qty = todayRecords.reduce((n, r) => n + r.qty, 0);
    const occupied = slots.filter((s) => s.status !== 'FREE').length;
    return { count: todayRecords.length, qty, occupied };
  }, [records, slots, today]);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
      {/* ============ 左列 ============ */}
      <div className="space-y-6 xl:col-span-2">
        {/* 扫码储药（机器扫码 → 查库 → 建档 → 储药） */}
        <div className="card p-6">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-float">
              <ScanBarcode size={17} />
            </div>
            <div>
              <h3 className="text-[15px] font-bold tracking-tight text-slate-900">扫码储药</h3>
              <p className="text-xs text-slate-400">机器扫 EAN-13 询问网页 → 未建档则启动建档 → 确认储药</p>
            </div>
          </div>
          <div className="mb-4 flex items-center justify-between gap-2">
            {lastScan && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] text-indigo-600">
                <ScanBarcode size={11} />
                {lastScan.source || 'MaixCam'} 已扫码 {lastScan.barcode}
                {lastScan.found ? ` · ${lastScan.drugName}` : ' · 未建档'}
              </span>
            )}
          </div>
          <StorageFlow
            key={lastScan?.at || 'manual'}
            injectedBarcode={lastScan?.barcode || ''}
            onStored={refresh}
          />
        </div>

        {/* 手动入库登记（保留） */}
        <div className="card p-6">
          <div className="mb-5 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-indigo-600">
              <PackagePlus size={17} />
            </div>
            <div>
              <h3 className="text-[15px] font-bold tracking-tight text-slate-900">入库登记（手动）</h3>
              <p className="text-xs text-slate-400">无条码场景下手工录入，自动分配货位</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="label">药品名称 <span className="text-rose-400">*</span></label>
              <input list="drug-options" className="input" value={form.name} onChange={set('name')} placeholder="如：阿莫西林胶囊" />
              <datalist id="drug-options">
                {drugs.map((d) => <option key={d.id} value={d.name} />)}
              </datalist>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">国药准字</label>
                <input className="input" value={form.approvalNo} onChange={set('approvalNo')} placeholder="H2020xxxx" />
              </div>
              <div>
                <label className="label">规格</label>
                <input className="input" value={form.spec} onChange={set('spec')} placeholder="0.25g×24粒/盒" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">生产批号 <span className="text-rose-400">*</span></label>
                <input className="input" value={form.batchNo} onChange={set('batchNo')} placeholder="如 20260715A" />
              </div>
              <div>
                <label className="label">入库数量 <span className="text-rose-400">*</span></label>
                <input type="number" min="1" className="input" value={form.qty} onChange={set('qty')} placeholder="0" />
              </div>
            </div>
            <div>
              <label className="label">有效期 <span className="text-rose-400">*</span></label>
              <input type="date" className="input" value={form.expDate} onChange={set('expDate')} />
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5">
              <label className="flex cursor-pointer items-center justify-between">
                <span className="flex items-center gap-2 text-[13px] font-medium text-slate-700">
                  <Sparkles size={14} className="text-indigo-500" /> 智能货位推荐分配
                </span>
                <button
                  type="button"
                  onClick={() => setAutoAssign((v) => !v)}
                  className={`relative h-6 w-11 rounded-full transition-colors ${autoAssign ? 'bg-indigo-600' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${autoAssign ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </label>
              {autoAssign && (
                <div className="mt-3">
                  {recommending ? (
                    <p className="flex items-center gap-2 text-xs text-slate-400"><RefreshCw size={12} className="animate-spin" /> 正在计算最优货位…</p>
                  ) : rec?.coord ? (
                    <div className="flex items-center gap-3 rounded-xl border border-indigo-100 bg-white p-3">
                      <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-float">
                        <MapPin size={15} />
                        <span className="font-mono text-[11px] font-bold">{rec.coord}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800">推荐存入 {rec.coord}（{rec.layer} 层 {rec.col} 列）</p>
                        <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{rec.reason}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">{rec?.reason || '填写入库数量后自动推荐货位'}</p>
                  )}
                  {rec?.alternatives?.length > 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                      备选：
                      {rec.alternatives.map((c) => (
                        <span key={c} className="rounded-md bg-brand-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-indigo-600">{c}</span>
                      ))}
                    </p>
                  )}
                </div>
              )}
            </div>

            <button className="btn-primary w-full py-2.5" onClick={submit} disabled={submitting || !form.name || !form.batchNo || !form.expDate || !(Number(form.qty) > 0)}>
              <PackagePlus size={16} /> {submitting ? '登记中…' : '确认入库'}
            </button>
          </div>
        </div>
      </div>

      {/* ============ 右列 ============ */}
      <div className="space-y-6 xl:col-span-3">
        {/* 药品档案 */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-6 pb-3 pt-5">
            <div>
              <h3 className="text-[15px] font-bold tracking-tight text-slate-900">药品档案</h3>
              <p className="mt-0.5 text-xs text-slate-400">扫码建档自动录入商品码，共 {drugs.length} 种</p>
            </div>
            <Badge tone="indigo" dot>条码校验</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="th">商品码（EAN-13）</th>
                  <th className="th">药品名称</th>
                  <th className="th">形状</th>
                  <th className="th">尺寸</th>
                  <th className="th">建档时间</th>
                </tr>
              </thead>
              <tbody>
                {drugs.map((d) => (
                  <tr key={d.id} className="trow">
                    <td className="td font-mono text-xs font-semibold text-indigo-600">{d.barcode || '—'}</td>
                    <td className="td">
                      <p className="text-[13px] font-medium text-slate-800">{d.name}</p>
                      <p className="text-[11px] text-slate-400">{d.spec !== '—' ? d.spec : ''}</p>
                    </td>
                    <td className="td text-xs text-slate-600">{SHAPE_LABEL[d.shape] || '—'}</td>
                    <td className="td text-xs text-slate-600">{SIZE_LABEL[d.size] || '—'}</td>
                    <td className="td text-xs text-slate-400">{d.createdAt ? fmtDateTime(d.createdAt) : '—'}</td>
                  </tr>
                ))}
                {!drugs.length && (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">药品库为空 —— 扫描第一盒药即可启动建档</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-500">今日入库</p>
              <span className="rounded-lg bg-brand-50 p-1.5 text-indigo-600"><Inbox size={14} /></span>
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{stats.count}<span className="ml-1 text-sm font-medium text-slate-400">单</span></p>
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-500">入库数量</p>
              <span className="rounded-lg bg-emerald-50 p-1.5 text-emerald-600"><Boxes size={14} /></span>
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{stats.qty}<span className="ml-1 text-sm font-medium text-slate-400">件</span></p>
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-500">货位占用</p>
              <span className="rounded-lg bg-amber-50 p-1.5 text-amber-600"><Archive size={14} /></span>
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{stats.occupied}<span className="ml-1 text-sm font-medium text-slate-400">/ {slots.length} 格</span></p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-indigo-600" style={{ width: `${slots.length ? (stats.occupied / slots.length) * 100 : 0}%` }} />
            </div>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-6 pb-3 pt-5">
            <div>
              <h3 className="text-[15px] font-bold tracking-tight text-slate-900">最近入库记录</h3>
              <p className="mt-0.5 text-xs text-slate-400">最新 8 条 · 含自动分配的货位坐标</p>
            </div>
            <Badge tone="sky" dot>库存实时联动</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="th">时间</th>
                  <th className="th">药品</th>
                  <th className="th">批号</th>
                  <th className="th">数量</th>
                  <th className="th">货位</th>
                  <th className="th">效期</th>
                  <th className="th">来源</th>
                </tr>
              </thead>
              <tbody>
                {records.slice(0, 8).map((r) => (
                  <tr key={r.id} className="trow">
                    <td className="td text-xs text-slate-500">
                      <p>{fmtDateTime(r.inAt)}</p>
                      <p className="text-[10.5px] text-slate-300">{timeAgo(r.inAt)}</p>
                    </td>
                    <td className="td">
                      <p className="text-[13px] font-medium text-slate-800">{r.drugName}</p>
                      <p className="text-[11px] text-slate-400">{r.spec}</p>
                    </td>
                    <td className="td font-mono text-xs text-slate-600">{r.batchNo}</td>
                    <td className="td text-xs font-semibold text-slate-800">{r.qty} 件</td>
                    <td className="td">
                      <span className="rounded-md bg-brand-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-600">{r.slotCoord}</span>
                    </td>
                    <td className="td">
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <CalendarDays size={12} className="text-slate-300" /> {r.expDate}
                      </span>
                    </td>
                    <td className="td text-xs text-slate-500">{r.source === 'storage-confirm' ? '扫码储药' : '手动登记'}</td>
                  </tr>
                ))}
                {!records.length && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">暂无入库记录</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
