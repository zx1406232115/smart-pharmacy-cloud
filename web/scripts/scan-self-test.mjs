// scan-self-test.mjs — EAN-13 解码自测（Node 环境）
// 按 EAN-13 公开编码规范手工生成条码位图 → 交给 ZXing 解码（浏览器端同一解码引擎），
// 验证「药盒条码 → 解码」链路在比赛前可用。
import zxing from '@zxing/library';
const { RGBLuminanceSource, BinaryBitmap, HybridBinarizer, DecodeHintType, MultiFormatReader, BarcodeFormat } = zxing;

// ---- EAN-13 编码规范 ----
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

function ean13CheckDigit(code12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (i % 2 === 0 ? 1 : 3) * Number(code12[i]);
  return (10 - (sum % 10)) % 10;
}

/** 生成 EAN-13 条码位图（模块宽 2px，静区 9 模块），返回 { width, height, data(Uint8Array 灰度) } */
function encodeEan13(code) {
  const digits = String(code).padStart(13, '0');
  const left = digits.slice(1, 7);
  const right = digits.slice(7, 13);
  const parity = PARITY[Number(digits[0])];
  let modules = '101';
  for (let i = 0; i < 6; i++) modules += (parity[i] === 'L' ? L : G)[Number(left[i])];
  modules += '01010';
  for (let i = 0; i < 6; i++) modules += R[Number(right[i])];
  modules += '101';

  const quiet = 9;
  const w = (modules.length + quiet * 2) * 2;
  const h = 100;
  const data = new Uint8Array(w * h).fill(255);
  for (let x = 0; x < modules.length; x++) {
    if (modules[x] === '1') {
      for (let y = 0; y < h; y++) {
        for (let px = 0; px < 2; px++) data[y * w + (quiet + x) * 2 + px] = 0;
      }
    }
  }
  return { width: w, height: h, data };
}

const hint = new Map();
hint.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.ITF, BarcodeFormat.CODE_93, BarcodeFormat.CODABAR]);
const reader = new MultiFormatReader();
reader.setHints(hint); // 必须 setHints 才会初始化各格式 reader

const codes = ['6901028091234', '6901234567892', '4006381333931'];
let pass = 0, fail = 0;
for (const raw of codes) {
  try {
    const code12 = raw.slice(0, 12);
    const check = ean13CheckDigit(code12);
    const full = code12 + check;
    const { width, height, data } = encodeEan13(full);
    const src = new RGBLuminanceSource(data, width, height);
    const bitmap = new BinaryBitmap(new HybridBinarizer(src));
    const result = reader.decode(bitmap);
    const ok = result.getText() === full;
    console.log(`${ok ? '  ✓' : '  ✗'} ${full} → ${result.getText()}${ok ? '' : '（不符）'}`);
    ok ? pass++ : fail++;
  } catch (e) {
    console.log(`  ✗ ${raw} → 解码失败: ${e.message}`);
    fail++;
  }
}
console.log(`\n  自测结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
