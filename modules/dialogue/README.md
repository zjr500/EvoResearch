# F12 会话接入与对话引用（邓玲，第4周）

本包按《第四周开发工作安排.md》中的邓玲任务范围交付：**接入 DSH 对话现有工具体系、检索候选条目、选中后展示来源**。这是单独的小插件 package，不覆盖组员已经提交的 DSH 项目骨架。

## 文件结构

```text
f12_dengling_week4/
├── src/
│   ├── dsh/index.ts                 # DSH Cordis 插件入口；注入工具与引用规则
│   ├── tools/knowledge-tools.ts     # 注册两个 DSH 模型工具
│   ├── config.ts                    # mock/http 工厂、配置
│   ├── domain/types.ts              # 内部检索实体类型（临时字段）
│   ├── domain/validate.ts           # 参数/响应/URL 校验
│   ├── adapters/mock-search.ts      # 基于 fixture 的模拟检索
│   ├── adapters/http-search.ts      # 第5周切真实 POST /kb/search 的入口
│   ├── services/search-service.ts   # 排序、去重和条目 ID 选择
│   └── services/citation-service.ts # 带来源的可复核回答格式
├── fixtures/kb-search.mock.json    # 明示的模拟检索数据
├── scripts/demo.mjs                # 无 DSH 的最小演示
├── tests/search.test.mjs           # node:test 自动测试
├── docs/INTEGRATION.md             # 在团队 DSH 中加载及交接
├── docs/PR_DESCRIPTION.md          # PR 内容与未完成项
├── docs/verification.log           # 本机无密钥的测试与运行记录
├── cordis.patch.example.yml       # 示例挂载配置（需替换绝对路径）
├── tsconfig.json                   # 离线构建（极小类型声明）
├── tsconfig.host.json              # 在真正 DSH host 中用真实 peer 类型校验
└── package.json
```

## 运行环境

- Node.js ≥20，TypeScript ESM，与团队统一环境保持一致。
- 本机 `npm install` 安装 TypeScript，执行 `npm run check` 即可测试 + 演示。
- 若无网络但已全局安装 `tsc`，也能直接 `tsc -p tsconfig.json && node --test tests/*.test.mjs && node scripts/demo.mjs`。
- 在真实 DSH 宿主依赖安装/解析完毕后，额外执行 `npm run typecheck:host`，使用实际 peer 类型而不是离线极小声明；此步骤当前环境无法验证。
- **只有运行在真实 DSH 中**才需要 DSH peer：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/schemastery`；不能把纯单元测试当成 DSH 联调成功。

## 演示命令

```bash
npm run build
npm test
npm run demo
npm run demo -- "LoRA是什么？"
```

## 本周工具调用流程

```text
DSH 会话用户问题
       ↓（原生 Agent Loop）
kb_search_sources(query, topK) → SearchService → MockSearchAdapter → fixture JSON
       ↓  返回候选 ID、title、snippet、score
模型选择与问题相关的 1~5 个 ID
       ↓
kb_cite_sources(query, ids) → 校验 ID 确在当前 query 检索结果中
       ↓
返回「根据检索片段整理的内容 [1]」+「[1] 来源 URL」
```

例如 `RAG如何减少幻觉？`：`kb-101` 命中，最终输出对应的 `[1]` 来源。来源内容来自**模拟数据**，不能将它描述成已经查到真实的项目知识库。

## 接入团队 DSH

看 [`docs/INTEGRATION.md`](docs/INTEGRATION.md)。开发时在 DSH 启动层添加 `cordis.patch.example.yml` 对应的插件行，**name 必须替换成绝对路径**。安装后的插件提供两个工具，不自己创建会话系统。

## 重要边界

1. **接口契约 v1.0 第1.4节未随作业上传。** 因此 JSON 只是本周的**临时模拟字段**，不能声称已经满足第1.4节；拿到契约时对齐 `src/adapters/http-search.ts` 和 `src/domain/validate.ts`。
2. 未提供马雨瑶的主骨架与实际 DSH 运行环境；这里已实现真实插件注册代码，但尚不能在你的组内 DSH 实例上亲自确认加载、截图和完整 Agent 轮次。
3. 本周 **没有 migrations**。后续 `reports`、`graph_cache` 的建表在 F10/F11 周期进行；本模块不重复创建共享 `operation_records`。
4. 当前答案为检索摘要的确定性整理，避免模拟数据混入未经验证的自由生成推断。正式模型改写后的引用准确率还需要 DSH 端到端回归验证。

## 参考资料

- [DSH 官方 Build a tool 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.md)
- [DSH 官方 Adding a tool 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md)
