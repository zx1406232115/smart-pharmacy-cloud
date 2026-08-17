// cameraManager.js — 摄像头管理（ESP32-CAM 类 MJPEG 设备）
// 用户提供摄像头 IP（默认 :81/stream），服务端代理其 MJPEG 流：
//   · 解析 multipart/x-mixed-replace 帧 → 缓存最新帧（供扫码识别轮询）
//   · 把帧实时广播给所有订阅的浏览器（<img> 直接播放，解决跨域）
//   · 断流自动重连；在线状态由"最近帧时间"判定
//   · 摄像头 httpd 对 stream 响应使用 Transfer-Encoding: chunked：
//     必须先把 HTTP 块（chunk）解码还原，再按 Content-Length 切 JPEG 帧，
//     否则块大小行会混入 JPEG 数据造成画面花屏/无法解码
import net from 'net';

const FRAME_TIMEOUT = 15000;     // 超过 15s 无新帧视为离线（低光下自动曝光会拉长帧间隔）
const RECONNECT_MS = 3000;       // 断流重连间隔（初始值）
const MAX_BUFFER = 4 * 1024 * 1024;

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

export class CameraManager {
  constructor(db) {
    this.db = db;
    this.connections = new Map();   // camId -> net.Socket
    this.latestFrames = new Map();   // camId -> { buf, at }
    this.subscribers = new Map();    // camId -> Set<ServerResponse>
    this.reconnectTimers = new Map();// camId -> timeout
    this.watchdogTimers = new Map(); // camId -> timeout（帧超时看门狗）
    this.failCount = new Map();      // camId -> 连续失败次数（重连退避）
    this.frameCount = new Map();     // camId -> 累计帧数（日志用）
    // 启动时自动连接已有摄像头
    for (const cam of db.cameras) this.connect(cam);
  }

  list() {
    const now = Date.now();
    return this.db.cameras.map((c) => {
      const f = this.latestFrames.get(c.id);
      const online = !!f && now - f.at < FRAME_TIMEOUT;
      return { ...c, online, lastFrameAt: f ? f.at : null };
    });
  }

  get(id) {
    return this.db.cameras.find((c) => c.id === id) || null;
  }

  add({ ip, port = 81, purpose = 'monitor', name }) {
    const addr = String(ip || '').trim();
    if (!addr) throw Object.assign(new Error('缺少摄像头 IP'), { status: 400 });
    const cam = {
      id: `CAM-${String(this.db.counters.camera++).padStart(3, '0')}`,
      name: name?.trim() || `摄像头 ${addr}`,
      ip: addr,
      port: Math.max(1, Math.floor(Number(port) || 81)),
      purpose: ['scan', 'review', 'monitor'].includes(purpose) ? purpose : 'monitor',
      createdAt: Date.now(),
    };
    this.db.cameras.push(cam);
    this.connect(cam);
    return cam;
  }

  remove(id) {
    this.db.cameras = this.db.cameras.filter((c) => c.id !== id);
    this.disconnect(id);
    this.latestFrames.delete(id);
    const subs = this.subscribers.get(id);
    if (subs) {
      for (const res of subs) { try { res.end(); } catch { /* noop */ } }
      this.subscribers.delete(id);
    }
  }

  setPurpose(id, purpose) {
    const cam = this.get(id);
    if (!cam) return null;
    if (!['scan', 'review', 'monitor'].includes(purpose)) return null;
    cam.purpose = purpose;
    return cam;
  }

  /** 连接摄像头 MJPEG 流（原始 TCP + HTTP/1.0，规避 httpd chunked 流对 Node HTTP 客户端的兼容问题） */
  connect(cam) {
    if (this.connections.has(cam.id)) return;
    console.log(`[camera] ${cam.id} connecting → ${cam.ip}:${cam.port}/stream`);
    const sock = net.connect(cam.port, cam.ip, () => {
      sock.write(`GET /stream HTTP/1.0\r\nHost: ${cam.ip}\r\n\r\n`);
    });

    let rawBuf = Buffer.alloc(0);   // 原始接收缓冲
    let cleanBuf = Buffer.alloc(0); // chunk 解码后的缓冲（供分帧）
    let headerDone = false;
    let chunked = false;
    let chunkRemaining = -1;        // -1 = 等待下一个块大小行

    const feed = () => {
      // 在 de-chunk 后的数据上按 multipart 分帧（每帧带 Content-Length 头）
      let idx = cleanBuf.indexOf('Content-Length:');
      while (idx >= 0) {
        const lineEnd = cleanBuf.indexOf('\r\n', idx);
        if (lineEnd < 0) break;
        const len = parseInt(cleanBuf.slice(idx + 15, lineEnd).toString().trim(), 10);
        if (!Number.isFinite(len) || len <= 0 || len > MAX_BUFFER) break;
        const headerEnd = cleanBuf.indexOf('\r\n\r\n', lineEnd);
        if (headerEnd < 0) break;
        const bodyStart = headerEnd + 4;
        if (cleanBuf.length < bodyStart + len) break;
        const frame = cleanBuf.slice(bodyStart, bodyStart + len);
        cleanBuf = cleanBuf.slice(bodyStart + len);
        this.onFrame(cam.id, frame);
        idx = cleanBuf.indexOf('Content-Length:');
      }
    };

    sock.on('data', (chunk) => {
      rawBuf = Buffer.concat([rawBuf, chunk]);
      if (rawBuf.length > MAX_BUFFER) rawBuf = rawBuf.slice(-MAX_BUFFER);

      if (!headerDone) {
        const hEnd = rawBuf.indexOf('\r\n\r\n');
        if (hEnd < 0) return;
        const head = rawBuf.slice(0, hEnd).toString('latin1');
        if (!/200/.test(head)) {
          console.error(`[camera] ${cam.id} bad response: ${head.replace(/\r\n/g, ' | ').slice(0, 120)}`);
          sock.destroy();
          return;
        }
        chunked = /transfer-encoding:\s*chunked/i.test(head);
        rawBuf = rawBuf.slice(hEnd + 4);
        headerDone = true;
        if (!chunked) {
          cleanBuf = rawBuf;
          rawBuf = null;
          feed();
          return;
        }
      }

      if (chunked) {
        // HTTP chunked 解码状态机：<hex>\r\n<data>\r\n ...
        while (true) {
          if (chunkRemaining < 0) {
            const lineEnd = rawBuf.indexOf('\r\n');
            if (lineEnd < 0) break;
            const sizeLine = rawBuf.slice(0, lineEnd).toString('latin1').trim();
            rawBuf = rawBuf.slice(lineEnd + 2);
            const size = parseInt(sizeLine, 16);
            if (!Number.isFinite(size) || size < 0) {
              console.error(`[camera] ${cam.id} bad chunk size: "${sizeLine}"`);
              sock.destroy();
              return;
            }
            if (size === 0) return; // 流结束（0 块），等待 socket close 触发重连
            chunkRemaining = size;
          }
          if (rawBuf.length < chunkRemaining + 2) break;
          cleanBuf = Buffer.concat([cleanBuf, rawBuf.slice(0, chunkRemaining)]);
          rawBuf = rawBuf.slice(chunkRemaining + 2); // 丢弃块尾 CRLF
          chunkRemaining = -1;
        }
        if (cleanBuf.length > MAX_BUFFER) cleanBuf = cleanBuf.slice(-MAX_BUFFER);
        feed();
      }
    });

    sock.on('error', (e) => {
      console.error(`[camera] ${cam.id} socket error: ${e.message}`);
      this.scheduleReconnect(cam.id);
    });
    sock.on('close', () => {
      console.log(`[camera] ${cam.id} connection closed`);
      this.scheduleReconnect(cam.id);
    });
    this.connections.set(cam.id, sock);
    this.armWatchdog(cam.id);
  }

  /** 帧超时看门狗：出过帧后若 FRAME_TIMEOUT 内无新帧，判定为半开僵尸连接
   *（摄像头掉电/重启时 WiFi 直接消失，不发送 FIN/RST，socket 永远"看似正常"），
   *  主动断开触发重连；从未出帧的连接只继续观察（摄像头可能仍在启动）。 */
  armWatchdog(camId) {
    clearTimeout(this.watchdogTimers.get(camId));
    const t = setTimeout(() => {
      this.watchdogTimers.delete(camId);
      const f = this.latestFrames.get(camId);
      if (f) {
        if (Date.now() - f.at < FRAME_TIMEOUT) {
          this.armWatchdog(camId); // 帧还新鲜，继续观察
          return;
        }
        console.log(`[camera] ${camId} frame timeout ${FRAME_TIMEOUT}ms, force reconnect`);
        const sock = this.connections.get(camId);
        if (sock) sock.destroy(); // 触发 close → scheduleReconnect
        else this.scheduleReconnect(camId);
        return;
      }
      this.armWatchdog(camId); // 尚无帧，继续等待
    }, FRAME_TIMEOUT);
    this.watchdogTimers.set(camId, t);
  }

  onFrame(camId, buf) {
    this.failCount.set(camId, 0); // 收到帧重置退避计数
    // 裁剪为精确的干净 JPEG：从 SOI(FFD8) 到 EOI(FFD9)
    const soi = buf.indexOf(SOI);
    const eoi = buf.lastIndexOf(EOI);
    let clean = buf;
    if (soi >= 0 && eoi > soi) clean = buf.slice(soi, eoi + 2);
    else if (soi > 0) clean = buf.slice(soi);
    this.latestFrames.set(camId, { buf: clean, at: Date.now() });

    const n = (this.frameCount.get(camId) || 0) + 1;
    this.frameCount.set(camId, n);
    if (n === 1 || n % 50 === 0) {
      console.log(`[camera] ${camId} frames=${n} latest=${clean.length}B`);
    }

    const subs = this.subscribers.get(camId);
    if (subs) {
      for (const res of subs) {
        try { this.writeFrame(res, clean); } catch { /* 客户端断开由 close 清理 */ }
      }
    }
  }

  scheduleReconnect(camId) {
    this.connections.delete(camId);
    this.latestFrames.delete(camId);
    clearTimeout(this.watchdogTimers.get(camId));
    this.watchdogTimers.delete(camId);
    const cam = this.get(camId);
    if (!cam) return;
    if (this.reconnectTimers.has(camId)) return;
    // 失败退避：3s → 6s → 12s → 20s（封顶），减少连接抖动对摄像头 httpd 的压力
    const fails = this.failCount.get(camId) || 0;
    const backoff = Math.min(20000, RECONNECT_MS * 2 ** fails);
    this.failCount.set(camId, fails + 1);
    console.log(`[camera] ${camId} reconnect in ${backoff}ms (fail=${fails + 1})`);
    const t = setTimeout(() => {
      this.reconnectTimers.delete(camId);
      this.connect(cam);
    }, backoff);
    this.reconnectTimers.set(camId, t);
  }

  disconnect(id) {
    const sock = this.connections.get(id);
    if (sock) { try { sock.destroy(); } catch { /* noop */ } this.connections.delete(id); }
    const t = this.reconnectTimers.get(id);
    if (t) { clearTimeout(t); this.reconnectTimers.delete(id); }
    const w = this.watchdogTimers.get(id);
    if (w) { clearTimeout(w); this.watchdogTimers.delete(id); }
  }

  /** 最新帧（扫码识别轮询用）；无帧返回 null */
  frame(id) {
    const f = this.latestFrames.get(id);
    return f ? f.buf : null;
  }

  /** 订阅流：以 multipart/x-mixed-replace 输出给浏览器 <img> */
  stream(id, res) {
    if (!this.subscribers.has(id)) this.subscribers.set(id, new Set());
    this.subscribers.get(id).add(res);
    res.on('close', () => {
      const subs = this.subscribers.get(id);
      if (subs) subs.delete(res);
    });
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    const f = this.latestFrames.get(id);
    if (f) this.writeFrame(res, f.buf);
  }

  writeFrame(res, buf) {
    res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`);
    res.write(buf);
    res.write('\r\n');
  }
}
