# Design

## Context

见 proposal.md。SDK 包只读研究，不执行其中代码。参考根：`/private/tmp/claude-501/-Users-leeyl-AI-Project-DeepSeekHarness-cliworker-now/63f78787-0a41-4a97-82fc-6ac9a10e2670/scratchpad/`，下述路径相对该根。

## Goals / Non-Goals

新旧元数据通路共用隔离、解析及退出规则；不使用 ACP 查询目录，不建立 session，不实现 SDK 全局 daemon 或账号回调刷新。

## Decisions

### 决定 1：使用一次性 stdio daemon 的账号查询面
- 最终决定：`--sdk` 加 `QODER_AGENT_SDK_DAEMON=1`；SDK 版本为 1.0.59，旧 worker 为 1.0.53。参数数组、标准输入输出管道，不接触 socket、端口或全局 daemon。握手为 `daemon.initialize`，请求 `daemon_protocol_version:2`、`sdk_version:"1.0.59"`、能力 `multi_session_v2` 和 `daemon_queries_v1`，校验回执协议与能力。然后 `daemon.account_info`、模型查询 `daemon.get_models`（`fetchStrategy:"live"`、当前账号 uid），最后 `daemon.shutdown`。
- 放弃的方案：复用 SDK 的进程级全局 daemon —— 无法证明查询归属与退出；ACP 查询 —— 既有只读约束不允许。
- 影响：模型查询与账号绑定在同一个 daemon，保留操作级快照去重；不增加 SDK 依赖。
- 出处：`qsdk59/package/dist/daemon/protocol.d.ts:11-156,219-236,315-318`；`dist/index.js` 的 `vn="--sdk"`、`ro`（原生进程仅 `[vn]`）、`_n`（`[eo]:"1"`）和 `Mt.initialize`。`ELECTRON_RUN_AS_NODE` 仅官方 SDK 的脚本/worker 解释器分支使用，本插件沿用 nativeLaunchArgv。

### 决定 2：原生只读认证与私有可写配置
- 最终决定：沿用一次性 0600 auth.json 和 `QODER_SDK_AUTH_PAYLOAD_FILE`；`daemon.initialize.auth` 同时传官方 payload（qodercli 或 accessToken）。原生登录由 CLI 在 `QODER_SDK_AUTH_CONFIG_DIR` 只读借用，写入根使用所选品牌的 `*_CONFIG_DIR` 临时目录；PAT 使用临时认证根。项目 .env 与旧设置迁移检查、customs 复制、机器标识检查保持原规则。代理环境不覆盖、不删除，也不发 `daemon.setproxy`。
- 放弃的方案：插件解密账号、执行 login、允许 job/serviceAccount 回调 —— 超出既有认证边界。
- 影响：账户信息仅保留必要投影，错误使用静态脱敏映射，原始 stdout/stderr 不落盘。
- 出处：`qsdk59/package/dist/index.js` 的 `ue.prepare/buildEnv/createAuthPayloadFile`、`wt`；`dist/daemon/daemon-auth-rpc.d.ts` 与 `Sn/Xa/Za`：仅 jobToken/serviceAccount 需要反向 `daemon.auth.fetch_job_token` / `fetch_service_account_token`，本插件拒绝这些请求。本机 1.1.89 二进制内 `YAe`：qodercli 为 `storagePolicy:"readOnly",refreshStrategy:"none"`；accessToken 为 `memoryOnly/none`；账号初始化函数 `A` 为 qodercli 设置 `rn({mode:"readOnly"})`。

### 决定 3：字段沿用、协议分流与失败界限
- 最终决定：NDJSON 帧为 `{type:"control_request",request_id,request:{type:"daemon.<method>",...params}}`；响应在 `response.request_id/subtype/response`。新版直接查询 `account_info.account` 和 `get_models.models`，旧版取 initialize 的 models/account；模型字段继续使用 `value/displayName/isEnabled/efforts/supportsDisabled`。仅原生明确启用的模型可选，customs 不丢弃。优先读取解析后实际入口的官方包名与版本、官方版本化二进制布局；无法确定则先 worker。仅 `sdk_worker_removed`/42 或明确未知 `--sdk` 可切换一次，共享原查询总预算。
- 放弃的方案：根据可执行文件任意名称猜版本、对任意错误重试、硬编码模型 —— 会错配账号/掩盖失败。
- 影响：模型 30 秒、账号 15 秒；输出总量不超过既有预算与 4 MiB 较小值；两次尝试之间必须先确认清理。超时/取消/协议错误和清理失败不重试；不直接回显原生错误文本。
- 出处：`qsdk59/package/dist/daemon/protocol.d.ts:45-108,219-236,315-318`，`dist/protocol/common.d.ts:299-332`；旧 SDK `qsdk53/package/dist/protocol/control.d.ts` 的 initialize/account_info/end_session；现有 `parseQoderModelState`。新版 `isEnabled` 在类型上可选，缺失时保持拒绝，不能猜启用。

### 决定 4：结束确认与回退
- 最终决定：daemon 必须取得 shutdown 成功，再主动终止并等待 ProcessBackend 范围退出；旧版保持 end_session。任何提前退出或未确认结束都拒绝结果，范围未退出不删除临时目录。正常取消触发终止，不返回缓存成功。
- 放弃的方案：关闭 stdin 就当成功、只看退出码 0 —— 无法保证查询和资源清理完成。
- 影响：复用既有 Windows Job 与 POSIX 自有终止判断。SDK 官方 stopInternal 会吞 shutdown 错误，本插件继续采用更严格的结束回执规则。
- 出处：`qsdk59/package/dist/index.js` 的 `shutdown`、`stopInternal`；本项目 `ProcessBackend` 与 `ProcessCleanupUnconfirmedError`。

## Risks / Trade-offs

- 新 CLI daemon 的账户面与旧 initialize 字段/配置行为可能不同 → 模拟覆盖，真实两版及旧版只读查询，核对用户目录 mtime 清单。
- 代理或登录已过期 → 明确记录真实失败，不改代理、不刷新登录。
- 平台差异 → 本机实测只证明本机；Windows/Linux 不以模拟替代实机。

## Migration Plan

只发布 Host 元数据逻辑和文档，不迁移持久数据；回退代码不触及用户配置。完成最小及指定全量验收与隔离构建，任务证据完整后才归档；不运行正式 build、不提交 Git。

## 源包核验与真实边界

- 只读 package.json 确认两个包均为 `@qoder-ai/qoder-agent-sdk`，版本分别为 1.0.53 与 1.0.59。
- 1.0.53 `dist/index.js` SHA-256：`6be679223f4596b95371b187dddbd121bf94268c4cb92f80a37ca24995ab3fd2`。
- 1.0.59 `dist/index.js` SHA-256：`d7b28e41087eafe2913affdfbf37cf72825ff4d1c458debf3fc1490481bf895f`。
- 2026-11-14 实机：两版 1.1.89 及国际版 1.1.73 均识别 Free 账号。中国版启用模型 1；国际版新旧入口均返回 16 个停用模型，不能据此声称国际版可用目录验收通过。原生回执是业务边界，不以模拟目录替代。详见 tasks.md 3.1。
