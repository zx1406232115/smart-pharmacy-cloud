// routes.js — REST API
// 覆盖四大业务（取药/储药/查询/货位）与两大运维视图（设备/审计）所需接口。
import { Router } from 'express';
import os from 'os';
import { buildDispatch } from './protocol.js';
import { snakeSort, coordsToRoute, nextId, todayStr, daysUntil, randInt, pinyinCode, pad3, SIZE_LABEL, SHAPE_LABEL } from './state.js';

export function createRouter(ctx) {
  const { db, devices, hub, cameras } = ctx;
  const router = Router();

  // ---------------- 总览 KPI ----------------
  router.get('/kpis', (req, res) => {
    const pres = db.prescriptions;
    const occupied = db.slots.filter((s) => s.status !== 'FREE');
    const alarmsToday = db.devices.reduce((n, d) => n + d.alarms.filter((a) => todayStr(new Date(a.at)) === db.today).length, 0);
    const onlineDevs = devices.list().filter((d) => d.online);
    res.json({
      total: pres.length,
      done: pres.filter((p) => p.status === 'DONE').length,
      queued: pres.filter((p) => p.status === 'QUEUED').length,
      running: pres.filter((p) => p.status === 'DISPENSING').length,
      blocked: pres.filter((p) => p.status === 'BLOCKED').length,
      dispensedQty: pres.filter((p) => p.status === 'DONE').reduce((n, p) => n + p.totalQty, 0),
      avgCycle: Math.round(onlineDevs.reduce((n, d) => n + d.avgCycleMs, 0) / Math.max(1, onlineDevs.length)),
      accuracy: onlineDevs.length ? onlineDevs.reduce((n, d) => n + d.accuracy, 0) / onlineDevs.length : 0,
      occupancy: Math.round((occupied.length / db.slots.length) * 100),
      expiring: occupied.filter((s) => s.status === 'WARNING').length,
      lowStock: occupied.filter((s) => s.qty < 5).length,
      onlineDevices: onlineDevs.length,
      totalDevices: db.devices.length,
      alarmsToday,
      todayJobs: onlineDevs.reduce((n, d) => n + d.todayJobs, 0),
      trends: db.kpiTrends,
      dispenseByHour: db.dispenseByHour,
    });
  });

  // ---------------- 取药管理 ----------------
  router.get('/prescriptions', (req, res) => {
    const { status, q } = req.query;
    let list = db.prescriptions;
    if (status && status !== 'ALL') list = list.filter((p) => p.status === status);
    if (q) {
      const kw = String(q).trim().toLowerCase();
      list = list.filter((p) => p.no.toLowerCase().includes(kw) || p.patient.includes(kw) || (p.taskId || '').toLowerCase().includes(kw));
    }
    res.json(list.slice().sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : statusOrder(a.status) - statusOrder(b.status))));
  });

  const statusOrder = (s) => ({ DISPENSING: 0, QUEUED: 1, BLOCKED: 2, DONE: 3 }[s] ?? 9);

  /** 批量下发取药任务到硬件（支持单条 requeue） */
  const dispatchPrescriptions = (ids) => {
    const targets = ids.map((id) => db.prescriptions.find((p) => p.id === id)).filter(Boolean);
    const queued = targets.filter((p) => p.status === 'QUEUED' || p.status === 'BLOCKED');
    if (!queued.length) return { error: { status: 400, message: '所选处方均不处于可下发状态（待执行/已拦截）' } };
    const device = devices.pickForTask();
    if (!device) return { error: { status: 409, message: '无在线设备：请检查硬件连接，或在【设备运维】中开启虚拟仿真' } };

    const results = [];
    for (const p of queued) {
      const taskId = `TASK-${db.today}-${String(db.counters.task++).padStart(3, '0')}`;
      const slots = snakeSort(p.items.map((it) => ({ coord: it.slotCoord, trayIndex: it.trayIndex, qty: it.qty })));
      p.status = 'DISPENSING';
      p.taskId = taskId;
      p.deviceId = device.deviceId;
      p.startedAt = Date.now();
      p.route = slots.map((s) => s.coord);
      p.note = `已按设备侧路径最短重排执行：${coordsToRoute(p.route)}`;
      const payload = buildDispatch(taskId, slots);
      const sent = hub.sendToDevice(device.deviceId, payload);
      if (!sent) {
        p.status = 'QUEUED';
        p.taskId = null;
        p.startedAt = null;
        results.push({ id: p.id, no: p.no, ok: false, message: '设备通道不可用，任务已回退到队列' });
        continue;
      }
      results.push({ id: p.id, no: p.no, ok: true, taskId, deviceId: device.deviceId, mode: sent.mode, note: p.note });
      hub.broadcast('task.dispatched', { prescription: p });
      hub.logEvent('task.dispatched', `下发任务 ${taskId} → ${device.deviceId}`, { detail: `${p.no} · ${p.items.length} 个品种 · ${p.route.length} 个货位`, tone: 'indigo' });
    }
    return { results };
  };

  router.post('/prescriptions/dispatch', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 20) : [];
    if (!ids.length) return res.status(400).json({ message: '请选择待下发的处方' });
    const { results, error } = dispatchPrescriptions(ids);
    if (error) return res.status(error.status).json({ message: error.message });
    res.json({ ok: true, message: `已下发 ${results.filter((r) => r.ok).length} 个任务`, results });
  });

  router.post('/prescriptions/:id/requeue', (req, res) => {
    const { results, error } = dispatchPrescriptions([req.params.id]);
    if (error) return res.status(error.status).json({ message: error.message });
    res.json({ ok: true, message: `已重新下发 ${results.filter((r) => r.ok).length} 个任务`, results });
  });

  router.get('/prescriptions/:id', (req, res) => {
    const p = db.prescriptions.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ message: '处方不存在' });
    res.json(p);
  });

  // ---------------- 储药管理 ----------------
  // ---- 药品档案（扫码建档：机器扫 EAN-13 → 查库 → 未建档则建档）----
  router.get('/drugs', (req, res) => {
    const { q } = req.query;
    let list = db.drugs;
    if (q) {
      const kw = String(q).trim().toLowerCase();
      list = list.filter((d) => d.name.toLowerCase().includes(kw) || (d.barcode || '').includes(kw));
    }
    res.json(list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  });

  /** 删除药品档案（清理误建档/测试数据） */
  router.delete('/drugs/:id', (req, res) => {
    const idx = db.drugs.findIndex((d) => d.id === req.params.id);
    if (idx < 0) return res.status(404).json({ message: '药品档案不存在' });
    const [drug] = db.drugs.splice(idx, 1);
    hub.logEvent('drug.remove', `删除药品档案 ${drug.name}`, { detail: `条码 ${drug.barcode || '—'}`, tone: 'slate' });
    res.json({ ok: true, message: `已删除 ${drug.name}` });
  });

  /** ① 扫码查库（机器扫 EAN-13 后询问网页） */
  router.post('/storage/verify', (req, res) => {
    const barcode = String(req.body?.barcode || '').trim();
    if (!barcode) return res.status(400).json({ message: '缺少条码 barcode' });
    const drug = db.drugs.find((d) => d.barcode === barcode);
    if (!drug) return res.json({ found: false, barcode, message: '该条码未建档，请启动建档流程' });
    res.json({ found: true, drug, message: `已识别：${drug.name}` });
  });

  /** ② 启动建档（条码自动录入、唯一校验） */
  router.post('/storage/register', (req, res) => {
    const { barcode, name, shape, size, spec, approvalNo, manufacturer } = req.body || {};
    const code = String(barcode || '').trim();
    const nm = String(name || '').trim();
    if (!code) return res.status(400).json({ message: '缺少商品码 barcode（扫码自动录入）' });
    if (!nm) return res.status(400).json({ message: '请填写药品名称' });
    if (!['box', 'bottle'].includes(shape)) return res.status(400).json({ message: '形状仅支持：盒装 box / 瓶装 bottle' });
    if (!['large', 'medium', 'small'].includes(size)) return res.status(400).json({ message: '尺寸仅支持：large / medium / small' });
    if (db.drugs.some((d) => d.barcode === code)) {
      return res.status(409).json({ message: `商品码 ${code} 已建档（${db.drugs.find((d) => d.barcode === code)?.name}）` });
    }
    const drug = {
      id: `DRG-${pad3(db.drugs.length + 1)}`,
      name: nm,
      pinyin: pinyinCode(nm),
      approvalNo: approvalNo?.trim() || '—',
      spec: spec?.trim() || '—',
      manufacturer: manufacturer?.trim() || '—',
      unit: shape === 'bottle' ? '瓶' : '盒',
      barcode: code,
      shape,
      size,
      createdAt: Date.now(),
    };
    db.drugs.push(drug);
    hub.logEvent('drug.register', `药品建档 ${nm}`, { detail: `条码 ${code} · ${shape === 'box' ? '盒装' : '瓶装'} · ${SIZE_LABEL[size]}`, tone: 'indigo' });
    res.json({ ok: true, drug, message: `建档成功：${nm}（${code}）` });
  });

  /** ③ 储药完成上报（机器放好药后告知网页）→ 按尺寸匹配货位入库 */
  router.post('/storage/confirm', (req, res) => {
    const { barcode, qty = 1, batchNo, expDate } = req.body || {};
    const code = String(barcode || '').trim();
    if (!code) return res.status(400).json({ message: '缺少条码 barcode' });
    const drug = db.drugs.find((d) => d.barcode === code);
    if (!drug) return res.status(404).json({ message: '该条码未建档，请先完成建档（storage/register）' });
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    const batch = String(batchNo || '').trim() || `B${Date.now().toString().slice(-6)}`;
    const exp = expDate || '2030-12-31';

    // 尺寸匹配：优先同尺寸空闲格，其次任意空闲格
    const freeBySize = db.slots.filter((s) => s.status === 'FREE' && s.size === drug.size).sort((a, b) => a.trayIndex - b.trayIndex);
    const freeAny = db.slots.filter((s) => s.status === 'FREE').sort((a, b) => a.trayIndex - b.trayIndex);
    const slot = freeBySize[0] || freeAny[0];
    if (!slot) return res.status(409).json({ message: '无可用货位，请先出库释放' });

    Object.assign(slot, {
      status: daysUntil(exp) < 90 ? 'WARNING' : 'OCCUPIED',
      drugId: drug.id, drugName: drug.name, spec: drug.spec,
      batchNo: batch, qty: n, expDate: exp, updatedAt: Date.now(),
    });
    const record = {
      id: `IN-${db.counters.inventory++}`, drugId: drug.id, drugName: drug.name, spec: drug.spec,
      approvalNo: drug.approvalNo, batchNo: batch, expDate: exp, qty: n, slotCoord: slot.coord,
      operator: '药柜主控', inAt: Date.now(), source: 'storage-confirm',
    };
    db.inventory.unshift(record);
    hub.logEvent('inbound', `扫码储药 ${drug.name} × ${n}`, { detail: `货位 ${slot.coord}（${slot.size}格）· 条码 ${code}`, tone: 'emerald' });
    res.json({
      ok: true, drug, slot, record,
      sizeMatched: freeBySize[0] ? true : false,
      message: `已入库至 ${slot.coord}（${SIZE_LABEL[slot.size]}格）${freeBySize[0] ? '' : ' · 同尺寸格已满，使用其他尺寸格位'}`,
    });
  });

  // ---------------- MaixCam Pro 扫码设备（HTTP 上报，云端联动）----------------
  // 设备端识别到条码后 POST 到这里；服务端查库并把结果推送给网页（储药流程自动带入），
  // 同时把查库结果返回给设备（设备屏幕显示"已建档/未建档"）。
  router.post('/scan/device', (req, res) => {
    const barcode = String(req.body?.barcode || '').trim();
    const device = String(req.body?.device || 'maixcam').trim() || 'maixcam';
    if (!barcode) return res.status(400).json({ message: '缺少条码 barcode' });
    const drug = db.drugs.find((d) => d.barcode === barcode);
    const found = !!drug;
    db.maixScan = { barcode, device, found, drugName: found ? drug.name : null, at: Date.now() };
    hub.broadcast('scan.received', {
      barcode, source: device, found,
      drugName: found ? drug.name : null,
      at: Date.now(),
    });
    hub.logEvent('scan.received', `${device} 识别条码 ${barcode}`, {
      detail: found ? `已建档：${drug.name}` : '未建档 · 网页端请启动建档流程',
      tone: found ? 'emerald' : 'amber',
    });
    res.json({
      ok: true, found,
      drug: found ? drug : null,
      message: found ? `已识别：${drug.name}` : '该条码未建档，请启动建档流程',
    });
  });

  /** 最近一次扫码 + 心跳（设备状态/网页兜底查询用） */
  router.get('/scan/device/last', (req, res) => {
    res.json({ scan: db.maixScan || null, heartbeat: db.maixHeartbeat || null });
  });

  /** MaixCam 心跳（每 20s 上报一次，用于在线状态显示） */
  router.post('/scan/heartbeat', (req, res) => {
    const device = String(req.body?.device || 'maixcam').trim() || 'maixcam';
    db.maixHeartbeat = { device, at: Date.now() };
    res.json({ ok: true });
  });

  router.get('/inventory', (req, res) => {
    res.json(db.inventory.slice(0, 100));
  });

  /** 入库登记（含智能货位推荐分配） */
  router.post('/inventory', (req, res) => {
    const { name, approvalNo, spec, batchNo, expDate, qty, autoAssign = true, operator = '张药师' } = req.body || {};
    if (!name?.trim() || !batchNo?.trim() || !expDate || !(Number(qty) > 0)) {
      return res.status(400).json({ message: '请完整填写：药品名称、生产批号、有效期、入库数量' });
    }
    const n = Math.floor(Number(qty));
    let drug = db.drugs.find((d) => d.name === name.trim());
    if (!drug) {
      drug = { id: `DRG-${db.drugs.length + 1}`, name: name.trim(), pinyin: pinyinCode(name.trim()), approvalNo: approvalNo?.trim() || `国药准字${String(Math.floor(Math.random() * 9e8))}`, spec: spec?.trim() || '—', manufacturer: '—', unit: '盒', barcode: null, shape: null, size: null, createdAt: Date.now() };
      db.drugs.push(drug);
    }
    let slotCoord = null;
    if (autoAssign) {
      const free = db.slots.filter((s) => s.status === 'FREE').sort((a, b) => a.trayIndex - b.trayIndex);
      // 优先并入同药品已有货位
      const same = db.slots.find((s) => s.status !== 'FREE' && s.drugId === drug.id && s.batchNo === batchNo.trim());
      if (same) slotCoord = same.coord;
      else if (free.length) slotCoord = free[0].coord;
    }
    if (!slotCoord) return res.status(409).json({ message: '无可用货位（可关闭自动分配或先出库释放货位）' });

    const slot = db.slots.find((s) => s.coord === slotCoord);
    const isMerge = slot.status !== 'FREE' && slot.drugId === drug.id && slot.batchNo === batchNo.trim();
    if (isMerge) {
      slot.qty += n;
      slot.expDate = slot.expDate < expDate ? slot.expDate : expDate;
    } else {
      Object.assign(slot, {
        status: daysUntil(expDate) < 90 ? 'WARNING' : 'OCCUPIED', drugId: drug.id, drugName: drug.name,
        spec: drug.spec, batchNo: batchNo.trim(), qty: n, expDate, updatedAt: Date.now(),
      });
    }
    const record = {
      id: `IN-${db.counters.inventory++}`, drugId: drug.id, drugName: drug.name, spec: drug.spec,
      approvalNo: drug.approvalNo, batchNo: batchNo.trim(), expDate, qty: n, slotCoord, operator, inAt: Date.now(),
    };
    db.inventory.unshift(record);
    hub.logEvent('inbound', `入库登记 ${drug.name} × ${n}`, { detail: `货位 ${slotCoord} · 批号 ${batchNo}`, tone: 'emerald' });
    res.json({ ok: true, record, slot, message: isMerge ? `已并入 ${slotCoord} 同批次库存，现存 ${slot.qty} 件` : `已入库至 ${slotCoord}` });
  });

  router.get('/inventory/alerts', (req, res) => {
    const occupied = db.slots.filter((s) => s.status !== 'FREE');
    const expiring = occupied
      .filter((s) => daysUntil(s.expDate) < 90)
      .map((s) => ({ ...s, daysLeft: daysUntil(s.expDate) }))
      .sort((a, b) => a.daysLeft - b.daysLeft);
    const lowStock = occupied.filter((s) => s.qty < 5).sort((a, b) => a.qty - b.qty);
    res.json({ expiring, lowStock });
  });

  // ---------------- 药品查询 ----------------
  router.get('/query', (req, res) => {
    const { q, slot, from, to, pinyin } = req.query;
    const kw = String(q || '').trim().toLowerCase();
    const py = String(pinyin || '').trim().toUpperCase();
    let list = db.slots.filter((s) => s.status !== 'FREE');
    if (kw) list = list.filter((s) => s.drugName.toLowerCase().includes(kw) || s.drugId.toLowerCase().includes(kw) || s.approvalNo?.toLowerCase().includes(kw));
    if (py) list = list.filter((s) => (db.drugs.find((d) => d.id === s.drugId)?.pinyin || '').includes(py));
    if (slot) list = list.filter((s) => s.coord === slot);
    if (from) list = list.filter((s) => s.expDate >= from);
    if (to) list = list.filter((s) => s.expDate <= to);
    res.json(list.map((s) => ({ ...s, daysLeft: daysUntil(s.expDate), approvalNo: db.drugs.find((d) => d.id === s.drugId)?.approvalNo || '—' })));
  });

  // ---------------- 货位管理 ----------------
  router.get('/slots', (req, res) => {
    res.json(db.slots);
  });

  /** 智能货位推荐（可选按尺寸过滤：large / medium / small） */
  router.get('/slots/recommend', (req, res) => {
    const qty = Math.max(1, Number(req.query.qty) || 1);
    const size = ['large', 'medium', 'small'].includes(req.query.size) ? req.query.size : null;
    if (qty > 80) return res.json({ coord: null, reason: '单次入库数量超过货位容量上限（80 件），建议拆分入库', alternatives: [] });
    let free = db.slots.filter((s) => s.status === 'FREE');
    if (!free.length) return res.json({ coord: null, reason: '当前无空闲货位，请先出库释放', alternatives: [] });
    const sizeMatched = size ? free.filter((s) => s.size === size) : [];
    if (size && sizeMatched.length) free = sizeMatched;
    const occupiedIdx = db.slots.filter((s) => s.status !== 'FREE').map((s) => s.trayIndex).sort((a, b) => a - b);
    const median = occupiedIdx.length ? occupiedIdx[Math.floor(occupiedIdx.length / 2)] : 16;
    const ranked = [...free].sort((a, b) => Math.abs(a.trayIndex - median) - Math.abs(b.trayIndex - median) || a.trayIndex - b.trayIndex);
    const best = ranked[0];
    const gap = Math.abs(best.trayIndex - median);
    const sizeNote = size ? `（${SIZE_LABEL[size]}格）` : '';
    const reasons = [
      `该${sizeNote}货位空闲且紧邻高频取药区（距核心区仅 ${gap} 格），机械臂取放路径最短`,
      `该${sizeNote}货位空闲且处于最佳温控区域，适合常规药品存储`,
      `该${sizeNote}货位空闲，靠近同类药品存储区，便于复核盘点与批次管理`,
    ];
    const note = size && !sizeMatched.length ? ' · 同尺寸格已满，降级使用其他尺寸格位' : '';
    res.json({ coord: best.coord, layer: best.layer, col: best.col, size: best.size, reason: reasons[randInt(0, reasons.length - 1)] + note, alternatives: ranked.slice(1, 4).map((s) => s.coord) });
  });

  /** 货位出库登记 */
  router.post('/slots/:coord/outbound', (req, res) => {
    const slot = db.slots.find((s) => s.coord === req.params.coord);
    if (!slot || slot.status === 'FREE') return res.status(404).json({ message: '货位为空或不存在' });
    const n = Math.floor(Number(req.body?.qty) || 0);
    if (!(n > 0) || n > slot.qty) return res.status(400).json({ message: `出库数量需在 1 ~ ${slot.qty} 之间` });
    slot.qty -= n;
    slot.updatedAt = Date.now();
    if (slot.qty === 0) {
      Object.assign(slot, { status: 'FREE', drugId: null, drugName: null, spec: null, batchNo: null, qty: 0, expDate: null });
    }
    hub.logEvent('outbound', `货位 ${slot.coord} 出库 ${n} 件`, { detail: slot.qty > 0 ? `剩余 ${slot.qty} 件` : '货位已释放', tone: 'sky' });
    res.json({ ok: true, slot });
  });

  // ---------------- 设备运维 ----------------
  router.get('/devices', (req, res) => {
    res.json(devices.list().map((d) => devices.public(d)));
  });

  router.get('/devices/:id', (req, res) => {
    const dev = devices.get(req.params.id);
    if (!dev) return res.status(404).json({ message: '设备不存在' });
    res.json(devices.public(dev));
  });

  /** 设备运维：向设备下发任意指令（PING 测试 / DISPENSE_ACTION 等） */
  router.post('/devices/:id/command', (req, res) => {
    const dev = devices.get(req.params.id);
    if (!dev) return res.status(404).json({ message: '设备不存在' });
    const { cmd, ...rest } = req.body || {};
    if (!cmd) return res.status(400).json({ message: '缺少指令 cmd（如 PING / DISPENSE_ACTION）' });
    const payload = { cmd, ...rest, ts: Date.now() };
    const sent = hub.sendToDevice(dev.deviceId, payload);
    if (!sent) {
      return res.status(409).json({ message: '设备不在线（无连接且未开启虚拟仿真）' });
    }
    hub.logEvent('cmd.sent', `下发指令 ${cmd} → ${dev.deviceId}`, { detail: `${sent.mode === 'tcp' ? 'TCP-AT 网关' : sent.mode === 'ws' ? 'WebSocket' : '虚拟仿真'} 通道`, tone: 'indigo' });
    res.json({ ok: true, sent, cmd: payload });
  });

  router.post('/devices/:id/simulator', (req, res) => {
    const dev = devices.setSimulator(req.params.id, Boolean(req.body?.enabled));
    if (!dev) return res.status(404).json({ message: '设备不存在' });
    if (dev.simEnabled) db.simEnabled.add(dev.deviceId); else db.simEnabled.delete(dev.deviceId);
    hub.logEvent('simulator', `${dev.deviceId} 虚拟仿真${dev.simEnabled ? '开启' : '关闭'}`, { tone: dev.simEnabled ? 'emerald' : 'slate' });
    res.json({ ok: true, device: devices.public(dev) });
  });

  router.post('/devices/:id/reboot', (req, res) => {
    const dev = devices.reboot(req.params.id);
    if (!dev) return res.status(404).json({ message: '设备不存在' });
    // 虚拟设备：4s 后自动恢复上线（模拟固件重启）
    setTimeout(() => {
      if (dev.simEnabled) devices.heartbeat(dev.deviceId, { rssi: dev.rssi ?? -60, quiet: true });
    }, 4000);
    res.json({ ok: true, message: `已向 ${dev.deviceId} 下发重启指令` });
  });

  router.get('/devices/:id/events', (req, res) => {
    const dev = devices.get(req.params.id);
    if (!dev) return res.status(404).json({ message: '设备不存在' });
    res.json(dev.alarms);
  });

  // ---------------- 复核审计 ----------------
  router.get('/audits', (req, res) => {
    const { prescriptionNo, from, to, verdict } = req.query;
    let list = db.audits;
    if (prescriptionNo) list = list.filter((a) => a.prescriptionNo.toLowerCase().includes(String(prescriptionNo).toLowerCase()));
    if (verdict && verdict !== 'ALL') list = list.filter((a) => a.verdict === verdict);
    if (from) list = list.filter((a) => todayStr(new Date(a.capturedAt)) >= from);
    if (to) list = list.filter((a) => todayStr(new Date(a.capturedAt)) <= to);
    res.json(list.slice(0, 200));
  });

  // ---------------- 虚拟调试面板（模拟硬件应答）----------------
  router.post('/debug/simulate', (req, res) => {
    const { deviceId, type, payload = {} } = req.body || {};
    if (!deviceId) return res.status(400).json({ message: '缺少 deviceId' });
    const dev = devices.get(deviceId) || devices.setSimulator(deviceId, true);
    if (!dev) return res.status(404).json({ message: '设备不存在' });
    const allowed = ['HEARTBEAT', 'SENSOR_TRIGGERED', 'ACTION_FINISHED', 'ALARM'];
    if (!allowed.includes(type)) return res.status(400).json({ message: `type 仅支持：${allowed.join(' / ')}` });
    const msg = { deviceId, type, rssi: dev.rssi ?? -60, ts: Date.now(), ...payload };
    hub.handleHardwareMessage(deviceId, msg);
    hub.logEvent('debug.inject', `调试面板注入 ${type}`, { detail: `${deviceId} · 虚拟硬件应答`, tone: 'sky' });
    res.json({ ok: true, injected: msg });
  });

  // ---------------- 摄像头管理（ESP32-CAM：用户提供 IP，:81/stream 视频流）----------------
  const CAMERA_PURPOSES = [
    { key: 'scan', label: '扫码（识别条码 → 储药建档）' },
    { key: 'review', label: '取/出药口复核（AI 抓拍对照）' },
    { key: 'monitor', label: '整机监控（实时画面）' },
  ];

  router.get('/cameras', (req, res) => {
    res.json({ cameras: cameras.list(), purposes: CAMERA_PURPOSES });
  });

  router.post('/cameras', (req, res) => {
    const { ip, port, purpose, name } = req.body || {};
    try {
      const cam = cameras.add({ ip, port, purpose, name });
      hub.logEvent('camera.add', `接入摄像头 ${cam.ip}:${cam.port}`, { detail: `${cam.name} · ${CAMERA_PURPOSES.find((p) => p.key === cam.purpose)?.label || cam.purpose}`, tone: 'indigo' });
      res.json({ ok: true, camera: cameras.list().find((c) => c.id === cam.id) });
    } catch (e) {
      res.status(e.status || 500).json({ message: e.message });
    }
  });

  router.delete('/cameras/:id', (req, res) => {
    if (!cameras.get(req.params.id)) return res.status(404).json({ message: '摄像头不存在' });
    cameras.remove(req.params.id);
    hub.logEvent('camera.remove', `移除摄像头 ${req.params.id}`, { tone: 'slate' });
    res.json({ ok: true });
  });

  router.post('/cameras/:id/purpose', (req, res) => {
    const cam = cameras.setPurpose(req.params.id, req.body?.purpose);
    if (!cam) return res.status(400).json({ message: '用途仅支持：scan / review / monitor' });
    res.json({ ok: true, camera: cameras.list().find((c) => c.id === cam.id) });
  });

  /** 视频流代理（multipart/x-mixed-replace，浏览器 <img> 直接播放，解决跨域） */
  router.get('/cameras/:id/stream', (req, res) => {
    if (!cameras.get(req.params.id)) return res.status(404).json({ message: '摄像头不存在' });
    cameras.stream(req.params.id, res);
  });

  /** 最新帧（扫码识别轮询） */
  router.get('/cameras/:id/frame', (req, res) => {
    const buf = cameras.frame(req.params.id);
    if (!buf) return res.status(503).json({ message: '摄像头暂无画面（请检查 IP 与设备供电）' });
    // 定位 JPEG 起始（跳过 MJPEG 边界可能残留的前缀字节）
    const soi = buf.indexOf(Buffer.from([0xff, 0xd8]));
    const jpg = soi > 0 ? buf.slice(soi) : buf;
    res.type('image/jpeg').send(jpg);
  });

  // ---------------- 系统元信息 ----------------
  router.get('/meta', (req, res) => {
    res.json({
      serverTime: Date.now(),
      today: db.today,
      simulator: [...db.simEnabled],
      slotCount: db.slots.length,
      layers: db.slots.length ? Math.max(...db.slots.map((s) => s.layer)) : 0,
      columns: db.slots.length ? Math.max(...db.slots.map((s) => s.col)) : 0,
      // 本机局域网 IPv4 列表（供 ESP-01S 接入使用；ESP 需访问的正是这些地址）
      lanIPs: lanIPv4(),
    });
  });

  return router;
}

/** 枚举本机非回环 IPv4 地址（ESP-01S 局域网接入地址） */
function lanIPv4() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}
