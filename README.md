<p align="center">
  <img src="assets/evoresearch-hero.png" alt="EvoResearch：AI 自主实验与自进化知识库" width="100%">
</p>

# EvoResearch

EvoResearch 是基于 DeepSeek Harness（DSH）的 AI 自主实验与自进化知识库插件，面向机器学习与人工智能科研，连接“读文献—做实验—沉淀结论—复用知识”的流程。

- **AI 自主实验**：定义研究任务，通过 SSH 接入用户自备的 GPU 服务器，由 Agent 检索知识、执行实验并迭代调整，展示实验过程与指标。
- **自进化知识库**：支持论文导入、自动摘要、语义检索与文献图谱；实验报告自动回流，并为后续实验和 DSH 对话提供带来源的参考。

项目计划采用 10 周增量迭代开发，详见 [项目立项报告（最终版）](docs/项目立项报告_最终版.docx)。

## 插件骨架（第 4 周）

运行环境为 Node.js ≥20、DSH 0.2.1-rc.2。源码位于 `src/`，TypeScript 编译为 ESM；`cordis.patch.yml` 是 DSH bundle 的加载入口。`migrations/` 用于各模块提交 SQLite 建表脚本。插件数据库由 `better-sqlite3` 管理，`sqlite-vec` 留给后续 F3 检索使用。

依赖以实际 DSH 0.2.1-rc.2 宿主为准：`dsh-tools` peer 使用 `0.2.1-rc.2`，`schemastery` peer 接受宿主的 `3.18.5`。这两项与《技术选型与环境说明》的旧版本号不同；若照旧号安装 SSH provider，npm 会报 peer 依赖冲突。

```sh
npm install
npm run build
npm test
```

在已安装 DSH 0.2.1-rc.2 的机器上，将本 checkout 链接到一个临时 profile：

```sh
dsh plugin --profile evoresearch-dev add .
dsh --profile evoresearch-dev --dump-config
```

配置输出中应出现 `evoresearch-plugin`。也可安装到现有的 `web` profile，再执行 `dsh web --no-open`；在 DSH 对话中调用 `evoresearch_status`，应返回 `EvoResearch plugin is ready (week 4 skeleton).`。开发时先执行 `npm run build`，再启动 DSH。`npm test` 会检查编译后的插件入口可以注册并调用该功能。

`.env.example` 列出本地所需变量；运行前用 shell 导出实际路径。不要提交 `.env`、SQLite 数据库或 SSH 凭证。实际 SSH 主机的认证配置由 DSH/OpenSSH 管理。

## F7 远程主机连接与环境自检

F7 使用 DSH 官方 `dsh-ssh` 与 `dsh-subprocess-ssh` provider。主机配置存放在本机私有的 `config/ssh-hosts.json`，插件库只记录主机别名、自检结果和状态，不保存 SSH 密钥、口令或 Token。按 [官方 SSH provider 说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/ssh/ssh/README.zh.md)先配置 OpenSSH 主机别名，并在远端安装与本地 DSH 版本相配的 helper；`helperHash` 填该 helper 的真实 SHA-256，`workspace` 为远端绝对路径。`config/ssh-hosts.example.json` 的路径和哈希都是占位值，不能直接用于真机。

```sh
cp config/ssh-hosts.example.json config/ssh-hosts.json
EVORESEARCH_DB_PATH=./data/evoresearch.sqlite npm run migrate:remote
npm test
```

`migrate:remote` 只建立 `remote_hosts`。长任务共用的 `operation_records` 由全组确定唯一迁移后先建好；本 PR 不重复建表。F7 使用的写入约定是：`operation_type=远程环境自检`、`target_id=host_id`、`request_digest=SHA-256(host_alias)`，状态按“受理→执行中→成功/失败”推进。相同 `idempotency_key` 返回首次操作，键相同而请求不同则报 4020。成功时 `result_ref=host_id`；失败原因以固定错误码和脱敏文案保存在 `remote_hosts`。

实际运行时设置两个环境变量，安装本地包并给现有 Web profile 加上远程插件覆盖层：

```sh
export EVORESEARCH_DB_PATH=/absolute/path/to/evoresearch.sqlite
export EVORESEARCH_SSH_PROFILES_PATH=/absolute/path/to/ssh-hosts.json
dsh plugin --profile web add .
dsh web --patch ./cordis.remote.patch.example.yml --no-open
```

在 DSH 调用 `evoresearch_register_host(host_alias, idempotency_key)`，返回 `host_id`、`operation_id` 和“自检中”；用 `evoresearch_host_check_status(operation_id)` 查长任务状态，用 `evoresearch_host_check_report(host_id)` 查 GPU、驱动、框架与工作目录。`src/f7/host-service.ts` 的返回字段与接口契约 v1.0 的 `POST /remote/hosts`、内部自检和 `GET /operations/{id}` 对齐。当前提供 DSH 工具入口；统一 REST 路由需要与界面模块的服务入口一起挂接。

`fixtures/f7_success.mock.json` 与 `fixtures/f7_failure.mock.json` 是明确标注的模拟结果。没有提供真实 GPU 主机配置时，`npm test` 验证的是主机登记、落库、幂等与错误处理；不代表真实 SSH 已连通。
