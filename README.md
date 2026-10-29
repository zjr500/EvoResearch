# EvoResearch

DSH 原生科研工作台：AI 自主实验、自进化科研知识库。当前版本 **0.8.0**。

默认采用 **Windows 本机部署，不安装或自动启动 Docker**。左侧 DSH 导航、中间原生对话、右侧双模块工作台；Graphiti 负责图谱与混合检索，不引入 LightRAG。

## 快速开始

1. 将本仓库完整下载或解压到可写目录，例如 `D:\EvoResearch`。
2. 首次双击根目录 `Install.cmd`，按提示提供本机 DeepSeek 密钥文件路径。
3. 以后双击 `Start.cmd`，打开 `http://127.0.0.1:9000`（首次认证使用启动器打开的登录链接）。
4. 点击顶部 **EvoResearch** 启用工作台；本机访问码位于 `.audit-data/workbench-local/access-token.txt`。
5. 停止使用运行 `Stop.cmd`；排查问题运行 `Check.cmd`；修改配置运行 `Configure.cmd`。

需要 Windows 10/11 x64 与网络；安装器准备 Python 3.12、Node 24、pnpm 11 和依赖。Graphiti 功能另需 Neo4j + APOC，可连接独立或远程数据库；数据库离线不阻止网页启动，但知识检索、入库与知识增强实验不可用。首次安装和全新机器复现尚需实际验收。

## 目录

```text
EvoResearch/
├── Install.cmd / Start.cmd / Stop.cmd / Check.cmd / Configure.cmd
├── apps/workbench/       # 科研 API、PDF、Windows 进程管理
├── plugins/dsh/          # DSH 原生工作台与工具扩展
├── services/research/    # 调度、MLflow、Graphiti、知识回流
├── packages/autoresearch/# 实验方案、代码修改、训练与预算
├── contracts/           # 接口与数据契约
├── tests/               # 各模块回归测试
├── docs/                # 部署、架构、迁移、验收
├── examples/            # 示例
├── scripts/             # 安装、测试、仓库检查与源码打包
├── deploy/              # 可选的历史容器部署配置
├── .github/workflows/   # CI 定义
├── pyproject.toml / requirements-lock.txt / package.json
└── .env.example         # 手动/可选 Compose 配置参考，无真实凭据
```

本机生成的 `.audit-*`、`.secrets`、`.env`、数据库和运行记录均不纳入源码交付。Windows 启动器读取私有 JSON 配置，不自动读取 `.env`。

## 文档入口

- [Windows 安装与运行](docs/workbench/windows-deployment.md)
- [迁移到另一台电脑](docs/migration/portable.md)
- [部署与数据恢复](docs/deployment.md)
- [双核心工作台](docs/workbench/two-core-workbench.md)
- [最新浏览器验收范围](docs/workbench/windows-native-check-20261029.json)
- [开发协作](CONTRIBUTING.md)
- [第三方说明](THIRD_PARTY_NOTICES.md)

## 开发与验证

```powershell
./scripts/setup.ps1 -Python python
.audit-venvs/phase5/Scripts/python.exe scripts/test.py
.audit-venvs/phase5/Scripts/python.exe scripts/check_repository.py
.audit-venvs/phase5/Scripts/python.exe scripts/package_source.py
```

打包输出在 `dist/`，包含 Git 已跟踪及未忽略的源码/文档和完整隐藏 `.git` 目录，附 SHA256 清单；不包含密钥、依赖环境或实验数据。打包前检查历史 Git 对象中的大文件和凭据特征。离线电脑仍需提前准备依赖，源码包不是免安装运行环境。

第五阶段知识增强与无增强结果持平，保留真实结论。当前数据库离线；页面验收不代表在线知识闭环或多任务收益验证完成。
