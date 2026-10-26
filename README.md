# EvoResearch

面向科研任务的实验闭环与 DSH 原生科研工作台。该仓库整合第一至第五阶段正式功能以及最新工作台；后续修改以 Git Commit、功能分支和 Pull Request 交付。

## 功能与模块

| 目录 | 职责 |
| --- | --- |
| `packages/autoresearch` | 自主实验引擎、预算、受限代码修改、训练执行、停止/恢复、原 AutoResearch Web 页面 |
| `services/research` | 任务适配与调度、MLflow 追踪、Graphiti 知识检索及异步投影、论文与来源冻结 |
| `apps/workbench` | 科研项目 API、Zotero/CSL 导入、PDF 提取与重试、Windows 进程管理 |
| `plugins/dsh` | DSH 原生右侧工作台、科研工具、携带来源进入原生会话 |
| `contracts` | 实验、预算、状态、证据对象及服务端口契约 |
| `tests` | 按引擎、服务、工作台、插件和契约组织的回归测试 |
| `deploy` | Docker 镜像、Neo4j 配置、DSH 容器入口 |
| `docs` | 架构、开发、部署和迁移核验说明 |

支持 digits MLP、DLinear ETTh1、diabetes Ridge 和 ETTh1 Ridge。实验 Worker 与知识/追踪投影分离；投影服务暂时不可用时保留待处理事件。知识增强需要显式选择、同项目来源检索和来源冻结，不会静默退回无知识实验。

## 环境与依赖

Python 3.12、Node.js >=24.9、pnpm 11、Docker Compose v2。DSH 固定 `@deepseek-ai/dsh@0.2.1-rc.3`；MLflow `3.5.1`、Graphiti `0.31.2`、FastEmbed `0.7.3` 通过 Python 包安装。Neo4j `5.26-community` 启用 APOC。未复制上述组件的上游仓库。AutoResearch 是本项目已有的定制引擎，源码及已生效的第五阶段修改直接维护在 `packages/autoresearch`。

Python 完整版本集合在 `requirements-lock.txt`；Windows 专用包带平台条件。DLinear 真训练另外安装 `torch==2.8.0`。首次 Graphiti 检索需要下载 BGE 嵌入模型。

## Windows 本机安装

```powershell
git clone https://github.com/zjr500/EvoResearch.git
cd EvoResearch
./apps/workbench/Install.cmd
```

安装器准备 Python 虚拟环境、Node、pnpm、DSH 和插件，并要求本地密钥文件路径。配置只保存在被忽略的 `.audit-data/workbench-local/config.json`；不要粘贴密钥到 GitHub。之后使用 `apps/workbench/Start.cmd`、`Stop.cmd`、`Check.cmd`、`Configure.cmd`。首次 Docker Desktop 安装可能要求完成 WSL 设置或重启。

手动安装 Python 服务：

```powershell
./scripts/setup.ps1 -Python python
```

Linux/macOS 开发安装：

```sh
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-lock.txt
python -m pip install --no-deps --no-build-isolation -e packages/autoresearch -e .
# 使用 DLinear 真训练时：
python -m pip install torch==2.8.0
```

Python 服务不会自动读取 `.env`；手动启动需通过 shell 注入环境变量。Compose 自动读取 `.env`，Windows 启动器使用私有 JSON 配置。详情见 [部署说明](docs/deployment.md)。

## Docker Compose

```sh
cp .env.example .env
# 编辑 .env：填写模型 Key、独立数据库密码、至少 24 字符的随机访问码
docker compose build
docker compose up -d
docker compose ps
docker compose logs dsh
```

浏览器打开 DSH 日志中的本机登录链接，进入 EvoResearch 右侧工作台，使用 `.env` 中的 `EVORESEARCH_TOKEN` 登录。登录链接携带凭据，不要共享。浏览器使用 `http://127.0.0.1:9000`，API 为 `http://127.0.0.1:8091`。DSH 与 API 共享网络命名空间，以保留插件的本机接口地址。服务端口仅绑定回环地址。

```sh
docker compose --profile tracking up -d mlflow
# MLflow UI: http://127.0.0.1:5000
docker compose down
```

数据库、实验文件、DSH 会话和嵌入模型使用 Docker 命名卷，`down` 保留数据。不要使用 `down -v`，除非明确要删除数据。默认 `local_trusted` 在 Worker 容器内执行受限模型代码；该部署面向可信团队，尚不是面向不可信用户的多租户平台。

## 测试与接口

在激活的 Python 3.12 环境中、Node 24 位于 PATH 时：

```sh
python scripts/test.py
python scripts/check_repository.py
```

测试包含真实本机 CPU 训练、进程终止、临时数据库、HTTP 替身及前端状态回归，可能需要数分钟。自动测试不消耗真实模型 API，也不要求生产数据库。外部依赖闭环验证单列于 [验证说明](docs/testing.md)，不能用单元测试替代真实模型、Graphiti 或 DSH 浏览器验收。

运行后的 OpenAPI 在 `http://127.0.0.1:8091/docs`。主要入口包括 `/api/templates`、`/api/experiments`、`/api/papers`、`/api/knowledge/search` 和 `/api/wb/projects`。API 使用 `Authorization: Bearer <EVORESEARCH_TOKEN>`；浏览器登录使用 HttpOnly 会话 cookie 与来源检查。请求例子在 `examples`，契约说明见 [接口契约](docs/contracts.md)。

## 数据与协作

仓库不携带密钥、数据库、实验产物、历史交付包、虚拟环境或 `node_modules`。原 AutoResearch 历史回放入口保留，但新克隆的历史数据为空；测试使用明确标注的合成数据。ETTh1 是固定任务输入数据，随任务资产保留，第三方说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

旧环境数据保持在原位置，不能直接把旧数据库提交到仓库。私有数据恢复与迁移边界见 [迁移说明](docs/migration/README.md)。开发流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

当前研究结论仍是：单次知识增强/无增强对照未证明普遍收益。完整部署的验证状态以 [测试记录](docs/testing.md) 为准。
