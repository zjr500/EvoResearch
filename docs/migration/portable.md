# Windows 迁移指南

## 只迁移软件

复制本仓库源码包到新电脑并完整解压。首次运行根目录 `Install.cmd`，以后运行 `Start.cmd`。不要复制旧虚拟环境、node_modules、processes.json 或带旧绝对路径的私有配置来代替安装。

私下传递 DeepSeek、Zotero 密钥文件，推荐放在仓库 `.secrets/` 或仓库外。首次配置输入 DeepSeek 文件路径；Zotero 库类型、库 ID 和密钥文件路径填写到安装生成的 `.audit-data/workbench-local/config.json` 的 env 中。不要将这些文件上传 GitHub。

Neo4j 在新电脑独立配置，或连接已有远程服务；填写 GRAPHITI_URI 和 GRAPHITI_PASSWORD。默认流程不安装/启动 Docker，旧 Docker 数据不会随源码包迁移。

## 同时保留实验与文献数据

1. 在旧环境运行其 `Stop.cmd`，停止所有写入。先备份，不覆盖原数据。
2. 复制旧配置中 data_dir 指向的完整研究数据目录（本项目通常为外层 `.audit-data/workbench`），包含 SQLite、论文/PDF、训练产物和 MLflow 文件；不要只复制一个数据库文件而遗漏关联文件或 WAL。
3. 在新环境安装后，把私有配置 data_dir 指向副本。重建 Python/Node/密钥路径；不要复制旧 PID 记录或访问码。访问码由新环境生成。
4. MLflow artifact URI 可能包含旧绝对路径：保留原盘符/路径最容易复现；路径改变时应核对并迁移 artifact 引用，当前没有自动重写工具，不宣称换路径后所有产物立即可用。
5. Neo4j 图谱单独按数据库备份/恢复流程迁移；SQLite 中的已入库标记不能替代实际图谱。当前 Docker 故障期间不要删除旧数据卷。
6. DSH 会话在旧 `.audit-data/dsh-workbench`；如需保留，应单独备份并检查内部工作区绝对路径。不要直接复制其 node_modules 代替新机器安装。
7. 运行 `Check.cmd`，验证历史实验、PDF、MLflow 产物和 Graphiti 来源查询，再开始新实验。

源码迁移不自动携带真实数据。本次整理保留旧目录和正在使用的运行环境，没有切换或复制其私有数据库。

## 本机目录关系

- `D:\26秋软件工程实践项目\EvoResearch`：后续统一源码仓库。
- 外层 `代码/正式代码`：旧阶段归档及当前旧启动器，保留供回退。
- 外层 `.audit-*`：原运行环境与私有数据，不属于新源码仓库。

旧服务已运行时，新仓库不要同时启动：两者默认使用 9000/8091。先停止旧服务，再按上面的步骤配置新仓库。
