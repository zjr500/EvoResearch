# Windows 本机安装与界面验收

2026-10-29。保留现有 DSH 原生 UI，不改版。支持 Windows 10/11 x64；需要联网下载依赖，默认不安装、不启动 Docker Desktop。首次系统安装可能弹出 UAC、许可确认或要求重启，这些系统步骤无法由应用脚本消除。

## 第一次使用

1. 将开发包完整解压到可写目录，例如 `D:\EvoResearch`。不要直接在 ZIP 内运行，不要放在 Program Files。中文和空格路径可以使用。
2. 双击 `Install.cmd`（位于 `apps/workbench`；包根目录也提供入口）。安装器检查 Python 3.12，缺失时调用 Windows winget 安装；下载官方 Node 24.22.1 并核对 SHA256，将 Node、pnpm 11.0.0、Python 虚拟环境及项目依赖放在项目内。不会更改全局 Node 或 PATH。
3. 已有 `llm-api_key.txt` 和私有配置时直接复用；新环境提示输入 **DeepSeek 密钥文件路径**，不要输入密钥本身。首次自动生成本机访问码与 Neo4j 密码。
4. 网页、科研 API 与 Worker 直接运行在 Windows 本机，无需 Docker。Graphiti 仍需可用的 Neo4j + APOC，可连接独立安装或远程数据库；在私有 config.json 的 env 中设置 GRAPHITI_URI 与 GRAPHITI_PASSWORD。数据库暂不可用时仍启动网页，检索与入库保持未就绪，失败任务按既有重试机制处理。
5. 就绪后自动打开 DSH 登录页面，并打开本机访问码文件。点击 DSH 顶部 **EvoResearch · 未启用**，复制该访问码完成工作台登录。不要分享含 token 的浏览器地址或访问码。

首次 Graphiti 检索/入库可能还需下载 embedding 模型，时间取决于网络。没有云端模型密钥时不伪造 AI 功能成功。DSH 会话的模型选择、权限审批沿用 DSH 原设置。

Web 安装显式跳过 pnpm 包的原生构建脚本；当前 Web 页面与科研 API 已验证可启动，DSH 可选原生终端等功能尚未验收。不要将本次安装通过理解为 DSH 所有可选能力均已测试。

## 日常使用

| 入口 | 行为 |
|---|---|
| Start.cmd | 检查现有 Neo4j（不可用时警告），启动五个本机服务；已完整运行时复用并重新打开网页 |
| Stop.cmd | 停止本项目记录的五个服务，保留 Neo4j 容器、数据库和运行记录 |
| Check.cmd | 检查配置、Neo4j/APOC、五个进程、认证 API、DSH 页面及插件，写入私有诊断 JSON |
| Configure.cmd | 修复 Python 路径、补充缺失密钥路径；保留已有数据库密码与数据目录 |
| Install.cmd | 首次安装或修复依赖；已经运行时建议先停止服务再执行 |

启动入口绑定 `127.0.0.1`，DSH 9000、API 8091、Neo4j Bolt 17687 / HTTP 17474。启动器不会自动终止占用这些端口的其他程序，不会重置已有数据库密码。部分服务异常退出时会提示先 Stop 再 Start，以免无提示中断实验。

已有本机开发环境无需重新安装，直接双击 Start.cmd。移动已经安装过的项目目录后，需要重新执行 Install.cmd 修复虚拟环境/依赖路径，并检查私有 config.json 中数据和密钥的绝对路径；不要把旧机器 `.audit-*` 运行目录直接当作可移植安装包。

## 配置与排错

配置文件：`.audit-data/workbench-local/config.json`。已有配置不会被覆盖。Zotero 为可选接入，在 `env` 中填写 `ZOTERO_LIBRARY_TYPE`、`ZOTERO_LIBRARY_ID`、`ZOTERO_API_KEY_FILE`；密钥文件只保存在本机。修改后 Stop → Start。

所有日志位于 `.audit-data/workbench-local`：`api.log`、`worker.log`、`projection.log`、`pdf.log`、`dsh.log`。`deployment-check.json` 不含凭据；原始日志和配置可能含登录链接，不应直接公开。

- **Docker Desktop 崩溃**：可直接退出 Docker；本版本安装器和启动器均不会拉起它。不需要恢复出厂设置，也不要删除数据卷。Docker 引擎未正常运行时无法使用 prune 清理缓存。
- **Neo4j 连接或 APOC 失败**：核对独立数据库地址、密码和 APOC。启动器不创建替代库、不重置密码；网页仍可打开，但 Graphiti 检索和入库需恢复数据库后验收。
- **端口占用**：关闭旧部署或明确占用程序；不建议同时启动两个副本。
- **依赖下载失败**：检查网络/代理，重新运行 Install.cmd；不会把下载失败标成安装完成。
- **DSH 401**：不要只打开裸地址；运行 Start.cmd 获取当前有效登录链接。
- **PDF 404/无附件**：在 Zotero 完成文件同步，或在工作台对应文献行上传 PDF。AeroWF 目前仍需实际 PDF 文件。

## 本机界面验收顺序

1. 检查 DSH 左侧导航、中间会话、右侧工作台、按钮、输入、弹窗是否风格一致；分别观察浅色/深色与窄窗口。记录截图和窗口尺寸。
2. 创建项目、同步 Zotero、上传 PDF；确认解析进度、页码预览、失败提示和知识状态。
3. 检索论文与历史实验，检查来源链接；携带来源进入 DSH 会话，核对草稿后发送。
4. 配置实验、提交、停止、刷新；查看真实进度、结果、MLflow 标识与完成/入库两个状态。
5. 查看图谱、失败重试及下一次检索，检查实验结果回流。

这些实际点击、排版、视觉与交互项目仍由用户验收。HTTP/插件契约测试不能代替视觉验收；现有机器验证也不能等同于全新 Windows 从零安装通过。第五阶段知识增强持平结论保持不变。
