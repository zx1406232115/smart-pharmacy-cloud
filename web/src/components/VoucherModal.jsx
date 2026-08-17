// VoucherModal.jsx — 取药凭证生成弹窗（CODE128 一维条码 + 二维码 + 打印预览/下载）
import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { QRCodeCanvas } from 'qrcode.react';
import { Printer, Download, Barcode, QrCode, Package } from 'lucide-react';
import Modal from './Modal.jsx';
import Badge from './Badge.jsx';
import { fmtFullDate } from '../lib/format.js';

export default function VoucherModal({ prescription, onClose }) {
  const [tab, setTab] = useState('barcode');
  const barcodeRef = useRef(null);
  const qrRef = useRef(null);
  const code = prescription.no;
  const qrPayload = JSON.stringify({
    type: 'DISPENSE_VOUCHER',
    no: prescription.no,
    taskId: prescription.taskId || '',
    patient: prescription.patient,
    items: prescription.items.map((i) => ({ name: i.name, spec: i.spec, qty: i.qty })),
    totalQty: prescription.totalQty,
    issuedAt: new Date().toISOString(),
  });

  useEffect(() => {
    if (tab === 'barcode' && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, code, {
          format: 'CODE128',
          width: 2,
          height: 74,
          displayValue: true,
          font: 'monospace',
          fontSize: 13,
          margin: 12,
          background: '#ffffff',
          lineColor: '#0f172a',
        });
      } catch { /* 码值异常时忽略 */ }
    }
  }, [tab, code]);

  const download = (canvas, name) => {
    const url = canvas?.toDataURL('image/png');
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="取药凭证生成"
      subtitle={`${prescription.no} · ${prescription.patient} · 生成于 ${fmtFullDate(Date.now())}`}
      width="max-w-md"
      footer={
        <>
          <button className="btn-outline" onClick={() => (tab === 'barcode' ? download(barcodeRef.current, `${code}-CODE128.png`) : download(qrRef.current?.querySelector('canvas'), `${code}-QR.png`))}>
            <Download size={15} /> 下载 PNG
          </button>
          <button className="btn-primary" onClick={() => window.print()}>
            <Printer size={15} /> 打印凭证
          </button>
        </>
      }
    >
      <div className="print-area">
        {/* 凭证内容 */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between border-b border-dashed border-slate-200 pb-3">
            <div>
              <p className="text-[13px] font-bold tracking-tight text-slate-900">智能药柜 · 取药凭证</p>
              <p className="mt-0.5 text-[10px] text-slate-400">Smart Cabinet Dispense Voucher</p>
            </div>
            <Badge tone="indigo">任务 {prescription.taskId || '未下发'}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 py-3 text-xs">
            <p className="text-slate-400">取药人</p>
            <p className="text-right font-medium text-slate-800">{prescription.patient}</p>
            <p className="text-slate-400">药品品种</p>
            <p className="text-right font-medium text-slate-800">{prescription.items.length} 种 / {prescription.totalQty} 件</p>
            <p className="text-slate-400">涉及货位</p>
            <p className="text-right font-medium text-slate-800">{prescription.route.length ? prescription.route.join(' · ') : prescription.items.map((i) => i.slotCoord).join(' · ')}</p>
          </div>

          <div className="mb-3 space-y-1 rounded-lg bg-slate-50 p-3">
            {prescription.items.map((it, i) => (
              <div key={i} className="flex items-center justify-between text-[11px]">
                <span className="flex min-w-0 items-center gap-1.5 text-slate-700">
                  <Package size={11} className="shrink-0 text-slate-400" />
                  <span className="truncate">{it.name}</span>
                  <span className="shrink-0 text-slate-400">{it.spec}</span>
                </span>
                <span className="shrink-0 font-semibold text-slate-800">×{it.qty}</span>
              </div>
            ))}
          </div>

          {/* 码区 */}
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4">
            <div className="mb-2 flex items-center justify-center gap-1 rounded-lg bg-slate-50 p-0.5">
              {[
                { key: 'barcode', label: '一维条码 CODE128', icon: Barcode },
                { key: 'qrcode', label: '二维码', icon: QrCode },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-all ${
                    tab === t.key ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <t.icon size={12} /> {t.label}
                </button>
              ))}
            </div>
            <div className="flex justify-center py-2">
              {tab === 'barcode' ? (
                <canvas ref={barcodeRef} />
              ) : (
                <div ref={qrRef} className="rounded-lg border border-slate-100 p-2">
                  <QRCodeCanvas value={qrPayload} size={184} level="M" fgColor="#0f172a" />
                </div>
              )}
            </div>
            <p className="text-center text-[10px] text-slate-400">扫码校验取药信息 · 请妥善保管凭证</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
