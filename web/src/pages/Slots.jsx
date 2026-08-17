// pages/Slots.jsx — 货位看板：4层×8列矩阵 + 三维坐标详情 + 出库登记
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Grid3x3, Boxes, Archive, CalendarClock, PackageMinus, ArrowRight, Info } from 'lucide-react';
import Badge from '../components/Badge.jsx';
import Modal from '../components/Modal.jsx';
import SlotMatrix from '../components/SlotMatrix.jsx';
import { api } from '../lib/api.js';
import { useLiveData } from '../hooks/useUiSocket.js';
import { useAppStore } from '../store/useAppStore.js';
import { fmtDateTime, expInfo, SIZE_LABEL } from '../lib/format.js';

export default function Slots() {
  const [slots, setSlots] = useState([]);
  const [selected, setSelected] = useState(null);
  const [outQty, setOutQty] = useState('');
  const [outOpen, setOutOpen] = useState(false);
  const toast = useAppStore((s) => s.toast);

  useLiveData(async () => setSlots(await api.get('/slots')), []);

  const stats = useMemo(() => {
    const occupied = slots.filter((s) => s.status !== 'FREE');
    return {
      total: slots.length,
      occupied: occupied.filter((s) => s.status === 'OCCUPIED').length,
      warning: occupied.filter((s) => s.status === 'WARNING').length,
      free: slots.length - occupied.length,
    };
  }, [slots]);

  const onSelect = (slot) => setSelected(slot);

  const outbound = async () => {
    const n = Number(outQty);
    if (!(n > 0)) return;
    try {
      const r = await api.post(`/slots/${selected.coord}/outbound`, { qty: n });
      toast({ tone: 'emerald', title: `货位 ${selected.coord} 出库 ${n} 件`, desc: r.slot.qty > 0 ? `剩余 ${r.slot.qty} 件` : '货位已释放为空闲' });
      setOutOpen(false);
      setOutQty('');
      setSelected(r.slot);
      setSlots(await api.get('/slots'));
    } catch (e) {
      toast({ tone: 'rose', title: '出库失败', desc: e.message });
    }
  };

  const exp = selected && selected.status !== 'FREE' ? expInfo(Math.ceil((new Date(selected.expDate) - new Date()) / 86400000)) : null;

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_20rem]">
      {/* 左：矩阵 */}
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          <div className="card flex items-center gap-3 p-4">
            <span className="rounded-xl bg-slate-100 p-2 text-slate-500"><Grid3x3 size={16} /></span>
            <div>
              <p className="text-xs text-slate-400">总货位</p>
              <p className="text-xl font-bold tracking-tight text-slate-900">{stats.total} <span className="text-xs font-medium text-slate-400">格</span></p>
            </div>
          </div>
          <div className="card flex items-center gap-3 p-4">
            <span className="rounded-xl bg-indigo-50 p-2 text-indigo-600"><Boxes size={16} /></span>
            <div>
              <p className="text-xs text-slate-400">已占用</p>
              <p className="text-xl font-bold tracking-tight text-indigo-600">{stats.occupied}</p>
            </div>
          </div>
          <div className="card flex items-center gap-3 p-4">
            <span className="rounded-xl bg-amber-50 p-2 text-amber-600"><CalendarClock size={16} /></span>
            <div>
              <p className="text-xs text-slate-400">效期预警</p>
              <p className="text-xl font-bold tracking-tight text-amber-600">{stats.warning}</p>
            </div>
          </div>
          <div className="card flex items-center gap-3 p-4">
            <span className="rounded-xl bg-slate-50 p-2 text-slate-400"><Archive size={16} /></span>
            <div>
              <p className="text-xs text-slate-400">空闲可用</p>
              <p className="text-xl font-bold tracking-tight text-slate-600">{stats.free}</p>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <h3 className="text-[15px] font-bold tracking-tight text-slate-900">货位矩阵看板</h3>
              <p className="mt-0.5 text-xs text-slate-400">悬浮查看三维坐标信息 · 点击查看货位详情</p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-indigo-500/70" /> 已占用</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-amber-400/80" /> 效期预警</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm border border-dashed border-slate-300 bg-slate-50" /> 空闲</span>
            </div>
          </div>
          <SlotMatrix slots={slots} onSelect={onSelect} selectedCoord={selected?.coord} />
        </div>
      </div>

      {/* 右：详情面板 */}
      <div className="space-y-5">
        {selected ? (
          <div className="card sticky top-24 p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-mono text-2xl font-bold tracking-tight text-slate-900">{selected.coord}</p>
                <p className="mt-1 text-xs text-slate-400">
                  第 {selected.layer} 层 · 第 {selected.col} 列 · 第 {selected.trayIndex} 格 · 格位{SIZE_LABEL[selected.size] || ''}
                </p>
              </div>
              <Badge tone={selected.status === 'FREE' ? 'slate' : selected.status === 'WARNING' ? 'amber' : 'indigo'} dot>
                {selected.status === 'FREE' ? '空闲可用' : selected.status === 'WARNING' ? '效期预警' : '已占用'}
              </Badge>
            </div>

            <div className="my-5 h-px bg-slate-100" />

            {selected.status === 'FREE' ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-5 text-center">
                <Archive size={22} className="mx-auto text-slate-300" />
                <p className="mt-2 text-sm font-medium text-slate-500">该货位空闲，可分配入库</p>
                <Link to="/store" className="btn-soft mt-3 w-full">
                  前往入库登记 <ArrowRight size={13} />
                </Link>
              </div>
            ) : (
              <div className="space-y-3.5">
                <div>
                  <p className="label">存放药品</p>
                  <p className="text-[15px] font-bold text-slate-900">{selected.drugName}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{selected.spec}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[10.5px] text-slate-400">生产批号</p>
                    <p className="mt-1 font-mono text-xs font-semibold text-slate-800">{selected.batchNo}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[10.5px] text-slate-400">剩余数量</p>
                    <p className={`mt-1 text-xs font-bold tabular-nums ${selected.qty < 5 ? 'text-rose-500' : 'text-slate-800'}`}>{selected.qty} 件</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[10.5px] text-slate-400">有效期至</p>
                    <p className="mt-1 text-xs font-semibold text-slate-800">{selected.expDate}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-[10.5px] text-slate-400">最近更新</p>
                    <p className="mt-1 text-xs font-semibold text-slate-800">{selected.updatedAt ? fmtDateTime(selected.updatedAt) : '—'}</p>
                  </div>
                </div>
                {exp && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">效期余量</span>
                      <Badge tone={exp.tone}>{exp.label}</Badge>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${exp.tone === 'amber' ? 'bg-amber-400' : exp.tone === 'rose' ? 'bg-rose-400' : 'bg-emerald-400'}`}
                        style={{ width: `${Math.max(4, Math.min(100, (Math.max(0, Math.ceil((new Date(selected.expDate) - new Date()) / 86400000)) / 540) * 100))}%` }}
                      />
                    </div>
                  </div>
                )}
                <button className="btn-outline w-full" onClick={() => setOutOpen(true)}>
                  <PackageMinus size={14} /> 出库登记
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="card flex h-64 flex-col items-center justify-center p-6 text-center">
            <Info size={22} className="text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-500">点击任意货位查看详情</p>
            <p className="mt-1 text-xs text-slate-400">展示三维坐标、存放药品、批号与剩余数量</p>
          </div>
        )}
      </div>

      {/* 出库登记弹窗 */}
      <Modal open={outOpen} onClose={() => setOutOpen(false)} title="出库登记" subtitle={selected ? `${selected.coord} · ${selected.drugName}` : ''} width="max-w-sm"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setOutOpen(false)}>取消</button>
            <button className="btn-primary" onClick={outbound} disabled={!(Number(outQty) > 0) || !(Number(outQty) <= (selected?.qty || 0))}>
              确认出库
            </button>
          </>
        }
      >
        <label className="label">出库数量（当前库存 {selected?.qty} 件）</label>
        <input type="number" min="1" max={selected?.qty} className="input" value={outQty} onChange={(e) => setOutQty(e.target.value)} placeholder="0" autoFocus />
      </Modal>
    </div>
  );
}
