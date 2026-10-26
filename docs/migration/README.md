# 迁移基线与范围

业务服务采用第五阶段正式源码，覆盖前四阶段的任务/调度/追踪/知识能力；AutoResearch 采用实际运行的 `phase5-autoresearch` 定制引擎；工作台采用当前正式 `7_workbench`。不是按 ZIP 内容堆叠的阶段归档。

| 旧位置 | 新位置 |
| --- | --- |
| `1_contracts` | `contracts` |
| `6_phase5/src/evoresearch` | `services/research/src/evoresearch` |
| 定制 AutoResearch 引擎 | `packages/autoresearch` |
| `7_workbench` 服务与 Windows 入口 | `apps/workbench` |
| `7_workbench/dsh-plugin` | `plugins/dsh` |
| 各模块测试 | `tests/<module>` |

第一至第四阶段测试按测试函数名称对比，第五阶段已保留其用例，除历史 `test_no_implicit_knowledge_enhancement` 需补回显式参数检查。旧阶段功能由统一实现维护，不重复保留过时服务副本。

`source-manifest.json` 记录复制前来源哈希；迁移后路径适配、配置和测试变化由 Git diff 记录。核心训练与业务算法不作结构重写。DSH 最新客户端使用右侧面板插槽；原测试仍断言旧 main/sidebar 插槽，已按实际正式客户端更新测试，未回退客户端。

明确排除：旧 ZIP、历史实验记录/截图、真实数据库、密钥文件、日志、环境与下载依赖。原 AutoResearch 静态历史数据改为空目录状态；只读归档能力保留，测试改用合成记录。只核验历史交付截图字节/真实记录副本的测试不适用于空数据源码仓库，替换为不携带私有数据检查。功能行为测试继续运行。

原目录与原数据均未移动或删除。后续开发请以本仓库为唯一源码入口；恢复私有运行数据按部署文档操作，不要把 `.audit-data` 或数据库加入版本控制。
