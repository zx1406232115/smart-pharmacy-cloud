// App.jsx — 路由 + 应用壳（侧边栏 / 顶栏 / 轻提示 / 实时通道）
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import Toasts from './components/Toasts.jsx';
import { useUiSocket } from './hooks/useUiSocket.js';
import Dashboard from './pages/Dashboard.jsx';
import Dispense from './pages/Dispense.jsx';
import Store from './pages/Store.jsx';
import Query from './pages/Query.jsx';
import Slots from './pages/Slots.jsx';
import Ops from './pages/Ops.jsx';
import Audit from './pages/Audit.jsx';

const ROUTES = [
  { path: '/', element: <Dashboard />, title: '总览', subtitle: '药房运行实况 · 取储查管一站式监控' },
  { path: '/dispense', element: <Dispense />, title: '取药管理', subtitle: '处方队列 · 批量下发 · 凭证生成' },
  { path: '/store', element: <Store />, title: '储药管理', subtitle: '入库登记 · 智能货位推荐分配' },
  { path: '/query', element: <Query />, title: '药品查询', subtitle: '多维度检索 · 效期与库存预警' },
  { path: '/slots', element: <Slots />, title: '货位看板', subtitle: '3 层 × 3 列矩阵可视化 · 三维坐标信息' },
  { path: '/ops', element: <Ops />, title: '设备运维', subtitle: '硬件在线监控 · 运行节奏 · 虚拟调试面板' },
  { path: '/audit', element: <Audit />, title: '复核审计', subtitle: '出药抓拍留档 · AI OCR 品规对照 · 拦截追溯' },
];

function Shell() {
  const { pathname } = useLocation();
  const route = ROUTES.find((r) => r.path === pathname) || ROUTES[0];
  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className="pl-60">
        <Topbar title={route.title} subtitle={route.subtitle} />
        <main key={pathname} className="px-8 py-6">
          {route.element}
        </main>
      </div>
      <Toasts />
    </div>
  );
}

export default function App() {
  useUiSocket();
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<Shell />} />
      </Routes>
    </BrowserRouter>
  );
}
