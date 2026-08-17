// debug-barcode2.mjs — 定位 ZXing 失效条件
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
const code12 = '690123456789';
const m = mods(code12, 2);
const total = m.length + QUIET * 2;

function decode(g, w, h, pure) {
  const src = new RGBLuminanceSource(Int32Array.from(g), w, h);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  if (pure) hints.set(DecodeHintType.PURE_BARCODE, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  try { return reader.decode(new BinaryBitmap(new HybridBinarizer(src))).getText(); } catch { return null; }
}

for (const mw of [0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 3, 4]) {
  const bw = Math.round(total * mw);
  const bh = 80;
  // 场景1：tight（条码占满画面，无多余白边）
  {
    const W = bw + 4, H = bh + 4;
    const g = new Float32Array(W * H).fill(255);
    for (let y = 2; y < 2 + bh; y++) {
      for (let x = 2; x < 2 + bw; x++) {
        const mi = Math.floor(((x - 2) / bw) * total) - QUIET;
        if (mi >= 0 && mi < m.length && m[mi] === '1') g[y * W + x] = 0;
      }
    }
    const r = decode(g, W, H, false);
    const p = decode(g, W, H, true);
    console.log(`mw=${String(mw).padEnd(4)} tight: normal=${r ? '✓' : '✗'} pure=${p ? '✓' : '✗'}`);
  }
  // 场景2：条码放在 320x240 中间
  if (bw < 300) {
    const W = 320, H = 240;
    const g = new Float32Array(W * H).fill(255);
    const x0 = Math.floor((W - bw) / 2);
    const y0 = Math.floor((H - bh) / 2);
    for (let y = y0; y < y0 + bh; y++) {
      for (let x = x0; x < x0 + bw; x++) {
        const mi = Math.floor(((x - x0) / bw) * total) - QUIET;
        if (mi >= 0 && mi < m.length && m[mi] === '1') g[y * W + x] = 0;
      }
    }
    const r = decode(g, W, H, false);
    const p = decode(g, W, H, true);
    console.log(`mw=${String(mw).padEnd(4)} 320x240: normal=${r ? '✓' : '✗'} pure=${p ? '✓' : '✗'}`);
  }
}
