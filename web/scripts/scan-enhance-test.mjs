// scan-enhance-test.mjs — 端到端验证：真实摄像头帧 → ZXing 解码（原图 vs 增强）
import { createRequire } from 'module';
const require = createRequire('E:/ruisahtml/package.json');
const jpeg = require('jpeg-js');
const { MultiFormatReader, DecodeHintType, BarcodeFormat, RGBLuminanceSource, BinaryBitmap, HybridBinarizer } = require('@zxing/library');

function makeHints() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.ITF]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
}

function decodeLum(lum, w, h) {
  const src = new RGBLuminanceSource(lum, w, h);
  const bmp = new BinaryBitmap(new HybridBinarizer(src));
  const reader = new MultiFormatReader();
  reader.setHints(makeHints());
  try {
    const r = reader.decode(bmp);
    return r.getText();
  } catch {
    return null;
  }
}

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

/** 模拟前端 enhanceForScan：中央 2x 裁剪 → 放大2x → 灰度 → unsharp → 对比拉伸 */
function enhance(data, w, h, zoom = 2, sharpen = 2.0) {
  const cw = Math.floor(w / zoom);
  const ch = Math.floor(h / zoom);
  const sx = Math.floor((w - cw) / 2);
  const sy = Math.floor((h - ch) / 2);
  // 裁剪 + 2x 最近邻放大
  const outW = cw * 2;
  const outH = ch * 2;
  const crop = new Float32Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    const syy = sy + (y >> 1);
    for (let x = 0; x < outW; x++) {
      const sxx = sx + (x >> 1);
      const i = (syy * w + sxx) * 4;
      crop[y * outW + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
  }
  const blur = boxBlur(crop, outW, outH, 2);
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < crop.length; i++) {
    let v = crop[i] + sharpen * (crop[i] - blur[i]);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    crop[i] = v;
  }
  const range = hi - lo || 1;
  const out = new Float32Array(outW * outH);
  for (let i = 0; i < crop.length; i++) {
    out[i] = Math.max(0, Math.min(255, ((crop[i] - lo) / range) * 255));
  }
  return { lum: out, w: outW, h: outH };
}

/** Otsu 二值化后的 0/255 亮度图 */
function binarize(lum, w, h) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < lum.length; i++) hist[Math.round(lum[i])]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let maxVar = -1;
  const total = w * h;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; best = t; }
  }
  const out = new Int32Array(lum.length);
  for (let i = 0; i < lum.length; i++) out[i] = lum[i] > best ? 255 : 0;
  return out;
}

async function main() {
  for (let k = 1; k <= 5; k++) {
    const res = await fetch(`http://127.0.0.1:3001/api/cameras/CAM-001/frame?t=${Date.now()}`);
    if (!res.ok) { console.log(`frame ${k}: HTTP ${res.status}`); await new Promise((r) => setTimeout(r, 1200)); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const img = jpeg.decode(buf, { useTArray: true });
    const w = img.width;
    const h = img.height;
    const gray = toGray(img.data, w, h);
    const rawLum = Int32Array.from(gray);
    const raw = decodeLum(rawLum, w, h);
    const en = enhance(img.data, w, h);
    const enh = decodeLum(Int32Array.from(en.lum), en.w, en.h);
    const bin = decodeLum(binarize(en.lum, en.w, en.h), en.w, en.h);
    console.log(`frame ${k} (${w}x${h}): raw=${raw ? 'HIT ' + raw : '-'}  enhanced=${enh ? 'HIT ' + enh : '-'}  binarized=${bin ? 'HIT ' + bin : '-'}`);
    if (k === 3) {
      // 保存增强图供检查
      const rgba = Buffer.alloc(en.w * en.h * 4);
      for (let i = 0; i < en.w * en.h; i++) { rgba[i * 4] = en.lum[i]; rgba[i * 4 + 1] = en.lum[i]; rgba[i * 4 + 2] = en.lum[i]; rgba[i * 4 + 3] = 255; }
      const enc = jpeg.encode({ data: rgba, width: en.w, height: en.h }, 92);
      require('fs').writeFileSync('E:/ruisahtml/enhanced_test.jpg', enc.data);
      console.log('  saved enhanced_test.jpg');
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
