# EvoResearch 前端面板

`evoresearch-front-end-panel` 是 EvoResearch 的 DSH `0.2.1-rc.2` 前端插件，挂载在 DSH 原生右侧边栏，不替换左栏导航与中栏对话。

## 当前状态

旧版业务界面已全部废弃删除。当前仅保留最小工程骨架：DSH 插件加载、右侧工作台挂载（占位面板）与构建运行链路。业务界面由界面负责人依据 `docs/设计示意图/` 三张已确认示意图重新实现，样式优先沿用 DSH 原生 UI。

## 保留内容

- `src/host.js`：插件宿主入口。
- `src/client/index.jsx`：右栏工作台 tab 类型与面板挂载。
- `src/client/Workbench.jsx`：占位面板（无业务功能）。
- `src/client/shell/PanelIcon.jsx`：通用图标组件。
- `src/client/shared/api.js`：同源 API 请求封装（与后端 REST 约定对应）。
- `src/client/shared/events.js`：事件回放协议（排序、去重、游标）。
- `scripts/build-client.mjs`：JSX → DSH 客户端模块打包。
- `checks/contracts.test.js`：API 封装、事件协议与打包产物断言。

后端 API、数据类型与服务接口不受本次清理影响，见仓库根目录 `src/`。

## 构建与测试

本模块不独立安装或注册，统一在仓库根目录操作：

```powershell
npm ci --prefix modules/frontend   # 安装本模块构建依赖（esbuild、react）
npm run build                      # 根目录统一构建（含本模块）
npm test                           # 根目录统一测试（含 checks/ 下断言）
```

仅运行本模块检查时：`node --test checks/*.test.js`。
