## Why
Mac 候选版 OMP 在嵌套 Worker 项目任务中显式向 Bash 传入仓库根目录，并写到该目录；工具错误与停止原因对象未统一转换为可读文本。

## What Changes
- OMP 显式传原生 --cwd；Pi 保留原生进程 cwd，双方补充 Worker 项目提示及一致 PWD。
- 工具回执失败提取 message/text/content，未知对象输出有界 JSON；停止异常在进入 Harness 前转换为可读 Error。
- 加入标注「模拟」的回归，不调用真实模型、不构建或提交、不修改账号确认代码。

## Capabilities
### New Capabilities
- `worker-project-error-boundaries`: Worker 项目语义与工具错误展示边界。
### Modified Capabilities

## Impact
Host Pi/OMP 启动与 Harness 工具回执投影；README、设计说明及相关模拟测试。Grok 仅记录既有 HTTP 402 证据，不修改。
