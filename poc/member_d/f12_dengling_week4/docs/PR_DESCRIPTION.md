# PR 说明：邓玲 · 第四周 F12 前半

**PR 标题**：`[第4周][F12] 会话工具接入与来源引用初版`

## 本周交付

- DSH Cordis 插件注册 `kb_search_sources` / `kb_cite_sources` 两个工具；依托 DSH 原有 Session/Agent Loop，不实现重复的会话存储。
- `MockSearchAdapter` 模拟 `POST /kb/search` 的数据检索；`HttpSearchAdapter` 保留第5周切真实 F3 接口的入口。
- `SearchService` 负责过滤、排序、去重、拒绝未检索到的来源 ID；`citation-service` 输出带 `[1]` 编号的回答与来源表。
- 独立的 `fixtures/kb-search.mock.json`、离线测试（含模拟 DSH 宿主的工具注册/执行/注销检查）、无密钥示例输出。

## SQL 迁移

本周 **无建表脚本**（按第四周安排）。没有新增 `operation_records`；该表须由组内确定统一的迁移负责人，F12 目前无持久化长任务操作。

## 依赖和真实/模拟边界

- 依赖马雨瑶合并的 DSH 0.2.1-rc.2 Cordis 插件骨架。
- 当前检索为 **mock**；模拟 JSON 字段是可替换的临时约定，**未获得 v1.0 接口契约 §1.4，因此不得标注为已通过契约验收**。
- 真实 HTTP 适配层只是待接线代码：第5周与张嘉荣对齐 F3 的请求与响应字段、鉴权、URL 及错误码后，切换 `mode: http` 并进行集成测试。
- 下游由 DSH 模型决定是否调用工具及选择 ID；离线演示只检验 deterministic 的工具逻辑，**不等价于已完成真实 DSH 会话运行验收**。

## 验证

```sh
npm run check
# DSH 安装步骤参见 README.md 与 docs/INTEGRATION.md
```

测试输出见 `docs/verification.log`，运行界面证据需在合并团队骨架后由本人补充 DSH 会话截图（不得伪造截图）。

**实际宿主尚待完成：** 需要在马雨瑶的 DSH 实际骨架内执行 `npm run typecheck:host`、安装/挂载与对话截图，不能将模拟宿主测试作为真实 DSH 测试。
