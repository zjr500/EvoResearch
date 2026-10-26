# 部署与运行

## 手动服务

安装 README 中的 Python 依赖后，为所有进程设置相同 `AUTORESEARCH_HOME`、`EVORESEARCH_TOKEN`、模型配置和 Graphiti 配置。`AUTORESEARCH_RUNNER=local_trusted` 适合本机可信使用。分别启动：

```sh
python apps/workbench/server.py
python -m evoresearch worker
python apps/workbench/projection.py
python apps/workbench/pdf_ingestion.py
```

第五阶段纯 API 入口 `python -m evoresearch serve` 仍保留。工作台入口额外提供项目、PDF、Zotero 与浏览器认证。

Windows 完整安装：`apps/workbench/Install.cmd`。安装文件位于 `.audit-runtime`，虚拟环境位于 `.audit-venvs/phase5`，配置/日志位于 `.audit-data/workbench-local`，均不提交。访问码文件为 `access-token.txt`。配置 `python`、`node` 为可执行文件路径，`data_dir` 为数据目录，`llm_key_file` 为本机密钥文件路径，其他配置放入 `env`。

Zotero 可选配置：`ZOTERO_LIBRARY_TYPE=users`（群组为 `groups`）、`ZOTERO_LIBRARY_ID`、`ZOTERO_API_KEY` 或 `ZOTERO_API_KEY_FILE`。仅从 Zotero 读取；支持 CSL JSON、摘要、PDF 下载/上传与提取，不传播远端删除。

## Compose

根目录 `compose.yaml` 启动 API、实验 Worker、投影 Worker、PDF Worker、DSH 与 Neo4j。可选 tracking profile 启动 MLflow UI。Python 组件共用镜像和 `/data`，保持 SQLite、实验文件及 MLflow 文件 URI 一致；Graphiti 使用独立 Neo4j 卷。DSH 是 npm 安装的上游发布版本，插件是本仓库本地包。

`deploy/compose.neo4j.yaml` 只启动 Neo4j，供 Windows 本机启动器使用；不要和根 Compose 同时占用 17474/17687 端口。

如果本机已有服务占用 8091/9000 或旧 Neo4j 端口，应先明确停止该服务或调整整套端口/浏览器来源配置。不要删除旧数据卷解决端口冲突。

模型 Key、数据库密码、访问码分别配置；示例文件没有可用默认密码。生产暴露需要额外的 TLS、身份权限、反向代理与隔离设计，目前仅提供本机可信团队部署。

## 数据保存与恢复

停止写入进程后备份整个研究数据目录、Neo4j 数据和 DSH_HOME。SQLite 使用备份 API 或停止服务后复制，不能只复制主库而遗漏 WAL。MLflow 的 artifact URI 包含原路径；跨目录恢复需要核对这些 URI。知识 group_id 来自 project_id；复用项目会访问同一图谱组。当前版本没有自动跨阶段数据库升级器。
