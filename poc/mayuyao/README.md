# 最小验证脚本

- `experiment_loop.mjs`：用模拟指标检查任务输入、实验轮数、停止条件与测试集隔离。
- `ssh_loopback.py`：在本机临时启动 OpenSSH 服务，检查密钥登录、主机指纹校验和命令输出回传。脚本使用 macOS 的 OpenSSH 路径。
- `week2_model_check.py`：读取第二周《领域模型及用例模型》DOCX，核对用例、契约数量和接口消息，并演练任务状态规则。仅使用 Python 标准库。

第二周检查示例：`python3 week2_model_check.py 领域模型及用例模型_v1.0_261107.docx`。原文见 [main 分支](https://github.com/zjr500/EvoResearch/blob/main/docs/领域模型及用例模型_v1.0_261107.docx)。这些脚本不代表真实 GPU 或完整插件测试。
