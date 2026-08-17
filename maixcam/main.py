# main.py — MaixCam Pro 条形码识别 + 云端联动（智能药柜平台）
# 功能：
#   1. 连接 WiFi（与电脑同一网络）
#   2. 摄像头实时识别条形码（EAN-13 等）
#   3. 同一码连续 3 次命中（防误扫）→ HTTP 上报到平台服务端 /api/scan/device
#   4. 服务端查库结果（已建档/未建档）显示在 MaixCam 屏幕上
#   5. 每 20 秒上报一次心跳（平台"设备运维"页显示在线状态）
#
# 部署：用 MaixVision 连接设备，把本文件保存为 main.py 运行/上传即可。
# 配置：可直接改下面的默认值；也可在设备 /root/maixcam_scan.conf 覆盖：
#        SERVER_IP=192.168.0.100
#        WIFI_SSID=1
#        WIFI_PASS=qxy1257889

from maix import camera, display, image, app, time, network, err
import requests
import json
import gc

# ---------------- 默认配置 ----------------
WIFI_SSID  = "1"
WIFI_PASS  = "qxy1257889"
SERVER_IP  = "192.168.0.100"          # 电脑（平台服务端）的局域网 IP
SERVER_PORT = 3001
DEVICE_NAME = "maixcam-pro"
CONFIRM_COUNT = 3                      # 同一码连续命中次数（防误扫）
SEND_COOLDOWN_MS = 3000                # 上报成功后的冷却时间
HEARTBEAT_MS = 20000                   # 心跳间隔
# ------------------------------------------

SERVER_URL = "http://%s:%d/api/scan/device" % (SERVER_IP, SERVER_PORT)
HEARTBEAT_URL = "http://%s:%d/api/scan/heartbeat" % (SERVER_IP, SERVER_PORT)

# 读取设备上的配置文件（可选覆盖默认值）
try:
    with open("/root/maixcam_scan.conf", "r") as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = [x.strip() for x in line.split("=", 1)]
                if k == "SERVER_IP":
                    SERVER_IP = v
                    SERVER_URL = "http://%s:%d/api/scan/device" % (SERVER_IP, SERVER_PORT)
                    HEARTBEAT_URL = "http://%s:%d/api/scan/heartbeat" % (SERVER_IP, SERVER_PORT)
                elif k == "WIFI_SSID":
                    WIFI_SSID = v
                elif k == "WIFI_PASS":
                    WIFI_PASS = v
    print("config loaded:", SERVER_URL)
except Exception as e:
    print("no config file, use defaults:", e)

# ---------------- 摄像头 / 屏幕 ----------------
try:
    cam = camera.Camera(640, 480)      # 宽幅更利于条码识别（条码宽度远大于高度）
except Exception as e:
    print("640x480 failed, fallback 480x320:", e)
    cam = camera.Camera(480, 320)

try:
    disp = display.Display()
except Exception as e:
    disp = None
    print("no display:", e)

# ---------------- WiFi ----------------
ip = ""
try:
    w = network.wifi.Wifi()
    ip = w.get_ip() or ""
except Exception as e:
    print("wifi init failed:", e)
    w = None

if w is not None and not ip:
    print("connecting wifi:", WIFI_SSID)
    e = w.connect(WIFI_SSID, WIFI_PASS, wait=True, timeout=60)
    if e == err.Err.ERR_NONE:
        ip = w.get_ip() or ""
    else:
        print("wifi connect failed, code:", e)
print("ip:", ip if ip else "offline")

# ---------------- 扫码状态机 ----------------
last_code = ""
match_cnt = 0
last_send_ts = 0
last_result = "waiting scan..."
last_hb_ts = 0

def post_json(url, payload, timeout_s=5):
    try:
        r = requests.post(url, data=json.dumps(payload),
                          headers={"Content-Type": "application/json"},
                          timeout=timeout_s)
        return r.status_code, r.text
    except Exception as ex:
        return -1, str(ex)

def draw_status(img, lines):
    for i, (text, color) in enumerate(lines):
        img.draw_string(4, 4 + i * 22, text, color, 1.2)

while not app.need_exit():
    img = cam.read()
    if img is None:
        time.sleep_ms(50)
        continue

    codes = img.find_barcodes()
    code = None
    rect = None
    for b in codes:
        try:
            code = b.payload()
        except Exception:
            code = str(b.payload)
        rect = b.rect()
        break

    now = time.ticks_ms()

    if code:
        if code == last_code:
            match_cnt += 1
        else:
            last_code = code
            match_cnt = 1

        # 画框 + 识别中提示
        if rect:
            img.draw_rect(rect[0], rect[1], rect[2], rect[3], image.COLOR_GREEN, 2)

        if match_cnt >= CONFIRM_COUNT and (now - last_send_ts) > SEND_COOLDOWN_MS:
            status, text = post_json(SERVER_URL, {"barcode": code, "device": DEVICE_NAME})
            if status == 200:
                try:
                    data = json.loads(text)
                    last_result = data.get("message", "OK")
                except Exception:
                    last_result = "OK"
                print("scan sent:", code, "->", last_result)
            else:
                last_result = "upload failed: %s" % text
                print("scan send failed:", status, text)
            last_send_ts = now
            match_cnt = 0
            last_code = ""
    else:
        # 无条码：冷却期后清空状态（允许再次识别同一码）
        if (now - last_send_ts) > SEND_COOLDOWN_MS:
            last_code = ""
            match_cnt = 0

    # 心跳
    if (now - last_hb_ts) > HEARTBEAT_MS:
        post_json(HEARTBEAT_URL, {"device": DEVICE_NAME}, 3)
        last_hb_ts = now

    # 屏幕状态
    lines = []
    if code:
        lines.append(("code: %s" % code, image.COLOR_GREEN))
        lines.append(("confirm %d/%d" % (match_cnt, CONFIRM_COUNT), image.COLOR_WHITE))
    else:
        lines.append(("no barcode", image.COLOR_WHITE))
    lines.append(("ip: %s" % (ip or "offline"), image.COLOR_WHITE))
    lines.append((last_result[:40], image.COLOR_YELLOW))
    draw_status(img, lines)

    if disp is not None:
        disp.show(img)

    gc.collect()
    time.sleep_ms(30)

print("exit")
