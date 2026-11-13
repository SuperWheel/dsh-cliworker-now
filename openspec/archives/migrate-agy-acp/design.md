# Design

## Context

见 proposal.md。复用 native-acp 的 JSON-RPC、工具事件、审批与取消，增加 native-agy-acp 适配；stream runner 保留为兼容路径。Host 不能预先创建 agy-tools，否则 ACP 也受默认目录排序影响。

被替代的 relay-agy-sandboxless-commands 诊断依据：Windows 1.4.7 与 Mac 1.4.11 的 run_command 缺 Cwd 时选择按路径排序最前的工作区；Hook overwrite.Cwd 只改变记录。Mac A2/A3/A4/A5 和 ACP 两次探针显示，只有不加额外工作区、进程和 session cwd 都为项目时命令实际在项目。Win11 23H2 无终端沙箱，stream 无头默认策略自动拒绝命令。原始证据保留在 `.test-data/agy-command-relay-validation/`，不把旧 Hook 方案归档为成功。

## Goals / Non-Goals

**Goals:** 新版 ACP、旧版 stream，保留模型/账号/权限与过程证据，删除无效命令 relay。

**Non-Goals:** 不改账号配置、CLI 安装、Desktop、版本号和 Client；不进行真实模型调用或 Windows 操作。

## Decisions

1. 每轮先对实际启动入口运行 `acp --help`，确认 --stdio；不缓存账号能力。规划仍走 stream plan：help 的 --agent 只有任意名称，没有可核实的 plan 契约，initialize/session 未返回 modes 或 permission config。仅能力探测/加载兼容失败可后备，发出 prompt 后不重试。
2. 保留历史 `agy-stream-v1` transport 标记作为兼容的 bridge 身份，内部逐轮协商；不批量改持久化记录。已有 ID 用 session/load，失败前未发布新会话、未发 prompt，关闭 ACP 后同 ID stream；错 ID 回执是协议失败而非不兼容。
3. 模型以 models.availableModels 的精确 ID 调 session/set_model，再 session/load 回读（1.4.11 set_model 返回 {}）。configOptions.model 是基础名，thought_level 单列；设置强度时只接受返回选项，回读实际模型必须保持所选 ID，不按字符串后缀推算映射。
4. MCP 通过 session/new/load.mcpServers 注入。Host 只准备私有连接环境；仅 stream runner 创建旧私有工作区。ACP 不添加私有 --add-dir，不写用户配置。项目自身额外 --add-dir 保留，并提示其可能改变默认命令目录。
5. ACP 没有 --mode auto，也不公开沙箱或账号 auto 状态；Mac 与 Windows 零模型探测在 initialize/session/new 阶段均无沙箱提示。自动档因此每轮先以 stream 入口 `--mode auto --sandbox` 零输入启动一次，读取 agy 输入前自己的报告，与 stream 降级同一依据：账号警告或无警告的 `init` 表示主机检查通过，ACP 用 `--sandbox --dangerously-skip-permissions`，命令由终端沙箱约束、不再确认，等价于原 stream Mac 自动审批；主机无沙箱警告时省略 `--sandbox`；超时或无报告时不 skip（非 Windows 仅 `--sandbox`）。不 skip 时逐条请求 DSH。探测去掉 `--conversation`、不写输入，确认进程退出后才启动 ACP；时限为 10 秒与总时限四分之一中的较小值。完全权限用 --sandbox=false 和原生 skip。依据：2026-10-31 Mac 真实一轮显示 ACP 只加 `--sandbox` 时 `pwd -P` 仍发 request_permission，不 skip 会比原 Mac 自动审批更严格。代价是每轮多一次约 1–2 秒的 agy 启动，不保存跨运行的能力缓存。
6. 通用 ACP 加可选选型适配回调；Antigravity 用自己的模型回读，其他 CLI 保持原实现。迟到审批不得在 end_turn、停止或超时后发 allow。取消先 session/cancel，finally 结束并等待进程范围清理；Host 原有时限、空闲暂停和账号续接不变。
7. usage 使用独立 cliworker.agy_prompt_usage 本轮记录；不要伪造 stream result 的累计含义。工具失败复用 native-tool-outcomes。stream 去掉 relay 后所有未关联 denied_actions 是原生拒绝，不能以用户拒绝成功语义掩盖。

## Risks / Trade-offs

- 实际 MCP 子进程和 tools/call → 本次用模拟自动化覆盖接线，真实脚本由主控执行，未验收不勾选。
- 工作区内编辑审批、无沙箱 ACP 报告 → 零模型不能证明模型发起工具的行为，保留待验收和逐次确认。
- 沙箱判定依赖 agy 的 stderr 警告文本 → 与 stream 降级共用同一正则；文本变化时落到「无报告」，只会更严（逐条确认），不会误跳过确认。若某版本在无沙箱主机上先报账号原因，会被误判为有沙箱；当前证据（Windows 23H2 报主机原因）不支持这种顺序，仍需留意。
- 旧会话共享存储 → 零模型 list 已匹配 Mac A3 的 stream ID，但未实测其 load；每轮仍实际 load。
- 多项目 add-dir 默认目录排序 → 保留用户项目规则但明确限制，不用 Hook 伪造目录保证。
- 日志权限 → 2026-10-31 零模型探针完成后检测到 stderr 权限拒绝，停止进一步真实探测，不重定向日志或提权绕过。

## Migration Plan

新增适配、迁移工具桥准备位置、删除命令 relay 及专属测试/打包项，保留旧 stream 结果修复。串行关联测试、typecheck、严格规格验证、diff 检查、preview；不正式 build。真实模型与 Windows 验收未完成前不归档；旧安装版自动后备。
