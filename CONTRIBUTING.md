# 开发协作

1. 从最新 `main` 创建 `feature/<topic>`、`fix/<topic>` 或 `docs/<topic>` 分支。
2. 按功能模块修改源码。不要回到阶段包中维护第二份实现，也不要修改依赖安装目录。
3. 安装本地可编辑包，运行 `python scripts/test.py` 和 `python scripts/check_repository.py`。
4. 提交小而完整的 Commit，描述行为变化及原因。推送分支并提交 PR，说明测试结果、数据兼容性与部署影响。
5. Review 与 CI 通过后合并；用 tag 标记正式版本。交付仓库 URL、Commit SHA 和运行说明，不再交付整包 ZIP。

新增 API 同步更新契约、输入校验和调用端。新增配置同步更新 `.env.example`。数据库更改需明确升级/回滚步骤；现有 SQLite/Neo4j 数据不可用源码复制操作替代迁移。

首次迁移使用 `codex/github-migration` 分支，保留远程原始历史。项目尚未指定整体开源许可证；第三方授权单独保留，不应自行宣称整仓采用某种开源许可证。
