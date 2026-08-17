// tcpGateway.js — TCP-AT 网关
// 为「AT 固件模式的 ESP-01S」提供直连通道：无需刷机，AT+CIPSTART 建立 TCP 连接后
// 按行（\n 分帧）发送与 WebSocket 一致的 JSON 协议即可成为平台在线设备。
//   AT 指令示例（串口调试助手发送）：
//     AT+CWMODE=1
//     AT+CWJAP="Pharmacy-Net","12345678"
//     AT+CIPSTART="TCP","192.168.1.100",3002
//     AT+CIPSEND
//     {"deviceId":"PMC-001","type":"HEARTBEAT","rssi":-58}
//     <Ctrl+Z 发送>
//   之后每次上行都需 AT+CIPSEND 进入透传窗口；服务端下行会原样输出到串口（\r\n 结尾）。
import net from 'net';

export function createTcpGateway(hub, port = 3002) {
  const server = net.createServer((socket) => hub.attachTcp(socket));
  server.on('error', (err) => console.error('[tcp-gateway]', err.message));
  server.listen(port, () => {
    console.log(`  TCP-AT 网关    tcp://0.0.0.0:${port}  (AT 固件直连，行协议 JSON)`);
  });
  return server;
}
