// Badge.jsx — 语义状态徽章（Emerald/Sky/Amber/Rose/Indigo/Slate）
const TONES = {
  emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  sky: 'bg-sky-50 text-sky-600 border-sky-100',
  amber: 'bg-amber-50 text-amber-600 border-amber-100',
  rose: 'bg-rose-50 text-rose-600 border-rose-100',
  indigo: 'bg-brand-50 text-indigo-600 border-indigo-100',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
};

export default function Badge({ tone = 'slate', dot = false, children, className = '' }) {
  return (
    <span className={`chip ${TONES[tone] || TONES.slate} ${className}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
