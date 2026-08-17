// pages/Dispense.jsx — 取药管理：处方队列表格 / 批量下发 / 凭证生成 / 队列智能优化提示
import { useEffect, useMemo, useState } from 'react';
import {
  Send, RefreshCw, Barcode, Search, Sparkles, CheckSquare, Square, RotateCcw, Package, ChevronRight,
} from 'lucide-react';
import Badge from '../components/Badge.jsx';
import Modal from '../components/Modal.jsx';
import VoucherModal from '../components/VoucherModal.jsx';
import { api } from '../lib/api.js';
import { useLiveData } from '../hooks/useUiSocket.js';
import { useAppStore } from '../store/useAppStore.js';
import { PRESCRIPTION_LABEL, PRESCRIPTION_TONE, fmtDuration, fmtDateTime, timeAgo } from '../lib/format.js';

const TABS = [
  { key: 'ALL', label: '全部' },
  { key: 'QUEUED', label: '待执行' },
  { key: 'DISPENSING', label: '执行中' },
  { key: 'DONE', label: '已完成' },
  { key: 'BLOCKED', label: '已拦截' },
];

export default function Dispense() {
  const [all, setAll] = useState([]);
  const [tab, setTab] = useState('ALL');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [voucher, setVoucher] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const toast = useAppStore((s) => s.toast);

  useLiveData(async () => setAll(await api.get('/prescriptions')), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const counts = useMemo(() => {
    const c = { ALL: all.length };
    for (const t of TABS.slice(1)) c[t.key] = all.filter((p) => p.status === t.key).length;
    return c;
  }, [all]);

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return all
      .filter((p) => (tab === 'ALL' ? true : p.status === tab))
      .filter((p) => !kw || p.no.toLowerCase().includes(kw) || p.patient.includes(kw) || (p.taskId || '').toLowerCase().includes(kw));
  }, [all, tab, q]);

  const queued = all.filter((p) => p.status === 'QUEUED');
  const running = all.filter((p) => p.status === 'DISPENSING');

  const toggle = (id) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAll = () => {
    const selectable = list.filter((p) => p.status === 'QUEUED' || p.status === 'BLOCKED');
    const allSel = selectable.every((p) => selected.has(p.id));
    setSelected(allSel ? new Set() : new Set(selectable.map((p) => p.id)));
  };

  const dispatch = async (ids) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await api.post('/prescriptions/dispatch', { ids });
      toast({ tone: 'emerald', title: r.message, desc: `设备 ${r.results[0]?.deviceId} · ${r.results[0]?.mode === 'virtual' ? '虚拟仿真通道' : '真实硬件通道'}` });
      setSelected(new Set());
    } catch (e) {
      toast({ tone: 'rose', title: '下发失败', desc: e.message });
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = list.filter((p) => selected.has(p.id) && (p.status === 'QUEUED' || p.status === 'BLOCKED')).length;

  return (
    <div className="space-y-5">
      {/* 队列智能优化提示 */}
      {(queued.length > 0 || running.length > 0) && (
        <div className="card flex flex-wrap items-center gap-4 border-indigo-100 bg-gradient-to-r from-brand-50/80 via-white to-white p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-float">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-bold text-slate-900">队列智能优化已生效</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              待执行 {queued.length} 单将按设备侧路径最短重排执行（蛇形路径算法），机械臂往返距离预计减少约 22%；执行中 {running.length} 单。
            </p>
          </div>
          <button className="btn-soft" onClick={() => dispatch(queued.map((p) => p.id))} disabled={!queued.length || busy}>
            <Send size={14} /> 立即下发队列（{queued.length}）
          </button>
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-slate-200/70 bg-white p-1 shadow-sm">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-all ${
                tab === t.key ? 'bg-brand-50 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 tabular-nums text-[11px] ${tab === t.key ? 'text-indigo-400' : 'text-slate-300'}`}>{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索处方号 / 取药人 / 任务号"
              className="input w-64 pl-9"
            />
          </div>
          <button className="btn-ghost" onClick={() => { setAll([]); api.get('/prescriptions').then(setAll); }}>
            <RefreshCw size={14} /> 刷新
          </button>
          <button className="btn-primary" onClick={() => dispatch([...selected])} disabled={!selectedCount || busy}>
            <Send size={14} /> 批量下发{selectedCount ? `（${selectedCount}）` : ''}
          </button>
        </div>
      </div>

      {/* 处方队列表格 */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px]">
            <thead className="bg-slate-50/70">
              <tr>
                <th className="th w-10">
                  <button onClick={toggleAll} className="text-slate-400 hover:text-indigo-500">
                    {list.some((p) => selected.has(p.id)) ? <CheckSquare size={16} className="text-indigo-500" /> : <Square size={16} />}
                  </button>
                </th>
                <th className="th">处方号 / 任务</th>
                <th className="th">取药人</th>
                <th className="th">品种数</th>
                <th className="th">涉及货位</th>
                <th className="th">状态</th>
                <th className="th">耗时 / 时间</th>
                <th className="th text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="trow">
                  <td className="td">
                    <button onClick={() => toggle(p.id)} disabled={p.status !== 'QUEUED' && p.status !== 'BLOCKED'} className={p.status === 'QUEUED' || p.status === 'BLOCKED' ? 'text-slate-400 hover:text-indigo-500' : 'text-slate-200'}>
                      {selected.has(p.id) ? <CheckSquare size={16} className="text-indigo-500" /> : <Square size={16} />}
                    </button>
                  </td>
                  <td className="td">
                    <p className="text-[13px] font-semibold text-slate-900">{p.no}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{p.taskId || '未下发任务号'}</p>
                  </td>
                  <td className="td text-[13px] text-slate-600">{p.patient}</td>
                  <td className="td">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      <Package size={11} /> {p.items.length} 种 / {p.totalQty} 件
                    </span>
                  </td>
                  <td className="td">
                    <div className="flex max-w-56 flex-wrap gap-1">
                      {(p.route.length ? p.route : p.items.map((i) => i.slotCoord)).slice(0, 4).map((c) => (
                        <span key={c} className="rounded-md bg-brand-50 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-indigo-600">{c}</span>
                      ))}
                      {(p.route.length ? p.route : p.items.map((i) => i.slotCoord)).length > 4 && (
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-400">+{(p.route.length || p.items.length) - 4}</span>
                      )}
                    </div>
                  </td>
                  <td className="td">
                    <Badge tone={PRESCRIPTION_TONE[p.status]} dot>{PRESCRIPTION_LABEL[p.status]}</Badge>
                    {p.status === 'BLOCKED' && <p className="mt-1 max-w-44 truncate text-[10.5px] text-rose-400">{p.note}</p>}
                  </td>
                  <td className="td text-xs text-slate-500">
                    {p.status === 'DONE' && <p>{fmtDuration(p.finishedAt - p.startedAt)}</p>}
                    {p.status === 'DISPENSING' && <p className="font-medium text-indigo-600">{fmtDuration(now - p.startedAt)}</p>}
                    {p.status === 'QUEUED' && <p className="text-slate-400">排队 {timeAgo(p.createdAt)}</p>}
                    {p.status === 'BLOCKED' && <p className="text-slate-400">{fmtDateTime(p.finishedAt)}</p>}
                  </td>
                  <td className="td">
                    <div className="flex items-center justify-end gap-1.5">
                      {p.status === 'QUEUED' && (
                        <button className="btn-soft !px-3 !py-1.5 text-xs" onClick={() => dispatch([p.id])} disabled={busy}>
                          <Send size={12} /> 下发
                        </button>
                      )}
                      {p.status === 'BLOCKED' && (
                        <button className="btn-outline !px-3 !py-1.5 text-xs !text-rose-600" onClick={() => dispatch([p.id])} disabled={busy}>
                          <RotateCcw size={12} /> 重新下发
                        </button>
                      )}
                      <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setVoucher(p)} title="生成取药凭证">
                        <Barcode size={12} /> 凭证
                      </button>
                      <button className="btn-ghost !px-2 !py-1.5" onClick={() => setDetail(p)} title="查看明细">
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-14 text-center text-sm text-slate-400">
                    {q ? '未找到匹配的处方' : '当前筛选下暂无处方'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
          <span>共 {list.length} 条 · 队列智能优化提示：已按设备侧路径最短重排执行</span>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles size={12} className="text-indigo-400" /> 蛇形路径算法 · 减少机械臂往返
          </span>
        </div>
      </div>

      {/* 凭证弹窗 */}
      {voucher && <VoucherModal prescription={voucher} onClose={() => setVoucher(null)} />}

      {/* 明细弹窗 */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title="处方明细" subtitle={detail?.no} width="max-w-md">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[11px] text-slate-400">取药人</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{detail.patient}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[11px] text-slate-400">状态 / 设备</p>
                <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Badge tone={PRESCRIPTION_TONE[detail.status]}>{PRESCRIPTION_LABEL[detail.status]}</Badge>
                  {detail.deviceId}
                </p>
              </div>
            </div>
            <div>
              <p className="label">药品明细</p>
              <div className="space-y-1.5">
                {detail.items.map((it, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-slate-100 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-slate-800">{it.name}</p>
                      <p className="text-[11px] text-slate-400">{it.spec}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-xs text-indigo-600">{it.slotCoord}</span>
                      <span className="text-sm font-bold text-slate-900">×{it.qty}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {detail.route?.length > 0 && (
              <div>
                <p className="label">执行路径（已重排）</p>
                <p className="rounded-xl bg-brand-50 px-3.5 py-2.5 text-xs leading-relaxed text-indigo-700">{detail.route.join(' → ')}</p>
                <p className="mt-1.5 text-[11px] text-slate-400">{detail.note}</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
