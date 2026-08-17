// debug-barcode.mjs — 定位 mw=2 干净条码解码失败的原因
import { createRequire } from 'module';
const require = createRequire('E:/ruisahtml/package.json');
const { RGBLuminanceSource, BinaryBitmap, HybridBinarizer, GlobalHistogramBinarizer, DecodeHintType, MultiFormatReader, BarcodeFormat, EAN13Reader } = require('@zxing/library');

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const QUIET = 9;
function modules(code12, check) {
  const digits = code12 + check;
  const left = digits.slice(1, 7), right = digits.slice(7, 13);
  const parity = PARITY[Number(digits[0])];
  let m = '101';
  for (let i = 0; i < 6; i++) m += (parity[i] === 'L' ? L : G)[Number(left[i])];
  m += '01010';
  for (let i = 0; i < 6; i++) m += R[Number(right[i])];
  return m + '101';
}

const code12 = '690123456789';
const check = 2;
const mods = modules(code12, check);
const total = mods.length + QUIET * 2;
console.log('modules len:', mods.length, 'total:', total);

for (const mw of [1, 1.5, 2, 2.5]) {
  const W = 320, H = 240;
  const bw = Math.round(total * mw);
  const x0 = Math.floor((W - bw) / 2);
  const y0 = Math.floor((H - 70) / 2);
  const g = new Float32Array(W * H).fill(255);
  for (let y = y0; y < y0 + 70; y++) {
    for (let x = x0; x < x0 + bw; x++) {
      const mi = Math.floor(((x - x0) / bw) * total) - QUIET;
      if (mi >= 0 && mi < mods.length && mods[mi] === '1') g[y * W + x] = 0;
    }
  }
  // 中间行黑/白游程
  const row = 120;
  const runs = [];
  let cur = g[row * W + 0] < 128 ? 0 : 1;
  let len = 0;
  for (let x = 0; x < W; x++) {
    const v = g[row * W + x] < 128 ? 0 : 1;
    if (v === cur) len++;
    else { runs.push([cur, len]); cur = v; len = 1; }
  }
  runs.push([cur, len]);
  const barRuns = runs.filter((r) => r[0] === 0).map((r) => r[1]);
  console.log(`\nmw=${mw} bw=${bw}: 黑条游程(${barRuns.length}条): ${barRuns.slice(0, 12).join(',')}...`);

  // 多种解码方式
  const src = new RGBLuminanceSource(Int32Array.from(g), W, H);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  for (const [name, binarizer] of [['Hybrid', () => new HybridBinarizer(src)], ['Global', () => new GlobalHistogramBinarizer(src)]]) {
    try {
      const reader = new MultiFormatReader();
      reader.setHints(hints);
      const r = reader.decode(new BinaryBitmap(binarizer()));
      console.log(`  ${name}: ✓ ${r.getText()}`);
    } catch (e) {
      console.log(`  ${name}: ✗ ${e.message ? e.message.split('\n')[0] : e}`);
    }
  }
}
