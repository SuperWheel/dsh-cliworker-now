# 原生 CLI 通信协议

v0.7.10 新任务开始使用下表原生协议，v0.8.1 另增 Qoder ACP。旧 Worker 缺少 transport 标记时，仍通过原来的执行通路恢复原生会话；不能只因升级而改换会话所属界面。当前安装版的实际握手、事件和错误决定可用性，官网 main 或 SDK 类型不单独作为能力证据。

| CLI         | 新 Worker 的协议                 | 持久标记         |
| ----------- | -------------------------------- | ---------------- |
| Antigravity | 双向 stdin/stdout stream-json    | agy-stream-v1    |
| Codex       | app-server stdio RPC             | codex-app-v1     |
| Claude      | 双向 stream-json                 | claude-stream-v1 |
| Kimi        | stdio ACP                        | kimi-acp-v1      |
| MiMo        | serve HTTP + SSE                 | mimo-http-v1     |
| ZCode       | app-server 自有 NDJSON           | zcode-app-v1     |
| Grok        | stdio ACP                        | grok-acp-v1      |
| Pi          | 原生 --mode rpc                  | pi-rpc-v1        |
| OMP         | 原生 --mode rpc                  | omp-rpc-v1       |
| Hermes      | 私有 gateway Runs HTTP API + SSE | hermes-http-v1   |
| OpenCode    | serve HTTP + SSE                 | opencode-http-v1 |
| Qoder       | stdio ACP                        | qoder-acp-v1     |

## Qoder ACP（v0.8.1）

已核验官方 npm CLI 1.1.73 的 `qoder --acp`，采用 JSON-RPC 2.0 NDJSON。`session/new` / `session/load` 返回结构化模型和配置；通过 `session/set_config_option` 的 model、reasoning_effort 和 mode 字符串值设置并确认，不从 `--list-models` 的显示表格猜执行 ID，也不套用其他 CLI 的权限控制格式。

Qoder 使用原生 `acceptEdits`，对应 CLI flag `--permission-mode accept_edits`。当前 ACP 只公开 default/acceptEdits/auto/dontAsk/yolo，没有 plan，插件在规划模式下拒绝启动。额外权限请求自动拒绝；`session/cancel` 通知后仍须等待受管进程范围退出。恢复期间历史重放不进入本轮正文，结束后续聊复用已确认的原生 sessionId。

账号主键另外通过同一 CLI 的 SDK stream-json 元数据路径 initialize → account_info 查询。原生 qodercli 认证 payload 使 CLI 自行以 readOnly / 不刷新方式读取账号；插件不解密登录文件，也不引入另一版 SDK 运行时。返回的 userId/organization 用于当前来源身份绑定，不能代替模型授权或 BYOK 路由检查；私有 payload 与进程仍须确认清理。

正文、公开思考和工具分别来自 agent_message_chunk、agent_thought_chunk、tool_call/tool_call_update；原始工具名读取 `_meta.qoder.toolName`。prompt 最终回执的 input/output/total 只作为整轮账单，缺少缓存分类、当前上下文和 Credits 时保持未知。CLI 独立发行版与 SDK 内置运行时不同步，不能用 SDK 专有方法推定 ACP 能力。

本次已执行非模拟初始化和明确标注模拟的空会话配置，未发送真实模型任务。真实账号模型、工具产物、同会话恢复、运行中取消和 Windows 仍待验收；包版本、哈希、实际字段和账号边界见 [Qoder 原生协议核验](qoder-protocol.md)。

## Grok 公开思考（v0.8.1）

可读思考只采用 Grok ACP 实际发出的 `agent_thought_chunk` 文本，完成后按原生 reasoning 块进入官方过程展开。`reasoning_tokens` 表示用量，`signature` 是私密签名，两者都不能转换为可展开的思考正文。

2026-10-17 只读核对用户截图中已完成的 Grok 4.6 运行：原始记录包含两个正文 chunk、一份成功终态，公开思考 chunk 为零；回执虽报告 21 reasoning tokens，但没有可读思考。当前本机 Grok 版本为 1.0.62。此核对复用了已有记录，没有发起新的真实模型任务。

对完整成功、身份明确的 Grok 子会话轮次，若官方已装配的全部 assistant 块均无公开思考，在原生轮次操作行前显示“Grok 本轮未提供公开思考内容”。该说明通过公开的 `conversation.chat.turnTail` 列表扩展接入，不制造 reasoning/工具事件，不替换官方过程、工具、正文或输入组件；已有工具仍可正常展开。运行中、加载中、失败、停止、缺失完整轮次或来源身份不明时不提前下结论，其他 CLI 与主对话不显示此说明。

## 会话与兼容

Host 保持项目与 CLI 选型、账号重检、写锁、同会话互斥及两层 Agent 树。新通路使用稳定的 Worker 私有状态目录，通信连接按每轮独占管理；进程退出不等于会话历史被删除。恢复必须核对原生会话身份，未知 transport 拒绝启动，不能自动回退为新会话或其他 CLI。

Hermes API 会话不能绑定原 CLI/TUI/Desktop/ACP 拥有的会话。历史 stream-json Worker 保留旧通路，新 HTTP Worker 独立建立并恢复 API 会话。Pi/OMP 已在迁移前使用原生 RPC，本次保持其身份、账号租约及引导通路。

## 通信与停止

Client 仅通过 Harness Gateway 访问 Host。Host 在现有受管进程范围内运行原生桥，使用 argv 数组；RPC、ACP、stream-json 与 HTTP 分别由独立 runner 解释，不共用未经核实的请求或权限开关。

桥输出 session、公开 event、native 指标和 result。native 原始记录不直接渲染；用量仅投影实际原生字段。单行、总输入/输出、握手和请求均有上限。断流、错误、未知回执和超时保留本轮文字，不自动重发写任务。额外权限或交互没有对应处理器时明确拒绝，不自动许可。

停止使用本轮私有控制邮箱，先尝试各 CLI 的原生 interrupt/cancel/abort/stop，再让宿主管理器终止并确认整个进程范围。控制回执不是任务停止成功；清理未确认时仍保持原有阻塞。Pi/OMP 引导与停止使用不同的命令命名空间。

HTTP 实例只监听回环地址，使用本轮生成的认证，结束后关闭。Hermes 使用独立私有 API home，仅启用必要 API 平台，不导入用户定时任务或其他消息平台；官方 gateway 的空定时线程随自有进程退出。只从已选自身账号准备私有认证，不改原始登录和配置。需要保留的 API session 数据与每轮认证材料分开清理。

## 验证

原生 runner 回归使用明确标注的模拟子进程或本地 HTTP/SSE 服务，覆盖错误、权限拒绝、恢复、取消、迟到/历史事件和真实终态。`scripts/smoke-native.ts --help` 提供隔离 preview 的真实验收入口，必须使用用户已授权的当前保存选型；缺少保存模型/强度或账号能力时记阻塞，不猜选型。

实际执行结果、安装版差异、平台及未验证项统一记入 `doc/tasks.md`，不能用模拟测试或初始化握手代替模型和产物验收。

### 回复、工具与统计投影

v0.7.10 按原生消息/part/block 或有明确边界的连续文本段归并流式回复，分别核对 delta、完整快照及最终响应。桥终态的 `resultScope` 明确区分本轮聚合与最后回复，避免重复内容或误删正文。工具事件只传公开 `toolCall` 字段（真实 ID、明确父 ID、名称、输入、输出、命令、退出码），存储重开后保留；未知结构仍可查看原有通用详情，不伪造父调用。

原生 `native` 帧的当前窗口、累计 usage、严格匹配模型容量和原生分类通过白名单进入 telemetry。公开思考的签名、加密和 redacted 字段不投影。各 CLI 指标公式及缺失边界独立核对，详见 [原生回复与上下文矩阵](native-inspection.md)；原生过程界面适配见 [公开过程设计](public-process.md)。

## 官方协议依据

- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Claude streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)
- [Antigravity headless](https://www.antigravity.google/docs/cli/headless/)
- [Kimi ACP](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp)
- [Grok Agent 模式](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md)
- [ZCode 原生协议](https://github.com/zai-org/ZCode/blob/main/packages/shared/src/zcode-protocol/index.ts)
- [OpenCode Server](https://opencode.ai/docs/server/)
- [MiMo Server](https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/cli/src/server/server.ts)
- [Hermes API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)
- [Pi RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
- [OMP RPC](https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md)
- [Qoder ACP](https://docs.qoder.com/cli/acp)
- [Qoder CLI 参数](https://docs.qoder.com/cli/cli-reference)
