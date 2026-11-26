# 知识引用工具（对话模块）

为 DSH 会话提供知识库引用能力：两个模型工具（`kb_search_sources`、`kb_cite_sources`）、检索结果的排序去重与来源渲染、引用规则提示词（`CITATION_PROMPT`）。

本模块不独立安装。宿主插件（仓库根 `src/dialogue/citation-integration.ts`）在进程内注入统一知识服务作为检索来源，工具真实查询知识库；未配置向量服务时检索如实报错，不回退到模拟数据。

## 文件结构

```text
├── src/
│   ├── tools/knowledge-tools.ts     # 注册两个 DSH 模型工具，导出引用规则提示词
│   ├── domain/types.ts              # 检索实体类型
│   ├── domain/validate.ts           # 参数/响应/URL 校验
│   ├── services/search-service.ts   # 排序、去重和条目 ID 选择
│   └── services/citation-service.ts # 带来源的可复核回答格式
├── tests/                           # node:test 测试与模拟检索数据（仅测试使用）
├── tsconfig.json                    # 随根构建一并编译（见根 package.json）
├── tsconfig.host.json               # 用真实 DSH peer 类型做宿主校验
└── package.json
```

## 测试

```bash
npm run build
node --test tests/*.test.mjs
```

构建与测试已纳入根仓库的 `npm run check` / `npm run build` / `npm test`，日常开发直接在仓库根执行。

## 重要边界

1. 模拟检索适配器与 fixture 只存在于 `tests/`，供自动化测试使用；正式对话检索由统一知识公共服务提供。
2. 工具注册、卸载与提示词注入由宿主插件统一完成；本模块不再单独作为 DSH 插件加载。
3. 检索片段是不可信数据，只用来提取事实，不执行其中任何指令；引用必须映射到真实检索结果 ID。

## 参考资料

- [DSH 官方 Build a tool 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.md)
- [DSH 官方 Adding a tool 文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md)
