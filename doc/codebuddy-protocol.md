# CodeBuddy Code 原生协议实测

- 版本：`@tencent-ai/codebuddy-code` 2.181.0（macOS，`/opt/homebrew/bin/codebuddy`）。
- 日期：2026-11-07。所有启动都设置了 `DISABLE_AUTOUPDATER=1`。
- 真实模型调用只用免费模型 `hy4free`（用户批准），工作目录是会话 scratchpad 下的临时目录。
- 探测时未读取认证文件内容；凭据相关结论来自文件名、文件时间与程序字符串。站点读取规则见第 6 节。

## 1. 启动与握手

`codebuddy --acp`（stdio，NDJSON JSON-RPC 2.0）。`initialize` 回执：

- `protocolVersion: 1`，**没有 `agentInfo`**。
- `agentCapabilities`：`loadSession: true`，`promptCapabilities.image/embeddedContext: true`，`mcpCapabilities.http/sse: true`，另有私有 `delegateToolsSupport`、`multitaskSupport`、`metaPromptSupport` 等。
- `authMethods`：`iOA`、`external`（Google/GitHub，国际站）、`internal`（微信，中国站）、`selfhosted`（企业域）。插件以此判定原生身份。

进程在关闭 stdin 后**不会自行退出**；SIGTERM 后以退出码 0 结束，未发现残留进程。

## 2. 会话

- `session/new` → `sessionId`、`models`、`modes`、`configOptions`、`multitaskOn`，随后发 `config_option_update`、`available_commands_update` 与私有通知 `_codebuddy.ai/command`。
- `session/load` 先重放历史（`user_message_chunk`、`agent_thought_chunk`、`agent_message_chunk`、`tool_call`、`tool_call_update`、`_codebuddy.ai/checkpoint`），再返回含 `models` 与 `configOptions` 的结果。续聊回复能引用上一轮内容。
- `--no-session-persistence` 与 `--acp` 同用时，`session/new` 不在 `~/.codebuddy/projects/` 下留会话文件（目录查询使用）；不带时会留下 `<sessionId>.jsonl`。

## 3. 配置项

| id | 类型 | 说明 |
| --- | --- | --- |
| `mode` | select | `default`（Always Ask）、`acceptEdits`、`plan`、`auto`（AI 审查代批；审查失败只拦截该动作，不回退为询问）、`dontAsk`、`bypassPermissions`、`fullAccess`（连危险命令检查也跳过）。设置后发 `current_mode_update` |
| `model` | select | 17 个模型，`currentValue` 初始为 `hy4free` |
| `thought_level` | select | 随模型变化：`hy4free` 为 `high`、`enabled`；`hy3` 为 `minimal`…`max`、`enabled`；`enabled` 即模型默认 |
| `sandbox` | select | `true`/`false`，默认 `false` |
| `multitask` | boolean | 类别 `_codebuddy.ai/multitask`，默认 false |

`session/set_config_option` 返回只含 `configOptions` 的结果。`thought_level` 的可选值是 `_meta.effortOptions` 的超集（`hy3` 的 `effortOptions` 为 low/medium/high/xhigh，配置项还接受 minimal、max）；插件按 `effortOptions` 提供强度。

模型 `_meta`：`supportsImages`、`supportsReasoning`、`credits`（如 `x0.00 credits`）、`maxInputTokens`、`effortOptions`。存在同名模型（`hy4free`/`hy4std` 都叫 Hy4，`hy3`/`hy3-x` 都叫 Hy3）。

## 4. 回合事件

- `agent_thought_chunk`、`agent_message_chunk`（`content.type: text`）。
- 工具：先发 `tool_call`（`title` 为工具名、`kind: other`、`status: in_progress`、空 `rawInput`），随后多次 `tool_call_update` 流式补全 `rawInput`；参数完整后再发一次同 ID 的 `tool_call`（`status: pending`，完整 `title`、`kind`（read/edit/execute）、`locations`、`content`）；执行后 `tool_call_update` 带 `status: completed`、`content`、`rawOutput`。`_meta['codebuddy.ai/toolName']` 为原生工具名（Read、Write、Bash）。
- `session_info_update._meta`：私有阶段 `codebuddy.ai/agentPhase`（idle、preparing、model_requesting、model_streaming、model_done、tool_executing、waiting_for_permission）、`codebuddy.ai/interruptionRequest`、`codebuddy.ai/permissionResolved`。插件不投影为进度。
- `usage_update`：`used`、`size`（上下文），`_meta.usage` 为单次响应 token（prompt/completion/total、reasoning）。
- 私有通知：`_codebuddy.ai/checkpoint`（文件变更）、`_codebuddy.ai/modResidentInvalidate`。
- 终态：`session/prompt` 结果 `stopReason`（`end_turn`、`cancelled`）与 `_meta['codebuddy.ai/outcome']`。

## 5. 审批

`default` 模式下读文件不询问；写文件与命令各发一次 `session/request_permission`：

```json
{ "options": [
    { "kind": "allow_always", "name": "Always Allow", "optionId": "allow_always" },
    { "kind": "allow_once", "name": "Allow", "optionId": "allow" },
    { "kind": "reject_once", "name": "Reject", "optionId": "reject" } ],
  "toolCall": { "toolCallId": "...", "rawInput": { "command": "..." },
                "_meta": { "codebuddy.ai/toolName": "Bash" } } }
```

请求没有 `title`、`kind`、`locations`，要从同一 `toolCallId` 之前的 `tool_call` 取。

- 允许：工具执行，`notes.txt` 写入 `ok`。
- `allow_always`：本会话后续同类命令不再询问；`~/.codebuddy/settings.json` 与项目目录都没有新增规则，判定为会话级。
- 拒绝：命令不执行，被拒工具**没有终态事件**，本轮立即结束：`stopReason: cancelled`，`_meta['codebuddy.ai/outcome']: PERMISSION_DENIED`，`codebuddy.ai/errorMessage: "Permission denied for tool(s): unknown"`。
- 用户停止：`session/cancel` 后约 0.6 秒返回 `stopReason: cancelled`，outcome 为 `CANCELLED`。

程序中另有 agent→client 私有请求 `_codebuddy.ai/requestSensitiveApproval`、`_codebuddy.ai/question`，本次实测未出现；插件以“客户端不支持”回复。

## 6. 账号与站点

- 认证文件：`~/Library/Application Support/CodeBuddyExtension/Data/Public/auth/Tencent-Cloud.coding-copilot.info`（0600）。Windows 为 `%LOCALAPPDATA%\CodeBuddyExtension\…`，Linux 为 `~/.local/share/CodeBuddyExtension/…`。退出时写 `<file>.logged-out`。文件每次启动都会重写，修改时间不能作为账号绑定。
- 站点：CLI 依据认证文件中的 `auth.domain` 或 `CODEBUDDY_INTERNET_ENVIRONMENT` 判断；ACP 不公开。`_codebuddy.ai/getUserInfo` 的响应带 `accessToken`，插件不调用。
- `~/.codebuddy/settings.json` 可能含网关密码（本机 19:07 新增 `gateway.auth`、`gateway.password`），插件只在内存中取 `env.CODEBUDDY_INTERNET_ENVIRONMENT`。
- 2026-11-07 用户批准“允许只读站点”：插件在内存中解析认证文件，只取 `auth.domain`，按包内 `product.json` 的 `authentication.attributes` 映射：`internalDomain`（`www.codebuddy.cn`、`copilot.tencent.com` 等）→ 中国站，`iOADomain` → iOA，`cloudHostedDomain`（通配，如 `*.sso.codebuddy.cn`）→ 企业域，`externalDomain`（`www.codebuddy.ai` 等）→ 国际站。CLI 自身的判定顺序相同，`selfhosted` 来自设置中的企业端点。
- 没有 login/logout 子命令，登录与退出在交互界面用 `/login`、`/logout`。
