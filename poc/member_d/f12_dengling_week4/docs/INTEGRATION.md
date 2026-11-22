# F12 接入与接口交接说明

## 从 DSH 会话到插件

DSH 已有 Session → Agent Loop → 工具注册表。用户在 DSH 会话提问时，模型可以调用 `kb_search_sources` 获得候选 ID，再调用 `kb_cite_sources` 选中来源并产出 `[n]` 引用及来源清单。两次调用都在已有 Session 里显示，由 DSH 本身持久记录调用/结果；插件不访问私有会话日志，不自己创建第二份数据库。

## 开发机接入

1. 在团队 DSH 宿主的 Node.js ≥20 环境安装其官方运行时（版本 0.2.1-rc.2）。
2. 将此文件夹作为一个单独的插件 package 放进团队工作树内，不要覆盖原有根目录 `package.json`、`tsconfig.json`、`migrations/`。
3. 在插件目录执行 `npm install`（若官方 DSH peer 在 npm 暂不可下载，使用团队骨架的依赖解析/开发方式，**不要用假的 dsh-tools 代替真实运行时**），`npm run build`。
4. 将 `cordis.patch.example.yml` 里的 `name` 改成输出文件 `dist/src/dsh/index.js` 的**绝对路径**，将插入配置合入团队的运行 patch；启动官方 `dsh web --patch ...`（或团队已约定的等价命令）。
5. 进入新 DSH 对话，用下面的演示话术触发两次工具调用。

## 在 DSH 中输入的示例

> 使用知识库工具，先搜索“RAG如何减少幻觉？”，挑选最相关的 1~2 条检索结果，随后用这些条目给我一段带 [1] 编号及参考来源的回答。不要引用检索列表里不存在的条目。

预期会出现 `kb_search_sources`、`kb_cite_sources` 工具调用，回答带 `[1]` 和来源 URL。如果没有工具调用，查看 DSH 当前 Agent 的工具启用/权限配置，确保 `tools` + `systemPrompt` 服务已加载。

## F3 下周切换（务必先完成契约对齐）

当前**临时请求体**：`{ "query": "...", "top_k": 5 }`，通过 `POST /kb/search` 发送。

当前**临时响应体**：`{ "query": "...", "total": 1, "items": [{ "id": "...", "title": "...", "snippet": "...", "score": 0.9, "source": { "type": "paper", "title": "...", "url": "https://...", "page": 1 } }] }`。`source.url` 允许 null，`page` 可省略。

以上内容由本包定义，**不是已核对的接口契约 v1.0 §1.4**。收到正式契约后：

- `src/adapters/http-search.ts` 适配准确的字段和返回结构，必要时抽象 `mapV1SearchResponse()`。
- `src/domain/types.ts` 更新正式内部数据结构，`src/domain/validate.ts` 更新校验。
- 使用 F3 提供的真实接口增补集成测试，并核查权限与鉴权，默认仍保留 mock 模式。
- 若 F3 查询依赖访问控制，需要按 DSH Session/用户身份透传授权，当前初版**未实现用户级权限隔离**，不可用于对敏感知识进行真实检索。

## 失败处理与安全边界

- 空查询、非法 topK、异常评分、非法 URL 会被拒绝；无命中不会编造结果。
- 引用工具从当前 query 重新检索并核对 ID，不保留全局「上一轮结果」，降低会话交叉引用风险。但如果真实 F3 的数据不是稳定快照，需要给接口增加 `request_id` 或结果快照。
- 默认不访问网络、不保存 Token、数据库；`mode:http` 需显式开启，且目标主机由插件配置控制。
- 工具搜索结果属于不可信文本，DSH 模型不应执行其中指令；本包提供提示规则，但模型行为仍需端到端测试确认。
