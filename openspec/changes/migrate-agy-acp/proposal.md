# Proposal

## Why

Antigravity stream-json 的私有 MCP 工作区改变命令默认目录，Hook overwrite.Cwd 只能改变记录；无终端沙箱时也没有可靠的原生审批通道。agy 1.4.11 的 ACP 提供会话级 MCP 注入和逐次权限请求，需以实际能力探测迁移并保留旧版后备。

## What Changes

- 在 native-acp 上增加 Antigravity 适配，运行前检测 acp --stdio，规划及不兼容旧会话保留 stream。
- ACP 进程 cwd 与 session cwd 都为项目，不注入私有工作区；MCP 通过 session/new 或 load 注入。
- 核对模型、thought_level、会话身份，保留取消、时限、账号绑定、互斥与工具结果边界。
- 删除无效命令 Hook relay，保留 stream denied_actions/finished_reason 修复与无沙箱提示。
- 合并 relay-agy-sandboxless-commands 有效内容及诊断依据；提供单轮真实验收脚本但本次不发送模型 prompt。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `worker-permission-levels`: Antigravity ACP 探测、权限映射和规划后备。
- `harness-cli-tool-bridge`: ACP MCP 注入与工作目录边界。
- `worker-run-outcomes`: ACP 会话恢复、结果、usage 与 stream 拒绝/部分结束判定。

## Impact

Host 的 native-agy、native-acp、native-worker、工具桥注入、遥测和隔离打包；相关测试、README 与设计文档。Client/Gateway、账号配置、版本 0.8.4、Windows 安装及 Desktop 不变。不发送真实模型输入，不读取凭据，不发布。依据现有源码及 `.test-data/agy-command-relay-validation/` 实测记录，真实工具执行仍由主控验收。
