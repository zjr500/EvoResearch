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

复制 `.env.example` 为本地 `.env` 后可按需调整数据库路径。不要提交 `.env`、SQLite 数据库或 SSH 凭证。实际 SSH 主机的配置由 DSH/OpenSSH 管理。
