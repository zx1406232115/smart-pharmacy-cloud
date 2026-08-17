// snapshotSvg.js — 生成"出药口高清抓拍"Mock 快照（确定性随机，同一 seed 画面一致）
function hashSeed(seed) {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function snapshotDataUri(seed, drugName, capturedAt) {
  const rnd = mulberry32(hashSeed(seed ?? 1));
  const colors = ['#818CF8', '#34D399', '#FBBF24', '#FB7185', '#38BDF8', '#C084FC'];
  const boxes = 2 + Math.floor(rnd() * 3);
  let parts = '';
  for (let i = 0; i < boxes; i++) {
    const bx = 36 + rnd() * 420;
    const by = 64 + rnd() * 210;
    const bw = 96 + rnd() * 150;
    const bh = 56 + rnd() * 44;
    const rot = ((rnd() - 0.5) * 16).toFixed(1);
    const pillsN = 2 + Math.floor(rnd() * 3);
    let pills = '';
    for (let j = 0; j < pillsN; j++) {
      const px = bx + 12 + rnd() * (bw - 44);
      const py = by + 12 + rnd() * (bh - 24);
      const pw = 30 + rnd() * 30;
      const ph = 11 + rnd() * 7;
      const c = colors[Math.floor(rnd() * colors.length)];
      pills += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" rx="${(ph / 2).toFixed(1)}" fill="${c}" opacity="0.92"/>`;
    }
    parts += `<g transform="rotate(${rot} ${bx + bw / 2} ${by + bh / 2})">
      <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="8" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.16)"/>
      ${pills}
      <rect x="${(bx + 6).toFixed(1)}" y="${(by + bh - 16).toFixed(1)}" width="34" height="10" rx="3" fill="rgba(255,255,255,0.10)"/>
    </g>`;
  }
  const time = capturedAt
    ? new Date(capturedAt).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f172a"/><stop offset="0.55" stop-color="#1e1b4b"/><stop offset="1" stop-color="#312e81"/>
    </linearGradient>
    <radialGradient id="light" cx="0.75" cy="0.2" r="0.9">
      <stop offset="0" stop-color="rgba(255,255,255,0.16)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="4" fill="none"/><rect y="2" width="4" height="1" fill="rgba(255,255,255,0.03)"/>
    </pattern>
  </defs>
  <rect width="640" height="400" fill="url(#bg)"/>
  <rect width="640" height="400" fill="url(#light)"/>
  <rect x="24" y="24" width="592" height="352" rx="12" fill="none" stroke="rgba(255,255,255,0.14)"/>
  ${parts}
  <rect width="640" height="400" fill="url(#scan)"/>
  <rect x="24" y="24" width="14" height="14" fill="rgba(129,140,248,0.9)"/>
  <text x="46" y="37" font-family="ui-monospace,monospace" font-size="13" fill="rgba(255,255,255,0.75)">REC ● CAM-01 · 出药口抓拍</text>
  <rect x="602" y="24" width="14" height="14" fill="rgba(52,211,153,0.9)"/>
  <text x="46" y="366" font-family="ui-monospace,monospace" font-size="13" fill="rgba(255,255,255,0.6)">${esc(drugName)}</text>
  <text x="600" y="366" text-anchor="end" font-family="ui-monospace,monospace" font-size="13" fill="rgba(255,255,255,0.6)">${esc(time)}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
