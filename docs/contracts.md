# 接口契约

`contracts/domain.py` 定义 ExperimentTask、ExperimentBudget、RunReceipt、RunStatus 与证据对象；`contracts/ports.py` 定义适配端口。`services/research/src/evoresearch/models.py` 执行 HTTP 输入校验。

实验请求必须显式提供 `use_history`、任务标识、项目、模板、目标、指标、预算和允许修改路径。项目内重复 task_id 保持幂等，内容冲突返回 409。`use_history=true` 在排队前检索并冻结来源；检索失败返回错误，不能偷偷降级。

状态、停止、论文入库与知识查询使用同一后端。论文按项目、paper_id、version 保存不可变来源快照；同版本重复幂等，内容冲突 409。PDF/Zotero 导入建立同样的版本化来源。

运行服务后访问 `/openapi.json` 获取当前实现的机器可读契约，`/docs` 查看交互文档。`examples/start.json` 和 `examples/paper.json` 为调用样例，不包含认证信息。
