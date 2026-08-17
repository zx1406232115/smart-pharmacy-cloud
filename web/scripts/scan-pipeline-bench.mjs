// scan-pipeline-bench.mjs — 增强管线解码极限验证（修正版）
// 两个场景：
//   A. 纯白底 + 条码（验证处理链本身不破坏条码）
//   B. 真实摄像头帧 + 合成条码（贴近实际）
// 每个场景测不同模块宽度 × 失焦模糊半径，对比 raw / enhanced / binarized 通道。
import { createRequire } from 'module';
const require = createRequire('E:/ruisahtml/package.json');
const jpeg = require('jpeg-js');
const { RGBLuminanceSource, BinaryBitmap, HybridBinarizer, DecodeHintType, MultiFormatReader, BarcodeFormat } = require('@zxing/library');

// ---- EAN-13 编码 ----
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function ean13CheckDigit(code12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (i % 2 === 0 ? 1 : 3) * Number(code12[i]);
  return (10 - (sum % 10)) % 10;
}
const QUIET = 9;
function eanModules(code12, check) {
  const digits = code12 + check;
  const left = digits.slice(1, 7);
  const right = digits.slice(7, 13);
  const parity = PARITY[Number(digits[0])];
  let m = '101';
  for (let i = 0; i < 6; i++) m += (parity[i] === 'L' ? L : G)[Number(left[i])];
  m += '01010';
  for (let i = 0; i < 6; i++) m += R[Number(right[i])];
  m += '101';
  return m; // 95 模块（不含静区）
}

function makeHints() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.ITF]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
}
function tryDecode(g, w, h) {
  const src = new RGBLuminanceSource(Int32Array.from(g), w, h);
  const bmp = new BinaryBitmap(new HybridBinarizer(src));
  const reader = new MultiFormatReader();
  reader.setHints(makeHints());
  try { return reader.decode(bmp).getText(); } catch { return null; }
}

// ---- 图像处理（与前端相同） ----
function toGray(data, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return g;
}
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
function unsharp(g, w, h, amount, radius) {
  const blur = boxBlur(g, w, h, radius);
  const out = new Float32Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = g[i] + amount * (g[i] - blur[i]);
  return out;
}
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
      const x0 = tx * tw, x1 = Math.min(w, x0 + tw), y0 = ty * th, y1 = Math.min(h, y0 + th);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[Math.round(g[y * w + x])]++;
      const n = (x1 - x0) * (y1 - y0) || 1;
      let acc = 0, low = 0, high = 255;
      for (let i = 0; i < 256; i++) {
        acc += hist[i];
        if (acc <= n * 0.02) low = i;
        if (acc <= n * 0.98) high = i;
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
    const y0 = cy, y1 = Math.min(rows - 1, cy + 1);
    for (let x = 0; x < w; x++) {
      const fx = x / tw - 0.5;
      const cx = Math.max(0, Math.min(cols - 1, Math.floor(fx)));
      const wx = Math.max(0, Math.min(1, fx - cx));
      const x0 = cx, x1 = Math.min(cols - 1, cx + 1);
      const v = g[y * w + x];
      const m00 = map(v, lo[y0 * cols + x0], hi[y0 * cols + x0]);
      const m10 = map(v, lo[y0 * cols + x1], hi[y0 * cols + x1]);
      const m01 = map(v, lo[y1 * cols + x0], hi[y1 * cols + x0]);
      const m11 = map(v, lo[y1 * cols + x1], hi[y1 * cols + x1]);
      out[y * w + x] = (m00 + (m10 - m00) * wx) + ((m01 + (m11 - m01) * wx) - (m00 + (m10 - m00) * wx)) * wy;
    }
  }
  return out;
}
function sauvola(g, w, h, win = 15, k = 0.2) {
  const sum = new Float64Array((w + 1) * (h + 1));
  const sq = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    let rs = 0, rq = 0;
    for (let x = 1; x <= w; x++) {
      const v = g[(y - 1) * w + (x - 1)];
      rs += v; rq += v * v;
      sum[y * (w + 1) + x] = sum[(y - 1) * (w + 1) + x] + rs;
      sq[y * (w + 1) + x] = sq[(y - 1) * (w + 1) + x] + rq;
    }
  }
  const out = new Float32Array(w * h);
  const r = Math.floor(win / 2);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const n = (y1 - y0) * (x1 - x0);
      const s = sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
      const q = sq[y1 * (w + 1) + x1] - sq[y0 * (w + 1) + x1] - sq[y1 * (w + 1) + x0] + sq[y0 * (w + 1) + x0];
      const m = s / n;
      const variance = Math.max(0, q / n - m * m);
      out[y * w + x] = g[y * w + x] > m * (1 + k * (Math.sqrt(variance) / 128 - 1)) ? 255 : 0;
    }
  }
  return out;
}
function centerCrop(g, w, h) {
  const cw = Math.floor(w / 2), ch = Math.floor(h / 2);
  const sx = Math.floor((w - cw) / 2), sy = Math.floor((h - ch) / 2);
  const out = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) out[y * cw + x] = g[(sy + y) * w + (sx + x)];
  return { g: out, w: cw, h: ch };
}
/** 把条码画到帧中央（白底衬垫模拟白色药盒 + 静区），返回新帧 */
function drawBarcode(frame, W, H, modules, mw, bh) {
  const total = modules.length + QUIET * 2;
  const bw = Math.round(total * mw);
  const x0 = Math.floor((W - bw) / 2);
  const y0 = Math.floor((H - bh) / 2);
  const out = new Float32Array(frame);
  if (bw >= W || bh >= H) return out;
  // 白底衬垫（药盒区域）
  const pad = 8;
  for (let y = Math.max(0, y0 - pad); y < Math.min(H, y0 + bh + pad); y++) {
    for (let x = Math.max(0, x0 - pad); x < Math.min(W, x0 + bw + pad); x++) out[y * W + x] = 245;
  }
  // 黑条
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const mi = Math.floor((x / bw) * total) - QUIET;
      if (mi >= 0 && mi < modules.length && modules[mi] === '1') out[(y0 + y) * W + (x0 + x)] = 10;
    }
  }
  return out;
}

function cropGray(g, w, h, sx, sy, cw, ch) {
  const out = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) out[y * cw + x] = g[(sy + y) * w + (sx + x)];
  return out;
}

/** 最近邻放大 scale 倍（模拟前端 grayToBitmap 的 1.5x 变体） */
function nearestScale(g, w, h, scale) {
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);
  const out = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) out[y * nw + x] = g[Math.min(h - 1, Math.floor(y / scale)) * w + Math.min(w - 1, Math.floor(x / scale))];
  }
  return { g: out, w: nw, h: nh };
}

function benchOne(g, W, H, label) {
  const raw = tryDecode(g, W, H);
  // 与前端 buildScanCandidates 相同的双尺度候选
  const variants = [
    { name: 'center2x', sx: Math.floor(W / 4), sy: Math.floor(H / 4), cw: Math.floor(W / 2), ch: Math.floor(H / 2) },
    { name: 'full', sx: 0, sy: 0, cw: W, ch: H },
  ];
  const out = {};
  for (const v of variants) {
    const cg = cropGray(g, W, H, v.sx, v.sy, v.cw, v.ch);
    const us = unsharp(cg, v.cw, v.ch, 2.0, 2);
    const enh = claheLite(us, v.cw, v.ch);
    const bin = sauvola(enh, v.cw, v.ch);
    const bin15 = nearestScale(bin, v.cw, v.ch, 1.5);
    out[`${v.name}-enhanced`] = !!tryDecode(enh, v.cw, v.ch);
    out[`${v.name}-binarized`] = !!tryDecode(bin, v.cw, v.ch);
    out[`${v.name}-binarized15`] = !!tryDecode(bin15.g, bin15.w, bin15.h);
  }
  const hit = !!raw || Object.values(out).some(Boolean);
  console.log(`  ${label}: raw=${raw ? '✓' : '✗'} c2x-enh=${out['center2x-enhanced'] ? '✓' : '✗'} c2x-bin=${out['center2x-binarized'] ? '✓' : '✗'} c2x-b15=${out['center2x-binarized15'] ? '✓' : '✗'} f-enh=${out['full-enhanced'] ? '✓' : '✗'} f-bin=${out['full-binarized'] ? '✓' : '✗'} f-b15=${out['full-binarized15'] ? '✓' : '✗'}${hit ? '  → HIT' : ''}`);
  return { raw: !!raw, ...out };
}

async function main() {
  const cams = await (await fetch('http://127.0.0.1:3001/api/cameras')).json();
  if (!cams.cameras?.length) throw new Error('no cameras');
  const camId = cams.cameras[0].id;
  const res = await fetch(`http://127.0.0.1:3001/api/cameras/${camId}/frame?t=${Date.now()}`);
  if (!res.ok) throw new Error(`frame HTTP ${res.status}`);
  const img = jpeg.decode(Buffer.from(await res.arrayBuffer()), { useTArray: true });
  const W = img.width, H = img.height;
  const base = toGray(img.data, W, H);
  const code12 = '690123456789';
  const check = ean13CheckDigit(code12);
  const full = code12 + check;
  const modules = eanModules(code12, check);
  console.log(`基准帧 ${W}x${H}，测试条码 ${full}`);

  console.log('\n[A] 纯白底对照（处理链 sanity check）:');
  const white = new Float32Array(W * H).fill(255);
  for (const mw of [1, 1.5, 2, 2.5]) {
    const f = drawBarcode(white, W, H, modules, mw, 70);
    benchOne(f, W, H, `white mw=${mw} blur=0`);
  }

  console.log('\n[B] 真实帧合成（每格：模块宽 mw × 模糊半径 blur）:');
  const results = {};
  for (const mw of [1, 1.5, 2, 2.5]) {
    for (const br of [0, 1, 2, 3]) {
      const f = drawBarcode(base, W, H, modules, mw, 70);
      const blurred = br > 0 ? boxBlur(f, W, H, br) : f;
      const r = benchOne(blurred, W, H, `real mw=${mw} blur=${br}`);
      results[`${mw}-${br}`] = r;
    }
  }
  const count = (field) => Object.values(results).filter((r) => r[field]).length;
  const total = Object.keys(results).length;
  const anyHit = Object.values(results).filter((r) => Object.values(r).some(Boolean)).length;
  console.log(`\n汇总（真实帧 ${total} 组合）: raw=${count('raw')} c2x-enh=${count('center2x-enhanced')} c2x-bin=${count('center2x-binarized')} full-enh=${count('full-enhanced')} full-bin=${count('full-binarized')}`);
  console.log(`综合命中（任一通道成功）: ${anyHit}/${total}`);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
