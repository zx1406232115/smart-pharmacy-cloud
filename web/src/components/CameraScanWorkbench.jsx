// components/CameraScanWorkbench.jsx — 摄像头扫码工作台
// 从摄像头视频流（服务端代理 /api/cameras/:id/frame）中识别条形码，
// 双解码引擎：优先浏览器原生 BarcodeDetector（Android/ChromeOS 等可用时），
// 兜底 ZXing 纯 JS 解码（Windows/macOS Chrome/Edge 等，任何浏览器可用）。
// 连续 3 帧一致判定命中 → 自动注入 StorageFlow（查库 → 建档 → 确认储药）。
import { useEffect, useRef, useState } from 'react';
import { ScanLine, Video, Play, Square, RotateCcw, WifiOff, Cpu } from 'lucide-react';
import { BrowserCodeReader } from '@zxing/browser';
import { MultiFormatReader, DecodeHintType, BarcodeFormat } from '@zxing/library';
import Badge from './Badge.jsx';
import StorageFlow from './StorageFlow.jsx';

const FORMATS = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'code_93', 'codabar'];

/** 盒式模糊（两遍一维滑动平均，近似高斯） */
function boxBlur(g, w, h, radius) {
  const tmp = new Float32Array(g.length);
  const out = new Float32Array(g.length);
  const win = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = 0; x < win; x++) sum += g[row + Math.min(x, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      const add = Math.min(x + radius + 1, w - 1);
      const sub = Math.max(x - radius, 0);
      sum += g[row + add] - g[row + sub];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < win; y++) sum += tmp[Math.min(y, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      const add = Math.min(y + radius + 1, h - 1);
      const sub = Math.max(y - radius, 0);
      sum += tmp[add * w + x] - tmp[sub * w + x];
    }
  }
  return out;
}

/** 灰度图 → ImageBitmap（可选 scale 倍最近邻放大；1.5x 可绕开 ZXing 对整数像素宽条码的解码怪癖） */
async function grayToBitmap(g, w, h, scale = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const id = ctx.createImageData(w, h);
  const d = id.data;
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(0, Math.min(255, Math.round(g[i])));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  if (scale !== 1) {
    const big = document.createElement('canvas');
    big.width = Math.round(w * scale);
    big.height = Math.round(h * scale);
    const bctx = big.getContext('2d');
    bctx.imageSmoothingEnabled = false; // 最近邻，保持锐利边缘
    bctx.drawImage(canvas, 0, 0, big.width, big.height);
    return createImageBitmap(big);
  }
  return createImageBitmap(canvas);
}

/** 反锐化掩膜（就地）：g = g + amt*(g - blur(g)) */
function unsharpInPlace(g, w, h, amount = 2.0, radius = 2) {
  const blur = boxBlur(g, w, h, radius);
  for (let i = 0; i < g.length; i++) g[i] = g[i] + amount * (g[i] - blur[i]);
}

/** CLAHE 式分块对比度增强（8×8 块、2%/98% 分位裁剪、双线性插值）
 *  对光照不均的条码区域比全局直方图均衡更稳 */
function claheLite(g, w, h, tiles = 8) {
  const tw = Math.max(8, Math.floor(w / tiles));
  const th = Math.max(8, Math.floor(h / tiles));
  const cols = Math.ceil(w / tw);
  const rows = Math.ceil(h / th);
  const lo = new Float32Array(cols * rows).fill(255);
  const hi = new Float32Array(cols * rows).fill(0);
  const hist = new Array(256);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      hist.fill(0);
      const x0 = tx * tw;
      const x1 = Math.min(w, x0 + tw);
      const y0 = ty * th;
      const y1 = Math.min(h, y0 + th);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) hist[Math.round(g[y * w + x])]++;
      }
      const n = (x1 - x0) * (y1 - y0) || 1;
      const tLow = n * 0.02;
      const tHigh = n * 0.98;
      let acc = 0;
      let low = 0;
      let high = 255;
      for (let i = 0; i < 256; i++) {
        acc += hist[i];
        if (acc <= tLow) low = i;
        if (acc <= tHigh) high = i;
      }
      lo[ty * cols + tx] = low;
      hi[ty * cols + tx] = high;
    }
  }
  const map = (v, l, h2) => Math.max(0, Math.min(255, ((v - l) / (h2 - l || 1)) * 255));
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = y / th - 0.5;
    const cy = Math.max(0, Math.min(rows - 1, Math.floor(fy)));
    const wy = Math.max(0, Math.min(1, fy - cy));
    const y0 = cy;
    const y1 = Math.min(rows - 1, cy + 1);
    for (let x = 0; x < w; x++) {
      const fx = x / tw - 0.5;
      const cx = Math.max(0, Math.min(cols - 1, Math.floor(fx)));
      const wx = Math.max(0, Math.min(1, fx - cx));
      const x0 = cx;
      const x1 = Math.min(cols - 1, cx + 1);
      const v = g[y * w + x];
      const m00 = map(v, lo[y0 * cols + x0], hi[y0 * cols + x0]);
      const m10 = map(v, lo[y0 * cols + x1], hi[y0 * cols + x1]);
      const m01 = map(v, lo[y1 * cols + x0], hi[y1 * cols + x0]);
      const m11 = map(v, lo[y1 * cols + x1], hi[y1 * cols + x1]);
      const top = m00 + (m10 - m00) * wx;
      const bot = m01 + (m11 - m01) * wx;
      out[y * w + x] = top + (bot - top) * wy;
    }
  }
  return out;
}

/** Sauvola 自适应二值化（积分图加速）：局部均值+标准差动态阈值，抗光照不均 */
function sauvola(g, w, h, win = 15, k = 0.2) {
  const sum = new Float64Array((w + 1) * (h + 1));
  const sq = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let rs = 0;
    let rq = 0;
    for (let x = 1; x <= w; x++) {
      const v = g[(y - 1) * w + (x - 1)];
      rs += v;
      rq += v * v;
      sum[y * (w + 1) + x] = sum[(y - 1) * (w + 1) + x] + rs;
      sq[y * (w + 1) + x] = sq[(y - 1) * (w + 1) + x] + rq;
    }
  }
  const out = new Float32Array(w * h);
  const r = Math.floor(win / 2);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const n = (y1 - y0) * (x1 - x0);
      const s = sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
      const q = sq[y1 * (w + 1) + x1] - sq[y0 * (w + 1) + x1] - sq[y1 * (w + 1) + x0] + sq[y0 * (w + 1) + x0];
      const m = s / n;
      const variance = Math.max(0, q / n - m * m);
      const std = Math.sqrt(variance);
      const t = m * (1 + k * (std / 128 - 1));
      out[y * w + x] = g[y * w + x] > t ? 255 : 0;
    }
  }
  return out;
}

/** 生成多路解码候选（全幅处理，不裁剪）：
 *  enhanced   = 全幅 → 反锐化 → CLAHE 对比度增强（灰度）
 *  binarized  = 全幅 → 增强后 Sauvola 自适应二值化（纯黑白）
 *  binarized15= 二值化 + 1.5× 最近邻放大（绕开 ZXing 对整数像素宽条码的解码怪癖）
 *  定焦摄像头近距离失焦时，锐化+二值化可显著提高 ZXing 对模糊条码的识别率 */
async function buildScanCandidates(src, sharpenAmount = 1.0) {
  const W = src.width;
  const H = src.height;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  }
  unsharpInPlace(g, W, H, sharpenAmount);
  const enh = claheLite(g, W, H);
  const bin = sauvola(enh, W, H);
  return [
    { name: 'enhanced', bitmap: await grayToBitmap(enh, W, H, 1) },
    { name: 'binarized', bitmap: await grayToBitmap(bin, W, H, 1) },
    { name: 'binarized15', bitmap: await grayToBitmap(bin, W, H, 1.5) },
  ];
}

export default function CameraScanWorkbench({ cam, onClose, onStored }) {
  // engine: 'init' 初始化中 | 'native' BarcodeDetector | 'zxing' 纯 JS 解码 | null 不可用
  const [engine, setEngine] = useState('init');
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('准备就绪');
  const [injected, setInjected] = useState('');
  const [streamBroken, setStreamBroken] = useState(false);
  const [streamKey, setStreamKey] = useState(0);

  const scanRef = useRef(false);
  const lastCodeRef = useRef('');
  const matchRef = useRef(0);
  const nativeDetectorRef = useRef(null);
  const zxingReaderRef = useRef(null);
  const binCanvasRef = useRef(null); // 解码画面（二值化）预览

  // 初始化解码引擎
  useEffect(() => {
    let alive = true;
    if ('BarcodeDetector' in window) {
      new BarcodeDetector({ formats: FORMATS })
        .then((d) => {
          if (!alive) return;
          nativeDetectorRef.current = d;
          setEngine('native');
        })
        .catch(() => { if (alive) initZxing(); });
    } else {
      initZxing();
    }
    function initZxing() {
      try {
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39,
          BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.ITF, BarcodeFormat.CODE_93, BarcodeFormat.CODABAR,
        ]);
        const reader = new MultiFormatReader();
        reader.setHints(hints); // 必须 setHints 才会初始化各格式 reader
        zxingReaderRef.current = new BrowserCodeReader(reader, { delayBetweenScanAttempts: 50 });
        if (alive) setEngine('zxing');
      } catch {
        if (alive) setEngine(null);
      }
    }
    return () => { alive = false; };
  }, []);

  // 关闭时停止扫码
  useEffect(() => () => { scanRef.current = false; }, []);

  /** 统一解码入口：ImageBitmap → 条码文本（无则 null） */
  const decodeFrame = async (bmp) => {
    if (engine === 'native' && nativeDetectorRef.current) {
      const codes = await nativeDetectorRef.current.detect(bmp);
      return codes.length ? codes[0].rawValue : null;
    }
    if (engine === 'zxing' && zxingReaderRef.current) {
      try {
        const r = await zxingReaderRef.current.decodeFromImageBitmap(bmp);
        return r ? r.getText() : null;
      } catch {
        return null; // NotFoundException 等：未识别
      }
    }
    return null;
  };

  const tick = async () => {
    if (!scanRef.current) return;
    try {
      const res = await fetch(`/api/cameras/${cam.id}/frame?t=${Date.now()}`);
      if (!res.ok) throw new Error('no frame');
      const blob = await res.blob();
      if (blob.size > 64 && engine !== 'init') {
        const bmp = await createImageBitmap(blob);
        // 多通道解码：增强图 → 二值图 → 原图，逐路尝试
        let text = null;
        let hitChan = '';
        try {
          const cands = await buildScanCandidates(bmp);
          // 把二值化候选画到"解码画面"小窗（识别器视角）
          const binCv = binCanvasRef.current;
          if (binCv && cands[1]) {
            const b = cands[1].bitmap;
            if (binCv.width !== b.width) binCv.width = b.width;
            if (binCv.height !== b.height) binCv.height = b.height;
            binCv.getContext('2d').drawImage(b, 0, 0);
          }
          for (const c of cands) {
            const t = await decodeFrame(c.bitmap);
            c.bitmap.close?.();
            if (t) { text = t; hitChan = c.name; break; }
          }
        } catch { /* 增强失败：退回原图 */ }
        if (!text) {
          const t = await decodeFrame(bmp);
          if (t) { text = t; hitChan = 'raw'; }
        }
        if (text) {
          if (text === lastCodeRef.current) matchRef.current += 1;
          else { lastCodeRef.current = text; matchRef.current = 1; }
          setScanMsg(`识别到条码 ${text}（${hitChan} 通道，连续 ${matchRef.current}/3）`);
          if (matchRef.current >= 3) {
            scanRef.current = false;
            setScanning(false);
            setInjected(text);
            setScanMsg(`条码已锁定：${text} —— 请核对下方储药信息`);
            return;
          }
        } else {
          matchRef.current = 0;
          lastCodeRef.current = '';
          setScanMsg('画面中未发现条码，请将药盒条码对准摄像头（保持静止、光线充足）…');
        }
      } else {
        setScanMsg('等待画面…');
      }
    } catch {
      setScanMsg('正在获取画面…');
    }
    setTimeout(tick, 300);
  };

  const startScan = () => {
    if (engine !== 'native' && engine !== 'zxing') return;
    setInjected('');
    matchRef.current = 0;
    lastCodeRef.current = '';
    scanRef.current = true;
    setScanning(true);
    setScanMsg('正在识别…请将药盒条码对准摄像头');
    tick();
  };

  const stopScan = () => {
    scanRef.current = false;
    setScanning(false);
    setScanMsg('已暂停');
  };

  const continueScan = () => {
    setInjected('');
    matchRef.current = 0;
    lastCodeRef.current = '';
    scanRef.current = true;
    setScanning(true);
    tick();
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {/* 左：视频流 */}
      <div>
        <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
          <img
            key={streamKey}
            src={`/api/cameras/${cam.id}/stream?t=${streamKey}`}
            alt="摄像头画面"
            className="aspect-[4/3] w-full object-cover"
            onError={() => setStreamBroken(true)}
            onLoad={() => setStreamBroken(false)}
          />
          {/* 扫码框 */}
          {scanning && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative h-36 w-56">
                <span className="absolute left-0 top-0 h-8 w-8 rounded-tl-lg border-l-2 border-t-2 border-emerald-400" />
                <span className="absolute right-0 top-0 h-8 w-8 rounded-tr-lg border-r-2 border-t-2 border-emerald-400" />
                <span className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-lg border-b-2 border-l-2 border-emerald-400" />
                <span className="absolute bottom-0 right-0 h-8 w-8 rounded-br-lg border-b-2 border-r-2 border-emerald-400" />
                <span className="absolute left-2 right-2 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-emerald-400/80" />
              </div>
            </div>
          )}
          <div className="absolute left-3 top-3 flex items-center gap-2">
            <Badge tone={scanning ? 'emerald' : 'slate'} dot>
              {scanning ? '扫码中' : '已暂停'}
            </Badge>
            {streamBroken && (
              <Badge tone="rose"><WifiOff size={10} /> 画面中断</Badge>
            )}
          </div>
          <div className="absolute bottom-3 left-3 right-3">
            <p className="rounded-lg bg-slate-900/80 px-3 py-1.5 text-[11px] text-slate-300 backdrop-blur">
              <Video size={11} className="mr-1 inline text-slate-500" />
              {cam.name} · {cam.ip}:{cam.port}/stream · {scanMsg}
            </p>
          </div>
        </div>

        {/* 解码画面：识别器视角（增强 + 二值化后的中央区域） */}
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <p className="text-[11px] font-semibold text-slate-500">
              解码画面 <span className="font-normal text-slate-400">（识别器视角 · 全幅锐化 + 二值化）</span>
            </p>
            {scanning ? (
              <Badge tone="emerald" dot>实时处理中</Badge>
            ) : (
              <Badge tone="slate" dot>未在识别</Badge>
            )}
          </div>
          <canvas
            ref={binCanvasRef}
            width={160}
            height={120}
            className="aspect-[4/3] w-full bg-slate-50"
          />
        </div>

        {/* 控制 */}
        <div className="mt-3 flex items-center gap-2">
          {!scanning ? (
            <button className="btn-primary flex-1" onClick={startScan} disabled={engine !== 'native' && engine !== 'zxing' || !!injected}>
              <Play size={14} /> 开始扫码识别
            </button>
          ) : (
            <button className="btn-outline flex-1" onClick={stopScan}>
              <Square size={13} /> 暂停识别
            </button>
          )}
          {injected && (
            <button className="btn-soft flex-1" onClick={continueScan}>
              <RotateCcw size={13} /> 继续扫下一盒
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1">
            <Cpu size={11} className="text-indigo-400" />
            解码引擎：
          </span>
          {engine === 'init' && <Badge tone="sky" dot>初始化中…</Badge>}
          {engine === 'native' && <Badge tone="emerald" dot>BarcodeDetector（原生）</Badge>}
          {engine === 'zxing' && <Badge tone="indigo" dot>ZXing（纯 JS 解码）</Badge>}
          {engine === null && <Badge tone="rose" dot>解码引擎不可用</Badge>}
          <span>· 连续 3 帧一致才锁定，防误扫</span>
        </div>
        {engine === null && (
          <p className="mt-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] text-rose-600">
            解码引擎加载失败，请刷新页面重试。
          </p>
        )}
      </div>

      {/* 右：储药流程（识别结果自动注入） */}
      <div className="flex flex-col">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-slate-700">
          <ScanLine size={15} className="text-indigo-500" />
          扫码储药流程
          {injected && <Badge tone="emerald">已锁定条码 {injected}</Badge>}
        </div>
        <StorageFlow injectedBarcode={injected} onStored={() => onStored?.(cam)} compact />
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
          识别到条码后自动查询网页档案：已建档 → 直接确认储药入库；未建档 → 补全名称/形状/尺寸后建档，再次扫码即可命中。
        </p>
        <p className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
          扫码技巧：摄像头为定焦镜头，药盒请与镜头保持 <b>30~50cm</b> 距离并静止 1~2 秒，光线充足时识别率最高；系统已自动做画面放大+锐化增强。
        </p>
      </div>
    </div>
  );
}
