<p align="center">
  <img src="assets/evoresearch-hero.png" alt="EvoResearch：AI 自主实验与自进化知识库" width="100%">
</p>

# EvoResearch

EvoResearch 是基于 DeepSeek Harness（DSH）的 AI 自主实验与自进化知识库插件，面向机器学习与人工智能科研，连接“读文献—做实验—沉淀结论—复用知识”的流程。

- **AI 自主实验**：实验脚本在本地 Docker 隔离容器中执行（断网、非 root、资源受限、训练数据只读），Agent 通过受限工具发起实验、读取产物并迭代调整，执行记录全部落库。
- **自进化知识库**：支持论文导入、自动摘要、语义检索与文献图谱；实验报告自动回流，并为后续实验和 DSH 对话提供带来源的参考。

## 统一骨架（当前状态）

仓库当前提供六类可运行骨架，全部经过真实环境验证：

| 骨架 | 位置 | 状态 |
| --- | --- | --- |
| 三栏工作台前端 | `modules/frontend/` | 挂载在 DSH 原生右侧边栏，“实验”“知识库”两个入口；知识库入口已实现 UC01 完整流程（导入、摘要、确认、检索、详情、PDF 原文），实验入口按设计示意图分区并呈现真实空状态；对话输入框显示知识库接入徽标 |
| 共享基础设施 | `src/infrastructure/` | 共享数据库、操作幂等、认证处理器、迁移登记 |
| 迁移目录机制 | `migrations/modules/<模块>/NNN_name.sql` | 各模块按目录登记迁移，不改公共文件 |
| 知识公共服务 | `src/knowledge/` | `POST /kb/search`（sqlite-vec 语义检索）、报告幂等入库、同步事件 claim/settle；cordis 服务 `evoresearchKnowledge` |
| Docker 受控执行 | `src/experiment/docker-execution.ts` | 仅用固定镜像 `evoresearch-worker`，隔离不可满足时拒绝执行；cordis 服务 `evoresearchExperimentExecution` |
| 实验 Agent 工具 | `src/experiment/agent-tools.ts` | `experiment_run/status/list/read_artifact`，Agent 不接触 docker CLI 与宿主机路径 |
| 科研对话接入 | `src/dialogue/` + `modules/dialogue/` | 引用工具直查统一知识服务（进程内，非 Mock）；未配置 embedding 时如实报错 |

诚实边界：

- 语义检索需要配置本地 embedding 服务（`EVORESEARCH_EMBEDDING_BASE` + `EVORESEARCH_EMBEDDING_MODEL`，Ollama 兼容接口）；未配置时 `POST /kb/search` 返回 4009，不会用关键词检索冒充语义检索。已用 nomic-embed-text（768 维）在本地完成真实检索验证。
- 摘要生成复用 DSH 已登录模型；DSH 未登录模型时导入论文会得到“摘要失败”的诚实状态，可在登录后重新生成。
- 实验执行只跑 CPU；GPU 框架训练尚未验证。
- Agent 两轮链路用 Mock 规划器验证过工具回路，不等于真实模型的自主实验验收。
- 知识图谱、实验业务后端（UC04—UC11）尚未通过 HTTP 开放，实验页各区域呈现真实空状态，不展示虚构数据。
- `modules/remote-ssh/` 是已放弃的 SSH 路线源码，保留但不加载。

## 构建与测试

运行环境为 Node.js ≥22.19.0、DSH 0.2.1-rc.2。源码位于 `src/`，TypeScript 编译为 ESM；`cordis.patch.yml` 是 DSH bundle 的加载入口。`modules/dialogue/` 随根构建一并编译。

```sh
npm ci
npm ci --prefix modules/frontend
npm run check
npm run build
npm test
```

在已安装 DSH 0.2.1-rc.2 的机器上，将本 checkout 链接到一个临时 profile：

```sh
dsh plugin --profile evoresearch-dev add .
dsh --profile evoresearch-dev --dump-config
```

配置输出中应出现 `evoresearch-plugin`。也可安装到现有的 `web` profile，再执行 `dsh web --no-open`；在 DSH 对话中调用 `evoresearch_status` 可确认插件加载。开发时先执行 `npm run build`，再启动 DSH。

参照 `.env.example` 将数据库路径设置到启动进程的环境变量；本项目不会自动加载 `.env`。不要提交 `.env`、SQLite 数据库或凭证。

## 快速开始（安装与首次使用）

1. **安装插件**：在本仓库执行 `npm run build && npm pack` 得到 `evoresearch-plugin-*.tgz`，在目标 DSH profile 中执行 `dsh plugin --profile <你的profile> add <tgz路径>`；开发时也可以直接 `add <仓库路径>` 链接本 checkout。
2. **配置环境变量**（在启动 DSH 的进程环境中设置，不要提交）：
   - `EVORESEARCH_DB_PATH`：插件数据库文件路径，缺省为启动目录下 `data/evoresearch.sqlite`。
   - `EVORESEARCH_EMBEDDING_BASE` / `EVORESEARCH_EMBEDDING_MODEL`：语义检索的本地向量服务，两者须同时设置；不设置则语义检索如实返回不可用。
3. **本地向量服务（二选一）**：
   - 标准方式：安装 Ollama 后 `ollama pull nomic-embed-text`，服务地址为 `http://127.0.0.1:11434`，模型名 `nomic-embed-text`。
   - 轻量方式：用 fastembed（ONNX，无需 GPU）在本地起一个兼容 `POST /api/embed` 的小服务加载 `nomic-ai/nomic-embed-text-v1.5`，指向同一地址即可；任何返回 `{"embeddings": [[...]]}` 的 Ollama 兼容端点都可使用。
4. **启动并验证**：`dsh --profile <你的profile>` 启动后打开右侧边栏的 EvoResearch 工作台。首次使用建议按顺序验证：导入一篇 PDF 论文（需 DSH 已登录模型以生成摘要）→ 查看/编辑 → 确认入库 → 知识条目出现 → 语义检索命中 → 对话输入框出现“知识库 · N 条”徽标。

## 成员开发入口

- **新增数据库表**：在 `migrations/modules/<你的模块>/` 添加 `001_*.sql`、`002_*.sql`……版本号从 1 连续递增，禁止改动他人目录与公共迁移文件。
- **检索/读知识/报告入库**：注入 cordis 服务 `evoresearchKnowledge`（search、entries、entry、publishReport、events.claim/settle）。
- **跑实验**：注入 cordis 服务 `evoresearchExperimentExecution`，或在前端/后端调用已注册的 `experiment_*` 工具；挂载目录必须位于实验工作区根目录内。
- **前端**：`modules/frontend/src/client/features/` 下按入口扩展，复用 DSH 原生组件与 CSS 变量，不替换左栏导航与中栏对话。
- **索引/图谱消费者**：通过 `evoresearchKnowledge.events.claim(owner, 'index' | 'graph')` 领取事件，处理后 `settle`；事件持久，崩溃不会丢。

项目计划采用 10 周增量迭代开发，详见 [项目立项报告 v3.0](docs/项目立项报告_v3.0_20261118.docx)。

## 第四周 F1/F2

历史运行、验收和接口补充记录可在[清理前 main 快照](https://github.com/zjr500/EvoResearch/tree/3019ae6eb40d4d0d50ead81ef6b76dc00931c767/docs/开发工作安排)中查看。业务 REST 需要 DSH Web 宿主的认证会话。

F2 默认复用 DSH 的 `agentDefaultModel.currentSelection()` 和 `ctx.llm.stream()`，不读取或管理 API Key。`.env` 中的 `EVORESEARCH_SUMMARY_PROVIDER` / `EVORESEARCH_SUMMARY_MODEL` 留空即可；同时填写为显式覆盖，只填写一个会报错。配置项见 [.env.example](.env.example)。

## UC01 后端（2026-11-25）

当前论文流程为：选择或继承 DSH 模型 → 上传并生成待确认摘要 → 修改/重新生成 → 确认入库。
历史 F1/F2 记录中的“先确认、后摘要”不能用于当前 API 调用。
批量上传采用逐篇 POST 汇总；当前开发依据为最新需求分析、[第五周开发工作安排](docs/开发工作安排/第五周开发工作安排.md)及实际代码。历史 UC01 验收记录保留在上述 Git 快照中。
