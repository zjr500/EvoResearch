# 第三方依赖与来源

DSH（`@deepseek-ai/dsh@0.2.1-rc.3`）通过 npm/pnpm 安装；Graphiti（`graphiti-core==0.31.2`）、MLflow（`mlflow==3.5.1`）、FastEmbed 等通过 Python 包管理安装；Neo4j 使用官方容器及 APOC 插件。上游许可证随各发行包提供，本仓库未复制其完整源码树。

AutoResearch 为已有工程的定制版本，来自原第二阶段统一整合工程并包含已验证的第五阶段补丁，作为本项目维护的模块纳入源码。来源文件 SHA-256 见 `docs/migration/source-manifest.json`。

`packages/autoresearch/src/autoresearch/assets/dlinear/DLinear.py` 与固定 ETTh1 数据为已有 DLinear 任务资产。DLinear 的原许可证保留在同目录 `LICENSE`。ETTh1 为任务输入数据，不是本次实验运行产物；后续分发需继续遵循其数据来源的使用条件。不得将此说明解释为给整个项目重新授权。
