# EvoResearch 前端面板

`evo/front-end panel` 是 EvoResearch 的 DSH `0.2.1-rc.2` 前端插件，包名为 `evoresearch-front-end-panel`。知识库、实验过程、指标图表、预警与终止已经接好前端请求。实验提交和知识图谱是预留页面。逐个文件的实现见[前端实现详解](../personal%20docs/前端实现详解.md)。


## 运行命令（在 front-end panel 目录执行）

**以下所有命令都在 `evo/front-end panel`（这份 README 所在目录）打开 PowerShell 后执行。** 不确定当前目录时，用 `Get-Location` 检查路径是否以 `front-end panel` 结尾。

需要 Node.js `22.19.0` 或更高版本。首次注册或重新注册还需要 `pnpm`，可用 `pnpm --version` 检查，找不到时先运行 `npm install -g pnpm`。

**按所选场景逐行执行。上一条报错时先停下来。** 如果需要重启 DSH，先在原来的终端按 `Ctrl+C`。启动后打开**本次终端输出的链接**，点 DSH 左侧栏的 EvoResearch；仍显示旧版时按 `Ctrl+F5`。

| 我想做什么 | 完整命令 | 例如 |
| --- | --- | --- |
| 第一次使用 | [首次安装](#首次安装) | 刚克隆项目，还没注册面板 |
| 直接打开或重启 | [日常启动与停止](#日常启动与停止) | 昨天已安装，今天继续用；或只改了宿主代码 |
| 改完前端，或退出调试版 | [重新构建普通版](#重新构建普通版) | 改了按钮样式，想看真实接口效果 |
| 更新依赖 | [重新安装依赖](#重新安装依赖) | 拉取后发现锁文件变了 |
| 重新绑定 DSH 插件 | [重新注册面板](#重新注册面板) | 移动了目录、改了插件声明，或侧栏找不到 EvoResearch |
| 只检查，不启动 | [只运行测试](#只运行测试) | 只改了 `checks/` 下的断言 |
| 不等后端，直接看样例 | [构建并启动调试版](#构建并启动调试版) | 看任务 21 的指标曲线 |

### 首次安装

刚克隆代码、还没在这份 DSH 配置中注册面板时，用下面这组。插件注册一次即可。

```powershell
$env:DSH_HOME = Join-Path (Resolve-Path -LiteralPath '..').Path '.dsh-panel'
npm ci
npm run build
npx --yes --package=@deepseek-ai/dsh@0.2.1-rc.2 dsh plugin --profile web add .
npx --yes --package=@deepseek-ai/dsh@0.2.1-rc.2 dsh --profile web --no-open --port 3080
```

### 日常启动与停止

昨天已经构建并注册过，今天只是打开面板；或者只改了 `src/host.js`，用下面两行沿用上次构建。DSH 运行时终端会保持打开，按 `Ctrl+C` 停止。

```powershell
$env:DSH_HOME = Join-Path (Resolve-Path -LiteralPath '..').Path '.dsh-panel'
npx --yes --package=@deepseek-ai/dsh@0.2.1-rc.2 dsh --profile web --no-open --port 3080
```

### 重新构建普通版

例如改了 `src/client/styles.js`、前端构建脚本，或要从调试版切回普通版。先停 DSH，再执行：

```powershell
$env:DSH_HOME = Join-Path (Resolve-Path -LiteralPath '..').Path '.dsh-panel'
npm run build
npm test
npx --yes --package=@deepseek-ai/dsh@0.2.1-rc.2 dsh --profile web --no-open --port 3080
```

### 重新安装依赖

例如 `package-lock.json` 更新了，或本地没有 `node_modules`。如果插件声明也变了，改用[首次安装](#首次安装)整组命令，一次完成依赖安装和注册。仅依赖有变时，先停 DSH，再执行：

```powershell
$env:DSH_HOME = Join-Path (Resolve-Path -LiteralPath '..').Path '.dsh-panel'
npm ci
npm run build
npm test
npx --yes --package=@deepseek-ai/dsh@0.2.1-rc.2 dsh --profile web --no-open --port 3080
```

### 重新注册面板

例如移动了面板目录、改了 `cordis.patch.yml` 或插件入口，或者 DSH 侧栏找不到 EvoResearch。先停 DSH，再执行：

```powershell
$env:DSH_HOME = Join-Path (Resolve-Path -LiteralPath '..').Path '.dsh-panel'
npm run build
npx --yes --package=@deepseek-ai/dsh@0.2.1-rc.2 dsh plugin --profile web add .
npx --yes --package=@deepseek-ai/dsh@0.2.1-rc.2 dsh --profile web --no-open --port 3080
```

只有改了包名才需要移除旧注册：先确认旧包名，在 `add .` 前运行 `npx --yes --package=@deepseek-ai/dsh@0.2.1-rc.2 dsh plugin --profile web remove evoresearch-front-end-panel`（如果旧包名不同，换成实际名字）。

### 只运行测试

例如只改了测试文件，或想在提交前检查。无需重启 DSH。已有要检查的构建产物时，只运行 `npm test`；如果要从头检查普通版，运行下面两行：

```powershell
npm run build
npm test
```

### 构建并启动调试版

例如后端没启动，想看两条样例知识和任务 21。首次使用先完成[首次安装](#首次安装)。先停 DSH，再执行：

```powershell
$env:DSH_HOME = Join-Path (Resolve-Path -LiteralPath '..').Path '.dsh-panel'
npm run build:debug
npx --yes --package=@deepseek-ai/dsh@0.2.1-rc.2 dsh --profile web --no-open --port 3080
```

打开面板后，**在导航下方直接勾选「启用本地调试数据」**，不用打开「接口设置」。看到黄色提示即开启成功。改了前端或样例后，也用这三行重新构建并启动调试版。

### 不需要运行命令的情况

| 情况 | 怎么做 |
| --- | --- |
| 只改 README、接口说明等文档 | 保存即可。 |
| 切换外观、调整接口前缀、开关样例 | 在面板上直接操作。 |
| 后端只有数据变了 | 重新查询或刷新；独立后端改了代码时，按该服务自己的说明重启。 |

### 注册警告与配置目录

- `DSH_HOME` 设置为上一级的 `evo/.dsh-panel`，用来保存 DSH 会话和设置。别把目录设到面板里面。
- 注册时若看到 `Replaced … from a different source`，确认新旧路径是否指向同一个 `front-end panel`。同一路径只是写法不同时，注册成功后可继续。
- 真实接口默认前缀为 `evoresearch/api/`，可在「接口设置」中修改。团队后端未接入时，普通版可能显示「接口尚未接入」。

## 个人调试

进入 **DSH 左侧栏 → EvoResearch → 导航下方的「启用本地调试数据」**。开关只在调试版中出现；如果这里只显示「真实接口模式」，请按[构建并启动调试版](#构建并启动调试版)重新启动并刷新。

- 「知识库」可以点开两条样例；「实验过程」「指标图表」「预警与终止」可以选任务 **21（比较学习率对验证损失的影响）**。在指标页内往下滚动可看候选方案和认证进度。
- 取消勾选就切回真实接口。调试操作只改变本地样例；刷新后会重置样例和开关。

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

测试命令见[只运行测试](#只运行测试)。调试数据与真实服务分开，调试写入成功只验证界面交互，业务保存、删除、实时推送和远程终止仍需接入团队后端联调。

初始框架在 DSH Web 0.2.1-rc.2 和 Edge 中验证了六个导航入口、浅色和夜间模式、跟随宿主色彩、430 像素窗口的设置入口，以及知识条目、指标曲线和模拟终止。开启本地调试后未发出业务请求。

调试版的滚轮与开关已在 DSH + Edge 中验证：1150 和 430 像素宽时均可滚动，窄窗口可到达指标页底部。
