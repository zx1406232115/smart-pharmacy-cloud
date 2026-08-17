// smoke.mjs — 端到端冒烟测试（需服务端已在 3001 端口运行；空模板模式）
// 覆盖：REST 核心接口（空数据容错）、硬件 WS 心跳注册、TCP-AT 网关双向通道、
//       调试面板注入、入库登记与货位联动、异常回执容错。
import WebSocket from 'ws';
import net from 'net';
import http from 'http';

const BASE = 'http://127.0.0.1:3001';
const WS_UI = 'ws://127.0.0.1:3001/ws/ui';
const WS_HW = 'ws://127.0.0.1:3001/ws/hardware';
const ok = (name, cond, extra = '') => console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`) || cond;

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) pass++; else fail++;
  ok(name, cond, extra);
};

const get = async (p) => { const r = await fetch(BASE + p); return r.json(); };
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: r.status, data: await r.json() };
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) REST 基础（空模板：无假数据，各端点容错返回）
const kpis = await get('/api/kpis');
check('GET /api/kpis 空模板返回（0 处方）', kpis.total === 0 && kpis.done === 0 && kpis.trends === null, `total=${kpis.total}`);
const slots = await get('/api/slots');
check('GET /api/slots 返回 9 个空闲货位（3层×3列）', slots.length === 9 && slots.every((s) => s.status === 'FREE'), `A-01=${slots[0].coord} C-03=${slots[8].coord}`);
const meta = await get('/api/meta');
check('GET /api/meta 布局为 3×3', meta.layers === 3 && meta.columns === 3 && meta.slotCount === 9, `layers=${meta.layers} columns=${meta.columns}`);
const rec = await get('/api/slots/recommend?qty=10');
check('GET /api/slots/recommend 全空闲时推荐首个货位', !!rec.coord && rec.alternatives.length === 3, `推荐 ${rec.coord}`);
const audits = await get('/api/audits');
check('GET /api/audits 空留档', audits.length === 0);
const alerts = await get('/api/inventory/alerts');
check('GET /api/inventory/alerts 空预警', alerts.expiring.length === 0 && alerts.lowStock.length === 0);

// 2) 硬件 WS 心跳（真实通道自动注册）
const hw = new WebSocket(WS_HW);
await new Promise((r) => hw.on('open', r));
hw.send(JSON.stringify({ deviceId: 'PMC-TEST', type: 'HEARTBEAT', rssi: -52 }));
hw.on('message', (d) => {
  const msg = JSON.parse(d.toString());
  if (msg.cmd === 'DISPENSE_ACTION') {
    const total = msg.slots.reduce((n, s) => n + s.qty, 0);
    setTimeout(() => {
      hw.send(JSON.stringify({ deviceId: 'PMC-TEST', type: 'ACTION_FINISHED', taskId: msg.taskId, dispensedQty: total, status: 'SUCCESS', rssi: -52 }));
    }, 900);
  }
});
await wait(400);
const devs = await get('/api/devices');
const testDev = devs.find((d) => d.deviceId === 'PMC-TEST');
check('硬件 WS 心跳 → PMC-TEST 自动注册并上线', testDev && testDev.online === true && testDev.channel === 'ws', `channel=${testDev?.channel}`);

// 3) 前端 UI 通道
const ui = new WebSocket(WS_UI);
const uiEvents = [];
ui.on('message', (d) => uiEvents.push(JSON.parse(d.toString())));
await new Promise((r) => ui.on('open', r));
await wait(300);
const hello = uiEvents.find((e) => e.type === 'hello');
check('UI WS 收到 hello（含已注册设备台账）', !!hello && Array.isArray(hello.devices) && hello.devices.some((d) => d.deviceId === 'PMC-TEST'), `${hello?.devices?.length} 台设备`);

// 4) 无处方时下发返回明确提示（而非崩溃）
const disp = await post('/api/prescriptions/dispatch', { ids: ['RXID-NONE'] });
check('空队列下发 → 400 明确提示', disp.status === 400 && /处方/.test(disp.data.message || ''), disp.data.message || '');

// 5) 调试面板注入告警（虚拟调试面板能力）
const sim = await post('/api/debug/simulate', { deviceId: 'PMC-TEST', type: 'ALARM', payload: { level: 'WARN', message: '冒烟测试告警' } });
check('POST /api/debug/simulate 注入 ALARM', sim.status === 200);
await wait(300);
const alarmEv = uiEvents.find((e) => e.type === 'alarm' && e.deviceId === 'PMC-TEST');
check('UI 收到 alarm 广播', !!alarmEv, alarmEv?.message);

// 6) 入库登记 + 货位推荐联动（真实业务数据入口）
const inv = await post('/api/inventory', { name: '阿莫西林胶囊', approvalNo: '国药准字H20003263', spec: '0.25g×24粒/盒', batchNo: '20260815C', expDate: '2028-08-15', qty: 12, autoAssign: true });
check('POST 入库登记 → 200 且分配货位', inv.status === 200 && !!inv.data.slot?.coord, `→ ${inv.data.slot?.coord} ${inv.data.message}`);
const slots2 = await get('/api/slots');
check('入库后货位状态联动更新', slots2.find((s) => s.coord === inv.data.slot?.coord)?.status === 'OCCUPIED', inv.data.slot?.coord);
const q = await get(`/api/query?q=${encodeURIComponent('阿莫西林')}`);
check('GET /api/query 检索到新入库药品', q.length >= 1, `${q[0]?.drugName} @ ${q[0]?.coord}`);

// 6.5) 冷启动建档闭环（机器扫 EAN-13 → 查库 → 未建档启动建档 → 确认储药）
const v1 = await post('/api/storage/verify', { barcode: '6901028091234' });
check('扫码查库：未知条码 found=false', v1.status === 200 && v1.data.found === false, v1.data.message);
const reg = await post('/api/storage/register', { barcode: '6901028091234', name: '阿莫西林胶囊', shape: 'box', size: 'large', spec: '0.25g×24粒/盒' });
check('启动建档（名称/形状/尺寸/条码自动录入）', reg.status === 200 && reg.data.drug.barcode === '6901028091234' && reg.data.drug.size === 'large', reg.data.message);
const v2 = await post('/api/storage/verify', { barcode: '6901028091234' });
check('建档后扫码命中', v2.status === 200 && v2.data.found === true && v2.data.drug.name === '阿莫西林胶囊', v2.data.message);
const reg2 = await post('/api/storage/register', { barcode: '6901028091234', name: '重复药', shape: 'box', size: 'medium' });
check('重复建档被拒绝（条码唯一校验）', reg2.status === 409, reg2.data.message);
const cf = await post('/api/storage/confirm', { barcode: '6901028091234', qty: 5 });
check('确认储药 → 按尺寸匹配货位', cf.status === 200 && cf.data.slot.size === 'large', `${cf.data.slot.coord}（${cf.data.slot.size}格）`);
const drugs = await get('/api/drugs');
check('GET /api/drugs 档案列表含新药', drugs.length >= 1 && drugs.some((d) => d.barcode === '6901028091234'), `${drugs.length} 条`);
const recBySize = await get('/api/slots/recommend?qty=3&size=small');
check('货位推荐支持按尺寸过滤', recBySize.size === 'small', `${recBySize.coord}（${recBySize.size}）`);

// 7) TCP-AT 网关（AT 固件模式：无需刷机，TCP 行协议直连）
const tcp = net.connect(3002, '127.0.0.1');
await new Promise((r) => tcp.on('connect', r));
tcp.setEncoding('utf8');
const tcpLines = [];
tcp.on('data', (d) => { for (const l of d.toString().split('\n')) if (l.trim()) tcpLines.push(l.trim()); });
tcp.write(JSON.stringify({ deviceId: 'PMC-TCP01', type: 'HEARTBEAT', rssi: -45 }) + '\n');
await wait(400);
const devs2 = await get('/api/devices');
const tcpDev = devs2.find((d) => d.deviceId === 'PMC-TCP01');
check('TCP-AT 网关注册设备并上线', tcpDev?.online === true && tcpDev?.channel === 'tcp', `channel=${tcpDev?.channel} ip=${tcpDev?.ip}`);

const pong = await post('/api/devices/PMC-TCP01/command', { cmd: 'PING' });
check('PING 指令经 TCP 通道下行', pong.status === 200 && pong.data.sent.mode === 'tcp', pong.data.sent?.mode);
await wait(300);
check('TCP 设备收到下行 PING', tcpLines.some((l) => l.includes('"cmd":"PING"')), tcpLines[0] || '');

const dl = await post('/api/devices/PMC-TCP01/command', { cmd: 'DISPENSE_ACTION', taskId: 'TASK-TCP-DEMO', slots: [{ coord: 'A-01', trayIndex: 1, qty: 2 }] });
check('DISPENSE_ACTION 经 TCP 下行', dl.status === 200 && dl.data.sent.mode === 'tcp');
await wait(400);
check('TCP 收到 DISPENSE_ACTION 指令', tcpLines.some((l) => l.includes('"cmd":"DISPENSE_ACTION"') && l.includes('TASK-TCP-DEMO')));
tcp.write(JSON.stringify({ deviceId: 'PMC-TCP01', type: 'ACTION_FINISHED', taskId: 'TASK-TCP-DEMO', dispensedQty: 2, status: 'SUCCESS' }) + '\n');
await wait(300);
tcp.end();

// 8) 未知任务回执容错（不崩溃）
const unknown = await post('/api/devices/PMC-TEST/command', { cmd: 'DISPENSE_ACTION', taskId: 'TASK-NOPE', slots: [{ coord: 'B-01', trayIndex: 9, qty: 1 }] });
check('向在线设备下发指令成功（回执未知任务不崩溃）', unknown.status === 200);

// 9) 摄像头 MJPEG 代理（假 ESP32-CAM 流：multipart/x-mixed-replace）
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
const fakeCam = http.createServer((req, res) => {
  if (req.url === '/stream') {
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Connection': 'keep-alive' });
    const iv = setInterval(() => {
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${JPEG.length}\r\n\r\n`);
      res.write(JPEG);
      res.write('\r\n');
    }, 80);
    req.on('close', () => clearInterval(iv));
  } else { res.writeHead(404); res.end(); }
});
await new Promise((r) => fakeCam.listen(18081, '127.0.0.1', r));

const camAdd = await post('/api/cameras', { ip: '127.0.0.1', port: 18081, purpose: 'scan', name: '冒烟测试摄像头' });
check('接入摄像头（用户提供 IP）', camAdd.status === 200 && !!camAdd.data.camera.id, camAdd.data.camera?.id);
const camId = camAdd.data.camera.id;
await wait(600);
const camList = await get('/api/cameras');
const camLive = camList.cameras.find((c) => c.id === camId);
check('摄像头收到 MJPEG 流并在线', camLive?.online === true, `lastFrameAt=${camLive?.lastFrameAt ? '有帧' : '无帧'}`);
const frameRes = await fetch(`http://127.0.0.1:3001/api/cameras/${camId}/frame`);
const frameBuf = Buffer.from(await frameRes.arrayBuffer());
check('GET /frame 返回 JPEG 帧', frameRes.status === 200 && frameBuf.length > 4 && frameBuf[0] === 0xff && frameBuf[1] === 0xd8, `${frameBuf.length} 字节`);
const streamRes = await fetch(`http://127.0.0.1:3001/api/cameras/${camId}/stream`);
check('GET /stream 输出 multipart 流', (streamRes.headers.get('content-type') || '').includes('multipart/x-mixed-replace'));
const reader = streamRes.body.getReader();
const first = await reader.read();
const firstText = Buffer.from(first.value).toString('latin1');
check('流内含边界帧头', firstText.includes('--frame') && firstText.includes('Content-Length'));
await reader.cancel();
const camDel = await fetch(`http://127.0.0.1:3001/api/cameras/${camId}`, { method: 'DELETE' });
check('删除摄像头', camDel.status === 200);
fakeCam.close();

console.log(`\n  冒烟结果：${pass} 通过 / ${fail} 失败\n`);
hw.close(); ui.close();
process.exit(fail ? 1 : 0);
