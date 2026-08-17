// hooks/useUiSocket.js — 前端 WebSocket 订阅（连接管理在 store 内单例化）
import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore.js';

export function useUiSocket() {
  const initSocket = useAppStore((s) => s.initSocket);
  useEffect(() => {
    initSocket();
  }, [initSocket]);
}

// 数据联动 Hook：服务端事件（tick 变化）触发重新拉取
export function useLiveData(fetcher, deps = []) {
  const tick = useAppStore((s) => s.tick);
  const connected = useAppStore((s) => s.connected);
  useEffect(() => {
    let alive = true;
    fetcher().catch(() => {});
    return () => { alive = false; };
  }, [tick, connected, ...deps]);
}
