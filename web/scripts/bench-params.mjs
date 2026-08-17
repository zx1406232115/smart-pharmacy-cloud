// bench-params.mjs — 参数扫描：找不破坏干净条码、又能容忍模糊的处理参数
import { createRequire } from 'module';
const require = createRequire('E:/ruisahtml/package.json');
const { RGBLuminanceSource, BinaryBitmap, HybridBinarizer, DecodeHintType, MultiFormatReader, BarcodeFormat } = require('@zxing/library');

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const QUIET = 9;
function mods(code12, check) {
  const digits = code12 + check;
  const left = digits.slice(1, 7), right = digits.slice(7, 13);
  const parity = PARITY[Number(digits[0])];
  let m = '101';
  for (let i = 0; i < 6; i++) m += (parity[i] === 'L' ? L : G)[Number(left[i])];
  m += '01010';
  for (let i = 0; i < 6; i++) m += R[Number(right[i])];
  return m + '101';
}
const m = mods('690123456789', 2);
const total = m.length + QUIET * 2;

function tryDecode(g, w, h) {
  const src = new RGBLuminanceSource(Int32Array.from(g), w, h);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.ITF]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  try { return reader.decode(new BinaryBitmap(new HybridBinarizer(src))).getText(); } catch { return null; }
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
function otsu(g) {
  const hist = new Array(256).fill(0);
  for (const v of g) hist[Math.round(v)]++;
  const n = g.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, maxVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; best = t; }
  }
  return best;
}
function binarize(g, thresh) {
  const out = new Float32Array(g.length);
  for (let i = 0; i < g.length; i++) out[i] = g[i] > thresh ? 255 : 0;
  return out;
}
function sauvola(g, w, h, win, k) {
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
      const mm = s / n;
      const variance = Math.max(0, q / n - mm * mm);
      out[y * w + x] = g[y * w + x] > mm * (1 + k * (Math.sqrt(variance) / 128 - 1)) ? 255 : 0;
    }
  }
  return out;
}
function nearestScale(g, w, h, scale) {
  const nw = Math.round(w * scale), nh = Math.round(h * scale);
  const out = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) out[y * nw + x] = g[Math.min(h - 1, Math.floor(y / scale)) * w + Math.min(w - 1, Math.floor(x / scale))];
  return { g: out, w: nw, h: nh };
}

function drawAt(mw, blurR, W = 320, H = 240) {
  const bw = Math.round(total * mw);
  const bh = 70;
  const g = new Float32Array(W * H).fill(255);
  if (bw < W) {
    const x0 = Math.floor((W - bw) / 2);
    const y0 = Math.floor((H - bh) / 2);
    for (let y = y0; y < y0 + bh; y++) {
      for (let x = x0; x < x0 + bw; x++) {
        const mi = Math.floor(((x - x0) / bw) * total) - QUIET;
        if (mi >= 0 && mi < m.length && m[mi] === '1') g[y * W + x] = 0;
      }
    }
  }
  return blurR > 0 ? boxBlur(g, W, H, blurR) : g;
}

// 参数组合
const configs = [
  { name: 'raw', f: null },
  { name: 'otsu-raw', prep: (g) => binarize(g, otsu(g)) },
  { name: 'otsu-us1.0r1', prep: (g) => binarize(unsharp(g, 320, 240, 1.0, 1), otsu(unsharp(g, 320, 240, 1.0, 1))) },
  { name: 'otsu-us1.5r2', prep: (g) => { const u = unsharp(g, 320, 240, 1.5, 2); return binarize(u, otsu(u)); } },
  { name: 'sauv15k02-us0', prep: (g) => sauvola(g, 320, 240, 15, 0.2) },
  { name: 'sauv31k03-us0', prep: (g) => sauvola(g, 320, 240, 31, 0.3) },
  { name: 'sauv31k03-us1r1', prep: (g) => sauvola(unsharp(g, 320, 240, 1.0, 1), 320, 240, 31, 0.3) },
  { name: 'sauv31k02-us15r2', prep: (g) => sauvola(unsharp(g, 320, 240, 1.5, 2), 320, 240, 31, 0.2) },
  { name: 'bin15-otsu-us1r1', prep: (g) => { const u = unsharp(g, 320, 240, 1.0, 1); const b = binarize(u, otsu(u)); const s = nearestScale(b, 320, 240, 1.5); return s; } },
];

const tests = [
  { label: 'mw1.5 blur0', mw: 1.5, br: 0 },
  { label: 'mw1.5 blur1', mw: 1.5, br: 1 },
  { label: 'mw2 blur0', mw: 2, br: 0 },
  { label: 'mw2.5 blur0', mw: 2.5, br: 0 },
  { label: 'mw2.5 blur1', mw: 2.5, br: 1 },
  { label: 'mw2.5 blur2', mw: 2.5, br: 2 },
  { label: 'mw3 blur1', mw: 3, br: 1 },
  { label: 'mw3 blur2', mw: 3, br: 2 },
];

const header = ['test'].concat(configs.map((c) => c.name)).join(' | ');
console.log(header);
for (const t of tests) {
  const g = drawAt(t.mw, t.br);
  const row = [t.label];
  for (const c of configs) {
    let r = null;
    if (!c.f) r = tryDecode(g, 320, 240);
    else {
      const p = c.prep(g);
      if (p.w) r = tryDecode(p.g, p.w, p.h);
      else r = tryDecode(p, 320, 240);
    }
    row.push(r ? ' ✓ ' : ' ✗ ');
  }
  console.log(row.join(' | '));
}
