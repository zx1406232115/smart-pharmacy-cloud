// components/StorageFlow.jsx — 扫码储药闭环（verify → 建档 → 确认储药）
// 可独立使用（手动输入条码），也可由外部注入条码自动查询（如摄像头扫码识别）。
import { useEffect, useRef, useState } from 'react';
import {
  ScanBarcode, FilePlus2, PackageCheck, Search, Package, Boxes, PackagePlus, XCircle,
} from 'lucide-react';
import Badge from './Badge.jsx';
import { api } from '../lib/api.js';
import { useAppStore } from '../store/useAppStore.js';
import { SHAPE_LABEL, SIZE_LABEL, SIZE_SHORT } from '../lib/format.js';

const sizeOptions = [
  { key: 'large', label: '大', desc: '90~120mm' },
  { key: 'medium', label: '中', desc: '50~90mm' },
  { key: 'small', label: '小', desc: '10~50mm' },
];

export default function StorageFlow({ injectedBarcode = '', autoLookup = true, onStored, compact = false }) {
  const toast = useAppStore((s) => s.toast);

  const [barcode, setBarcode] = useState('');
  const [verify, setVerify] = useState(null);      // { found, barcode, drug?, message }
  const [checking, setChecking] = useState(false);
  const [regForm, setRegForm] = useState({ name: '', shape: 'box', size: 'medium', spec: '', approvalNo: '' });
  const [registering, setRegistering] = useState(false);
  const [storeQty, setStoreQty] = useState(1);
  const [storing, setStoring] = useState(false);
  const [confirmResult, setConfirmResult] = useState(null);
  const consumedRef = useRef('');

  // 外部注入条码（如摄像头识别）→ 自动查询
  useEffect(() => {
    if (autoLookup && injectedBarcode && injectedBarcode !== consumedRef.current) {
      consumedRef.current = injectedBarcode;
      setBarcode(injectedBarcode);
      lookup(injectedBarcode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedBarcode]);

  // ① 扫码查库
  const lookup = async (code) => {
    const c = String(code ?? barcode).trim();
    if (!c) return;
    setChecking(true);
    setConfirmResult(null);
    try {
      setVerify(await api.post('/storage/verify', { barcode: c }));
    } catch (e) {
      toast({ tone: 'rose', title: '查询失败', desc: e.message });
    } finally {
      setChecking(false);
    }
  };

  // ② 启动建档
  const register = async () => {
    if (!verify?.barcode) return;
    setRegistering(true);
    try {
      const r = await api.post('/storage/register', { barcode: verify.barcode, ...regForm });
      toast({ tone: 'emerald', title: r.message, desc: `${SHAPE_LABEL[r.drug.shape]} · ${SIZE_LABEL[r.drug.size]}` });
      setVerify({ found: true, drug: r.drug, message: r.message });
      onStored?.(r);
    } catch (e) {
      toast({ tone: 'rose', title: '建档失败', desc: e.message });
    } finally {
      setRegistering(false);
    }
  };

  // ③ 确认储药
  const confirmStore = async () => {
    if (!verify?.drug) return;
    setStoring(true);
    try {
      const r = await api.post('/storage/confirm', { barcode: verify.drug.barcode, qty: storeQty });
      setConfirmResult(r);
      toast({ tone: 'emerald', title: r.message, desc: `${r.drug.name} → ${r.slot.coord}` });
      onStored?.(r);
    } catch (e) {
      toast({ tone: 'rose', title: '储药失败', desc: e.message });
    } finally {
      setStoring(false);
    }
  };

  const reset = () => {
    setBarcode('');
    setVerify(null);
    setConfirmResult(null);
    setRegForm({ name: '', shape: 'box', size: 'medium', spec: '', approvalNo: '' });
    consumedRef.current = '';
  };

  return (
    <div className={compact ? '' : 'rounded-2xl border border-slate-200/70 bg-white p-5 shadow-soft'}>
      {/* 条码输入（扫码枪自动回车触发查询） */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9 font-mono"
          placeholder="扫描或输入商品条码（13 位）后回车"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }}
          disabled={!!verify}
        />
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn-primary flex-1" onClick={() => lookup()} disabled={checking || !barcode.trim() || !!verify}>
          <Search size={14} /> {checking ? '查询中…' : '查询网页档案'}
        </button>
        {verify && (
          <button className="btn-ghost" onClick={reset} title="重新查询">
            <XCircle size={15} />
          </button>
        )}
      </div>

      {/* 查询结果 */}
      {verify && (
        <div className="mt-4 animate-fade-up">
          {verify.found ? (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[13.5px] font-bold text-slate-900">
                    <PackageCheck size={15} className="text-emerald-500" /> {verify.drug.name}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">条码 {verify.drug.barcode}</p>
                </div>
                <Badge tone="emerald">已建档</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone="indigo">{SHAPE_LABEL[verify.drug.shape] || '—'}</Badge>
                <Badge tone="sky">{SIZE_LABEL[verify.drug.size] || '—'}</Badge>
                {verify.drug.spec && verify.drug.spec !== '—' && <Badge tone="slate">{verify.drug.spec}</Badge>}
              </div>
              <div className="mt-3 flex items-end gap-2">
                <div className="flex-1">
                  <label className="label">储药数量</label>
                  <input type="number" min="1" className="input" value={storeQty} onChange={(e) => setStoreQty(Number(e.target.value) || 1)} />
                </div>
                <button className="btn-primary flex-1" onClick={confirmStore} disabled={storing}>
                  <PackagePlus size={14} /> {storing ? '入库中…' : '确认储药入库'}
                </button>
              </div>
              {confirmResult && (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-xs">
                  <p className="font-semibold text-emerald-600">✓ {confirmResult.message}</p>
                  <p className="mt-1 text-slate-500">
                    {confirmResult.drug.name} × {confirmResult.record.qty} → 货位
                    <span className="mx-1 rounded bg-brand-50 px-1.5 py-0.5 font-mono font-semibold text-indigo-600">{confirmResult.slot.coord}</span>
                    （{SIZE_SHORT[confirmResult.slot.size]}格）· 批号 {confirmResult.record.batchNo}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
              <p className="flex items-center gap-2 text-[13.5px] font-bold text-slate-900">
                <FilePlus2 size={15} className="text-amber-500" /> 该条码未建档 —— 启动建档
              </p>
              <p className="mt-1 text-xs text-slate-500">{verify.message}，请补全以下信息：</p>

              <div className="mt-3 space-y-3">
                <div>
                  <label className="label">商品码（扫码自动录入，用于校验）</label>
                  <input className="input bg-slate-50 font-mono" value={verify.barcode} readOnly />
                </div>
                <div>
                  <label className="label">药品名称 <span className="text-rose-400">*</span></label>
                  <input className="input" value={regForm.name} onChange={(e) => setRegForm((f) => ({ ...f, name: e.target.value }))} placeholder="如：阿莫西林胶囊" />
                </div>
                <div>
                  <label className="label">形状 <span className="text-rose-400">*</span></label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'box', label: '盒装', icon: Package },
                      { key: 'bottle', label: '瓶装', icon: Boxes },
                    ].map((o) => (
                      <button
                        key={o.key}
                        onClick={() => setRegForm((f) => ({ ...f, shape: o.key }))}
                        className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-all ${
                          regForm.shape === o.key ? 'border-indigo-400 bg-brand-50 text-indigo-600 ring-4 ring-indigo-500/10' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        <o.icon size={15} /> {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label">尺寸（药盒最长边） <span className="text-rose-400">*</span></label>
                  <div className="grid grid-cols-3 gap-2">
                    {sizeOptions.map((o) => (
                      <button
                        key={o.key}
                        onClick={() => setRegForm((f) => ({ ...f, size: o.key }))}
                        className={`rounded-xl border px-2 py-2.5 text-center transition-all ${
                          regForm.size === o.key ? 'border-indigo-400 bg-brand-50 ring-4 ring-indigo-500/10' : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <p className={`text-[13px] font-bold ${regForm.size === o.key ? 'text-indigo-600' : 'text-slate-700'}`}>{o.label}</p>
                        <p className="mt-0.5 text-[10px] text-slate-400">{o.desc}</p>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10.5px] text-slate-400">机器将按尺寸放入对应格位（A 层大格 / B 层中格 / C 层小格）</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">规格（可选）</label>
                    <input className="input" value={regForm.spec} onChange={(e) => setRegForm((f) => ({ ...f, spec: e.target.value }))} placeholder="0.25g×24粒/盒" />
                  </div>
                  <div>
                    <label className="label">国药准字（可选）</label>
                    <input className="input" value={regForm.approvalNo} onChange={(e) => setRegForm((f) => ({ ...f, approvalNo: e.target.value }))} placeholder="国药准字H…" />
                  </div>
                </div>
                <button className="btn-primary w-full" onClick={register} disabled={registering || !regForm.name.trim()}>
                  <FilePlus2 size={14} /> {registering ? '建档中…' : '确认建档'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!verify && !compact && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
          <ScanBarcode size={12} /> 扫码枪/摄像头识别到的条码将自动带入并查询
        </p>
      )}
    </div>
  );
}
