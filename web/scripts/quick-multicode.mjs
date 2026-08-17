// quick-multicode.mjs — 多个 EAN 码在 mw=2 / mw=2.5 下的解码表现
import { createRequire } from 'module';
const require = createRequire('E:/ruisahtml/package.json');
const { RGBLuminanceSource, BinaryBitmap, HybridBinarizer, DecodeHintType, MultiFormatReader, BarcodeFormat } = require('@zxing/library');
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function ean13CheckDigit(code12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (i % 2 === 0 ? 1 : 3) * Number(code12[i]);
  return (10 - (sum % 10)) % 10;
}
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
function tryDecode(g, w, h) {
  const src = new RGBLuminanceSource(Int32Array.from(g), w, h);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.ITF]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  try { return reader.decode(new BinaryBitmap(new HybridBinarizer(src))).getText(); } catch { return null; }
}
function draw(code12, check, mw) {
  const m = mods(code12, check);
  const total = m.length + 18;
  const bw = Math.round(total * mw);
  const W = 320, H = 240, bh = 70;
  const g = new Float32Array(W * H).fill(255);
  if (bw < W) {
    const x0 = Math.floor((W - bw) / 2);
    const y0 = Math.floor((H - bh) / 2);
    for (let y = y0; y < y0 + bh; y++) {
      for (let x = x0; x < x0 + bw; x++) {
        const mi = Math.floor(((x - x0) / bw) * total) - 9;
        if (mi >= 0 && mi < m.length && m[mi] === '1') g[y * W + x] = 0;
      }
    }
  }
  return g;
}
const codes = ['690123456789', '400638133393', '690102809123', '692345065771', '695476743219', '978711527946'];
let m2hit = 0, m25hit = 0;
for (const c12 of codes) {
  const check = ean13CheckDigit(c12);
  const full = c12 + check;
  const r2 = tryDecode(draw(c12, check, 2), 320, 240);
  const r25 = tryDecode(draw(c12, check, 2.5), 320, 240);
  console.log(`${full}: mw2=${r2 ? '✓' : '✗'} mw2.5=${r25 ? '✓' : '✗'}`);
  if (r2) m2hit++;
  if (r25) m25hit++;
}
console.log(`\nmw=2: ${m2hit}/${codes.length}   mw=2.5: ${m25hit}/${codes.length}`);
