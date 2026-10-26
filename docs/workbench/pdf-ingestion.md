# Zotero 元数据、摘要与 PDF 全文

2026-10-26。使用同一个 Graphiti 后端，不新增 RAG 框架。

## 数据流与来源

Zotero Web API 同步保存完整条目元数据；有摘要的条目进入原论文知识队列。无摘要条目保存在 wb_zotero_items，不再从文献界面消失，也不把标题当摘要入库。HTTP arXiv 链接规范化为 HTTPS；其他 HTTP 来源优先使用 DOI HTTPS 引用。

工作台“Zotero 元数据与 PDF 全文”提供云端 PDF 读取、本机 PDF 上传、任务状态、页码与哈希和失败重试。云端下载仅使用当前配置库、当前项目已导入条目下的 PDF 附件。附件文件未同步、无权限或发生变更都会失败；不会以摘要替代全文。

PDF Worker 使用独立进程和 pdf-worker.lock。下载/解析不会占用实验 Worker 或投影 Worker。原文件保存在运行数据目录 pdf-jobs/<job_id>/source.pdf；逐页文本、片段和来源映射保存在 manifest.json。解析成功后生成多个版本化 PaperInput，继续使用既有 Graphiti 投影与可见性检查。

作业按项目、Zotero 条目快照、附件版本或上传文件 SHA256 确定幂等 ID。中断后 parsing 回到 queued；重复已完成或失败作业返回其真实状态。每个片段记录文件 SHA256、文本 SHA256、页码范围、Zotero item_key 及原论文引用。parsed 仅表示提取并排队完成；retrievable_chunks / total_chunks 表示实际可检索数量，不能混为一谈。

## 边界

- pypdf 6.12.0 layout 模式，50 MB、200 页、150 万字符限制；解析在独立子进程中运行，120 秒超时。
- 完整文本层逐页提取，约 1.2 万字符一段；超过单页长度限制时分段，保留页号。不生成摘要来替代正文。
- 无文本层扫描件提示 requires_ocr；目前不执行 OCR。部分低文本页在 warnings 中标记。
- 加密 PDF 拒绝解析。复杂表格、图片和公式没有结构化理解；有些 PDF 字符间距会造成连词或断词，解析文本与原始 PDF 均保留供核对。
- Zotero API 访问不自动携带密钥跟随跳转。允许的文件存储跳转使用新建无凭据客户端，校验 HTTPS 存储域名；下载内容检查 PDF 文件头、大小和 Zotero md5（若提供）。
- 文件原文与私有文献库快照保留在 .audit-data，不进入交付 ZIP。交付只包含实现、测试和精简验收证据。

## API

- GET /api/wb/projects/{pid}/zotero/items：已同步元数据与摘要状态。
- POST /api/wb/projects/{pid}/zotero/{item_key}/pdf：为云端 PDF 附件排队。
- POST /api/wb/projects/{pid}/zotero/{item_key}/pdf-upload：application/pdf 原始请求体，上传本机文件。
- GET /api/wb/projects/{pid}/pdf-jobs：解析状态与逐段知识可见性。
- POST /api/wb/projects/{pid}/pdf-jobs/{job_id}/retry：重新安排失败作业。
- GET /api/wb/projects/{pid}/pdf-jobs/{job_id}/pages?page=1：核对逐页文本及文件哈希。

需要启动 manage.py 管理的第五个进程 pdf；旧部署升级时安装 pypdf==6.12.0，停止后重新启动全部进程。DSH 页面操作仍由用户本机验收。

Zotero 协议依据：[官方文件下载说明](https://www.zotero.org/support/dev/web_api/v3/file_upload)。
