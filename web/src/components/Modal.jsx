// Modal.jsx — 通用弹窗（毛玻璃遮罩 + 圆角卡片 + 动画）
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, subtitle, width = 'max-w-lg', children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 animate-fade-in bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className={`card relative flex max-h-[90vh] w-full ${width} animate-fade-up flex-col shadow-soft-lg`}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 pb-4 pt-5">
          <div>
            <h3 className="text-base font-bold tracking-tight text-slate-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
