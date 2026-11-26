<p align="center">
  <img src="assets/evoresearch-hero.png" alt="EvoResearch：AI 自主实验与自进化知识库" width="100%">
</p>

# EvoResearch

EvoResearch 是基于 DeepSeek Harness（DSH）的 AI 自主实验与自进化知识库插件，面向机器学习与人工智能科研，连接“读文献—做实验—沉淀结论—复用知识”的流程。

- **AI 自主实验**：实验在受控隔离环境中执行，由 Agent 检索知识、执行实验并迭代调整，展示实验过程与指标。
- **自进化知识库**：支持论文导入、自动摘要、语义检索与文献图谱；实验报告自动回流，并为后续实验和 DSH 对话提供带来源的参考。

## 构建与测试

运行环境为 Node.js ≥22.19.0、DSH 0.2.1-rc.2。源码位于 `src/`，TypeScript 编译为 ESM；`cordis.patch.yml` 是 DSH bundle 的加载入口。`migrations/` 用于各模块提交 SQLite 建表脚本。插件数据库由 `better-sqlite3` 管理，`sqlite-vec` 用于语义检索。

依赖以实际 DSH 0.2.1-rc.2 宿主为准：`dsh-tools` peer 使用 `0.2.1-rc.2`，`schemastery` peer 接受宿主的 `3.18.5`。

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

配置输出中应出现 `evoresearch-plugin`。开发时先执行 `npm run build`，再启动 DSH。

参照 `.env.example` 将数据库路径设置到启动进程的环境变量；本项目不会自动加载 `.env`。不要提交 `.env`、SQLite 数据库或凭证。

摘要模型默认复用 DSH 的 `agentDefaultModel.currentSelection()` 和 `ctx.llm.stream()`，不读取或管理 API Key。`EVORESEARCH_SUMMARY_PROVIDER` / `EVORESEARCH_SUMMARY_MODEL` 留空即可；同时填写为显式覆盖，只填写一个会报错。

## 项目文档

- [需求分析](docs/EvoResearch_需求分析.pdf)
- [项目立项报告 v3.0](docs/项目立项报告_v3.0_20261118.docx)
- [文档修改规定](docs/文档修改规定.md)
- 每周开发工作安排见 [docs/开发工作安排](docs/开发工作安排/)

## 当前论文流程（UC01）

选择或继承 DSH 模型 → 上传并生成待确认摘要 → 修改/重新生成 → 确认入库。批量上传采用逐篇 POST 汇总；业务 REST 需要 DSH Web 宿主的认证会话。
