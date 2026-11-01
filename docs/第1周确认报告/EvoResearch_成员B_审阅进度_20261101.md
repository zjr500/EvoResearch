# EvoResearch 项目立项报告审阅与成员 B 进度

日期：2026 年 11 月 1 日｜分支：myy｜状态：立项已审阅，成员 B 已认领，调研与最小验证已完成。

## 已审阅与认领

- 已审阅立项报告 v2.1 的功能清单、里程碑、分工和风险。认领成员 B 的自主实验子系统：F5 研究任务定义、F6 Agent 自主实验循环、F7 SSH 算力接入与远程执行，负责相应前后端、数据设计及 DSH 会话对接。

## 已完成的调研

- DSH 官方插件以 apply(ctx) 挂载，依赖由 inject 声明。上游主分支已有 SSH 服务，但本机 DSH 0.2.1-rc.2 安装包未包含该模块；需先锁定开发版本，再确定 F7 是复用上游能力还是自行实现。
- AIDE 使用“起草—调试—改进”的实验节点和指标反馈。课程 MVP 建议先实现单路径、轮数上限与失败记录，保留节点和事件结构以便扩展。

## 最小可行性验证

- 插件：在隔离的 DSH_HOME 中运行 0.2.1-rc.2 Web 与 --patch，最小插件的 apply 已执行，且取得 tools 服务；未修改日常配置。
- F5/F6：模拟器拒绝重复的数据划分；两轮验证指标 0.72→0.84 达到 0.80 阈值；失败场景在两轮上限停止。循环执行器不接收测试集标识，最终测试仅调用一次。
- F7：本机临时 SSH 服务通过 Ed25519 密钥和严格主机指纹校验；标准输出、错误输出及退出码均已回传，缺少 nvidia-smi 可识别；空 known_hosts 会拒绝连接。
- 验证边界：实验指标为模拟值，SSH 目标为本机回环；尚未验证真实 GPU 训练、模型调用、前端界面或报告回流。

## 审阅意见与下一步

- 时间表第 4 周将 F4 分给 A，分工表将 F4 分给 C，建议统一。第 2 周应冻结 F5 任务字段、F6 状态事件及 F7 执行结果的接口。
- F7 的凭证管理、远端独立工作目录、命令审批与沙箱策略需写成可测试约束；仅靠危险命令黑名单难以覆盖生成脚本。下一步用团队 GPU 服务器验证远程训练与 DSH 集成。

参考：[DSH 插件教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md)、[DSH SSH 说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/ssh/ssh/README.md)、[AIDE 项目](https://github.com/WecoAI/aideml)。

验证脚本：[实验循环](../../poc/member_b/experiment_loop.mjs)、[SSH 回环](../../poc/member_b/ssh_loopback.py)。
