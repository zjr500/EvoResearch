<p align="center">
  <img src="assets/evoresearch-hero.png" alt="EvoResearch" width="100%">
</p>

# EvoResearch

EvoResearch 是基于 DeepSeek Harness（DSH）的 AI 自主实验（Auto Research）与自进化科研知识库平台，面向机器学习和人工智能领域的科研活动。

项目旨在将论文知识库、AI 自主实验相结合。用户通过 DSH 原生对话界面及 EvoResearch 右侧工作台开展科研活动，论文和实验报告持续进入知识库，为后续研究提供参考。

## 功能规划与开发进度

| 模块 | 建设目标 | 当前代码基础 |
| --- | --- | --- |
| 科研知识库 | 论文导入、摘要确认、知识管理、语义检索与知识图谱 | 已有论文处理、摘要生成、条目管理、向量检索、报告入库和知识同步事件的后端代码 |
| AI 自主实验 | 研究任务、实验方案、多轮实验、运行监控、候选选择与统一认证 | 已有本地 Docker 执行器、实验 Agent 创建与工具注册、候选快照及认证基础服务 |
| 科研对话 | 在 DSH 对话中检索和引用科研知识 | 已有检索与引用工具、统一知识库服务适配代码 |
| 科研工作台 | 在 DSH 右侧提供实验与知识库界面 | 已有右侧面板挂载、公共请求封装及事件处理基础代码 |

当前处于统一骨架基础上的业务开发阶段。多轮自主实验流程、知识图谱、实验报告生成、完整对话交互和业务界面仍待开发与联调。真实 DSH 实验 Agent 的工具隔离尚待集成验证。

## 技术架构

- **宿主平台**：DeepSeek Harness 0.2.1-rc.2，复用原生 Web 界面、Agent、大模型服务和 Web 服务。
- **后端**：Node.js、TypeScript、Cordis；通过插件接入 DSH。
- **前端**：React、JSX、esbuild，使用 DSH 原生右侧面板扩展机制。
- **知识存储与检索**：SQLite、better-sqlite3、sqlite-vec、pdf-parse，以及兼容 Ollama API 的 Embedding 服务。
- **实验执行**：本地 Docker 容器运行 Python 实验脚本，使用独立实验目录和资源限制；认证服务单独管理候选快照与测试集。

## 项目结构

```text
EvoResearch/
├── assets/                  # 项目图片
├── docs/                    # 项目文档、会议纪要、开发安排和设计示意图
├── src/
│   ├── index.ts             # 后端插件入口
│   ├── runtime.ts           # 公共服务初始化与组装
│   ├── infrastructure/      # 数据库、模型配置、HTTP、操作记录等
│   ├── knowledge/           # 论文、摘要、检索、报告入库与同步事件
│   ├── experiment/          # 实验 Agent、Docker 执行、候选冻结与认证
│   └── dialogue/             # 科研对话与知识库的连接
├── modules/
│   ├── dialogue/             # 知识检索及引用工具实现
│   └── frontend/             # DSH 右侧工作台插件
├── migrations/
│   ├── knowledge/           # 知识库数据库迁移
│   ├── shared/              # 公共数据库迁移
│   └── modules/experiment/  # 实验基础设施数据库迁移
├── scripts/                 # 构建协调与数据库迁移脚本
├── test/                    # 后端测试
├── cordis.patch.yml         # 后端插件及实验 Agent 预设配置
├── package.json             # 根项目依赖与构建命令
├── package-lock.json        # 根项目依赖锁文件
├── tsconfig.json            # TypeScript 编译配置
└── .env.example             # 开发环境变量示例
```

## 开发环境

- Node.js ≥ 22.19.0
- DeepSeek Harness 0.2.1-rc.2
- Docker（本地实验和认证）
- 已配置 DSH 模型服务；使用语义检索时需准备兼容 Ollama API 的 Embedding 服务。

在仓库根目录执行：

```powershell
npm ci
npm ci --prefix modules/frontend
npm run check
npm run build
npm test
```

`npm run build` 同时构建后端、科研对话模块和前端模块。`npm run db:migrate` 可单独执行数据库迁移，后端启动时也会自动执行迁移。

### 接入 DSH

后端和右侧工作台分别为 `evoresearch-plugin` 与 `evoresearch-front-end-panel`，各自具有 DSH 加载配置。开发时，在已安装 DSH 的环境中将两个本地包加入同一 Web profile。例如在仓库根目录执行：

```powershell
dsh plugin --profile web add .
dsh plugin --profile web add ./modules/frontend
dsh --profile web --dump-config
```

在已经配置好这两个插件的 Web profile 中启动：

```powershell
dsh --profile web --no-open --port 3080
```

浏览器访问 <http://localhost:3080>，打开右侧 EvoResearch 工作台。

### 开发配置

环境变量参见 [`.env.example`](.env.example)，在启动 DSH 的进程环境中设置。

| 配置 | 用途 |
| --- | --- |
| `EVORESEARCH_DB_PATH` | SQLite 文件路径，默认 `data/evoresearch.sqlite`（相对于进程工作目录） |
| `EVORESEARCH_SUMMARY_PROVIDER`、`EVORESEARCH_SUMMARY_MODEL` | 摘要模型覆盖配置，成对设置，留空继承 DSH 默认模型 |
| `EVORESEARCH_EXPERIMENT_PROVIDER`、`EVORESEARCH_EXPERIMENT_MODEL` | 实验模型覆盖配置，成对设置，留空继承 DSH 默认模型 |
| `EVORESEARCH_EMBEDDING_BASE`、`EVORESEARCH_EMBEDDING_MODEL` | 向量服务地址及模型名，使用语义检索时成对设置 |

模型凭证统一通过 DSH 配置。当前实验执行需要本机预先准备 `evoresearch-worker:latest` 镜像，Embedding 服务也需提前准备；安装与首次运行自动初始化属于后续集成工作。

## 模块协作

| 公共服务 | 用途 |
| --- | --- |
| `evoresearchModels` | 模型配置与调用 |
| `evoresearchOperations` | 操作记录管理 |
| `evoresearchKnowledge` | 知识检索、条目读取、报告入库及同步事件 |
| `evoresearchExperimentExecution` | 实验执行及运行记录管理 |
| `evoresearchExperimentAgents` | 实验 Agent 创建与停止 |
| `evoresearchCertification` | 候选快照、测试集和认证运行 |

各业务模块共用后端 SQLite 数据库。新增独立业务模块的迁移文件放在 `migrations/modules/<模块名>/`，按 `001_*.sql`、`002_*.sql` 等连续编号管理。知识库已有迁移由 `migrations/knowledge/` 及对应迁移代码管理。

前端在 `modules/frontend/src/client/` 开发，通过后端接口获取业务数据。具体界面参考 [设计示意图](docs/设计示意图/)。

## 项目文档

- [项目立项报告](docs/项目立项报告_v3.0_20261118.docx)
- [需求分析](docs/EvoResearch_需求分析.pdf)
- [会议纪要](docs/会议纪要/)
- [第五周开发工作安排](docs/开发工作安排/第五周开发工作安排.md)
- [第六周开发工作安排](docs/开发工作安排/第六周开发工作安排.md)
- [第七周开发工作安排](docs/开发工作安排/第七周开发工作安排.md)
