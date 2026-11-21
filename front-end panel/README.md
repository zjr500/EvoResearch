# EvoResearch 前端面板

`evo/front-end panel` 是 EvoResearch 的 DSH `0.2.1-rc.2` 前端插件，包名为 `evoresearch-front-end-panel`。知识库、实验过程、指标图表、预警与终止已经接好前端请求。实验提交和知识图谱是预留页面。逐个文件的实现见[前端实现详解](../personal%20docs/前端实现详解.md)。

## 运行

### 首次安装

在本文件所在的 `evo/front-end panel` 目录打开 PowerShell。Node.js 使用 `22.19.0` 或更新版本。DSH 的插件管理还需要能从终端调用 `pnpm`；先用 `pnpm --version` 检查，找不到命令时执行 `npm install -g pnpm`，再检查版本。

首次使用这套本地 DSH 配置时执行：

```powershell
$env:DSH_HOME = Join-Path (Resolve-Path -LiteralPath '..').Path '.dsh-panel'
npm ci
npm run build
npm test
npx --yes --package=@deepseek-ai/dsh@0.2.1-rc.2 dsh plugin --profile web add .
npx --yes --package=@deepseek-ai/dsh@0.2.1-rc.2 dsh --profile web --no-open --port 3080
```

`npm ci` 按锁文件安装开发依赖；`npm run build` 将前端源码打包到 `dist/client.js`；`npm test` 执行检查，不负责构建；`dsh plugin ... add .` 将当前目录的插件注册到指定的 DSH 配置；最后一条命令启动 Web 服务。首次 `npx` 可能下载 DSH 及依赖，之后通常复用 npm 缓存。

插件在同一 `DSH_HOME`、同一 `web` profile 中只需注册一次，不必每次启动都执行整组命令。打开终端输出的启动链接，在侧栏选择 EvoResearch。「接口设置」在页面导航下方，旁边的「外观」可选跟随 DSH、浅色或夜间。默认跟随 DSH，单独选择的外观保存在当前浏览器。

### 日常启动与停止

没有修改代码、依赖或插件配置时，只需在 `front-end panel` 目录执行：

```powershell
$env:DSH_HOME = Join-Path (Resolve-Path -LiteralPath '..').Path '.dsh-panel'
npx --yes --package=@deepseek-ai/dsh@0.2.1-rc.2 dsh --profile web --no-open --port 3080
```

`DSH_HOME` 是当前 PowerShell 会话的环境变量，新开终端要重新设置，始终使用同一路径。服务运行时该终端会一直被占用，这是正常现象；按 `Ctrl+C` 停止。已经运行时直接打开原启动链接即可，不要在另一个终端重复启动同一端口。

下文的“重启”指：在运行 DSH 的终端按 `Ctrl+C`，再执行启动命令；随后刷新浏览器。这个项目没有配置前端源码监听或热更新。

### 修改后的操作

| 修改内容或场景 | 需要执行什么 |
| --- | --- |
| `src/client/` 下的 JSX、JS、样式、接口适配或调试数据 | `npm run build`，再重启 DSH 并刷新页面；本地调试模式使用 `npm run build:debug` |
| `scripts/build-client.mjs` 的打包逻辑 | 重新构建，再重启并刷新 |
| `src/host.js` 的宿主逻辑 | 只需重启 DSH；没有前端改动时不用 build |
| `cordis.patch.yml`，或 `package.json` 中的插件名称、入口、`exports`、DSH 元数据 | 停止 DSH，重新执行 `dsh plugin --profile web add .`，再启动；影响前端打包或入口时也要重新 build。更改包名时还需移除旧名称的注册 |
| 拉取代码后 `package-lock.json` 或依赖声明发生变化，或缺少 `node_modules` | `npm ci`，再构建、测试、重启并刷新 |
| 拉取代码后只有前端源码发生变化 | 构建、测试、重启并刷新，无需重复 `npm ci` 或注册插件 |
| 切换正式构建与本地调试构建 | 分别执行 `npm run build` 或 `npm run build:debug`，再重启并刷新；二者覆盖同一个构建产物 |
| 只修改 README、接口说明等文档 | 无需构建或重启 |
| 只修改 `checks/` 下的测试 | 执行 `npm test`；没有运行代码改动时无需构建或重启 |
| 在页面中修改接口设置、外观或本地调试开关 | 页面内生效，无需构建、注册或重启；调试开关需使用调试构建 |
| 只修改业务后端或后端数据 | 无需重建这个前端包；后端代码按所属服务的方式重启。同宿主加载的后端模块改动需重启 DSH，独立服务则重启该服务；数据变化通常只需重新查询或刷新页面 |
| 插件目录移动、换了 `DSH_HOME` / profile，或注册记录丢失 | 在新目录或新配置中重新注册，再启动；已有构建产物且源码未变时无需重新 build |

普通代码迭代建议按“停止 DSH → 构建（前端有改动时）→ `npm test` → 启动 → 刷新页面”的顺序操作。本地注册使用目录链接，因此同一路径下修改源码后通常不必再次 `plugin add`。构建后统一重启并刷新，可以避免宿主加载状态或浏览器缓存仍保留旧版；若仍看到旧内容，尝试 `Ctrl+F5` 强制刷新。不要直接修改 `dist/client.js`，它会被下次构建覆盖。

### 注册警告与配置目录

重复执行注册命令时，可能看到：

```text
[WARN] Replaced "evoresearch-front-end-panel" ("link:D:/.../front-end panel") with "D:\...\front-end panel" from a different source.
Lockfile is up to date, resolution step is skipped
Done in ... using pnpm ...
```

这表示插件管理器用这次提供的来源替换了原有的同名插件来源记录。上例中的 `link:D:/...` 和 `D:\...` 指向同一本地目录，只是来源表示方式不同，并不代表源码被覆盖。后面的 `Done` 表示依赖安装步骤完成，这个警告本身不是安装失败。如果警告中的两个实际目录不同，应确认新目录才是想加载的版本。`Lockfile is up to date` 表示锁文件无需重新解析依赖，也不是错误。

上面的 `DSH_HOME` 指向上一级的 `evo/.dsh-panel`，这个目录保存本地会话和宿主设置。如果误在面板目录里生成了另一个 `.dsh-panel`，先停止使用它的 DSH，再按上面的路径启动。确认能打开原有会话，并且不再需要误建目录里的新会话或设置后，可以只删除 `front-end panel/.dsh-panel`。

默认接口前缀为 DSH 当前页面下的 `evoresearch/api/`。可以在「接口设置」修改为本机 DSH 的其他同源前缀。业务后端应在同一个 DSH Web 服务中注册这些路由并检查宿主身份，具体方法和响应结构见两份接口说明。

当前 Host 入口只用来安装客户端模块。业务路由由知识库、实验执行及预警服务提供。只安装此包时，数据请求会显示接口未接入。

## 个人调试

从 `front-end panel` 运行 `npm run build:debug`，重新启动 DSH 并刷新页面。打开「接口设置」，勾选「启用本地调试数据」。知识库里有两条样例；在实验过程、指标图表或预警页选编号 21，可以看轮次、事件、曲线、候选和预警规则。编辑、删除、保存规则和终止都只改变当前页面内存。退出调试模式或刷新后恢复初始样例，模式默认关闭。

调试构建与正式构建都写入 `dist/client.js`。想恢复正式版本就执行 `npm run build` 再重启并刷新。普通构建不会把样例编入，打包前也会自动重建普通版；本地调试构建只在个人 DSH 环境里使用。

## 代码位置

```text
src/
├─ host.js                         插件宿主入口
└─ client/
   ├─ index.jsx                    DSH 面板注册
   ├─ App.jsx                      页面导航、共享任务选择、切换数据来源
   ├─ styles.js                    面板样式
   ├─ shell/                       设置、外观开关与导航图标
   ├─ debug/                       调试构建用数据和内存适配器
   ├─ shared/
   │  ├─ api.js                    同源地址、请求、响应校验
   │  ├─ hooks.js                  加载、重试、写入幂等键
   │  ├─ events.js                 事件回放、排序、去重
   │  ├─ useEvents.js              SSE 连接及销毁
   │  ├─ TaskSelector.jsx          任务列表和手动任务编号
   │  └─ ui.jsx                    错误提示、分页、数据展示
   └─ features/
      ├─ knowledge/               F4 列表、详情、勾选、编辑、删除
      ├─ process/                 F8 轮次、时间线、决策摘要、日志
      ├─ metrics/                 F9 指标曲线、原始数据、候选和认证进度
      ├─ alerts/                  F13 规则表单、预警记录、终止请求和状态核查
      ├─ experiment-setup/        F5/F6 实验提交预留页面及接口适配
      └─ knowledge-graph/         F11 知识图谱预留页面及接口适配
scripts/build-client.mjs           把 JSX 打包成 DSH 客户端模块
checks/contracts.test.js           请求、事件、图表和打包检查
dist/client.js                    构建产物，交给 DSH 加载
```

每个功能目录里的 `api.js` 集中列出该功能的接口。增加页面时在 `features/` 下加目录，再在 `App.jsx` 注册页面。

[前端数据接入说明](../personal%20docs/前端数据接入说明.md) 记录页面和接口的对应关系。[新增接口设计](../personal%20docs/新增接口设计.md) 记录本次采用的推测和待确认字段。

F13 当前完成规则读取与保存表单、已记录预警的展示、终止请求和任务状态核查。规则触发判定、邮件发送和预警记录持久化由界面子系统的后端服务继续实现。

## 本地验证

普通构建可用 `npm run build; npm test` 检查。调试数据与真实服务分开，调试写入成功只验证界面交互，业务保存、删除、实时推送和远程终止仍需接入团队后端联调。

初始框架在 DSH Web 0.2.1-rc.2 和 Edge 中验证了六个导航入口、浅色和夜间模式、跟随宿主色彩、430 像素窗口的设置入口，以及知识条目、指标曲线和模拟终止。开启本地调试后未发出业务请求。
