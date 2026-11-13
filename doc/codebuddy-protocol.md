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
- `allow_always`：后续同类命令不再询问；`~/.codebuddy/settings.json` 与项目目录都没有新增规则。2026-11-09 复测：授权只保存在 CLI 进程内，同一轮第二条 `touch` 不再询问，同会话下一轮（插件每轮重启 CLI 并 `session/load`）再次询问。WorkBuddy 内置 CLI 行为相同，也映射为「本会话始终允许」。
- 拒绝：命令不执行，被拒工具**没有终态事件**，本轮立即结束：`stopReason: cancelled`，`_meta['codebuddy.ai/outcome']: PERMISSION_DENIED`，`codebuddy.ai/errorMessage: "Permission denied for tool(s): unknown"`。
- 用户停止：`session/cancel` 后约 0.6 秒返回 `stopReason: cancelled`，outcome 为 `CANCELLED`。

程序中另有 agent→client 私有请求 `_codebuddy.ai/requestSensitiveApproval`、`_codebuddy.ai/question`，本次实测未出现；插件以“客户端不支持”回复。

## 6. 账号与站点

- 认证文件：`~/Library/Application Support/CodeBuddyExtension/Data/Public/auth/Tencent-Cloud.coding-copilot.info`（0600）。Windows 为 `%LOCALAPPDATA%\CodeBuddyExtension\…`，Linux 为 `~/.local/share/CodeBuddyExtension/…`。退出时写 `<file>.logged-out`。文件每次启动都会重写，修改时间不能作为账号绑定。
- 站点：CLI 依据认证文件中的 `auth.domain` 或 `CODEBUDDY_INTERNET_ENVIRONMENT` 判断；ACP 不公开。`_codebuddy.ai/getUserInfo` 的响应带 `accessToken`，插件不调用。
- `~/.codebuddy/settings.json` 可能含网关密码（本机 19:07 新增 `gateway.auth`、`gateway.password`），插件只在内存中取 `env.CODEBUDDY_INTERNET_ENVIRONMENT`。
- 2026-11-07 用户批准“允许只读站点”：插件在内存中解析认证文件，只取 `auth.domain`，按包内 `product.json` 的 `authentication.attributes` 映射：`internalDomain`（`www.codebuddy.cn`、`copilot.tencent.com` 等）→ 中国站，`iOADomain` → iOA，`cloudHostedDomain`（通配，如 `*.sso.codebuddy.cn`）→ 企业域，`externalDomain`（`www.codebuddy.ai` 等）→ 国际站。CLI 自身的判定顺序相同，`selfhosted` 来自设置中的企业端点。
- 没有 login/logout 子命令，登录与退出在交互界面用 `/login`、`/logout`。

## 7. 图形账号引导与采集边界（2026-11-07）

2.181.0 的隔离 200 × 60 首屏为 `Do you trust the files in this folder?`。后续获准接受空临时项目的信任后，采到空编辑器、`/login` 四站点菜单/高亮重绘、中国/国际浏览器等待及未登录 `/logout` 返回菜单。生产 trust 要求用户在窗口确认，只信任当前文件夹；空编辑器自动 `/login`，当前高亮决定导航键。中国/国际为 browser，精确授权主机仅 `copilot.tencent.com` 与 `www.codebuddy.ai`。企业 endpoint 与 iOA（链接含 ioa 参数）保留原生，不收集凭据。切换自动 `/logout` 只提交一次；登录菜单不补按 Enter，回读明确退出并清理后才开始新登录。未知画面保留原生；没有条款接受或真实授权。

本地状态不再把 EACCES/EPERM/ENOTDIR、目录、符号链接或非法退出标记当成退出成功。账号展示复用获准的 `auth.domain` 内存投影确认 JSON 可读；读取失败、字段缺失或格式无效保持未知。只有明确不存在或普通 `.logged-out` 文件证明未登录；登录需要动作前明确未登录到新 authenticated 的转换，不以 mtime 或同站点标签证明新账号。未新增凭据字段读取。详见 [真实采集记录](../openspec/archives/add-new-cli-graphical-login/capture-2026-11-07.md)；有效账号退出和 Desktop/Windows 仍待验收。

## 8. 用量、积分与分支（2026-11-08）

- `session/prompt` 结果只有 `stopReason`、`userMessageId` 与 `_meta['codebuddy.ai/conversationRequestId']`，不含本轮 token 或积分。`usage_update` 只用于上下文占用。
- CLI 把每次模型请求写入 `<CODEBUDDY_CONFIG_DIR 或 ~/.codebuddy>/projects/<项目键>/<sessionId>.jsonl`。项目键：cwd 真实路径中的 `/ \ :` 换成 `-`，去掉首尾 `-` 并合并重复；超过 255 字节时截到 180 字节后接 `-` 与 djb2 的 36 进制值。每行 `providerData` 带 `conversationRequestId`、`messageId`、`requestModelId`、`usage`（input/output/total、cached、reasoning）与 `rawUsage.credit`；同一请求的并行工具调用重复写同一 `messageId`。子 Agent 记录在 `<sessionId>/subagents/`。
- 插件在 `end_turn` 后按会话、用户消息、请求 ID、cwd 与模型精确定位本轮，校验后按 `messageId` 去重汇总，按积分显示。缺积分或有子 Agent 时积分为未知，token 不当积分。`hy4free` 实测 `credit` 为 0；非零积分未实测。WorkBuddy 内置 CLI 格式相同，配置根取安装探测结果。
- 分支：ACP 调 `session/fork` 实测返回 Method not found，`initialize` 不公开 `sessionCapabilities.fork`；插件不提供分支。`--fork-session` 仅用于终端续接。

## 9. 上下文分类（2026-11-09）

- ACP 只发 `usage_update` 的 `used`/`size`，并且实测一轮里可能一次都不发；分类只在本地命令 `/context` 里提供。`/context` 不调用模型，输出为一段 `agent_message_chunk`（`_meta['codebuddy.ai/commandKind']='local'`），结果 `stopReason: end_turn`、`_meta['codebuddy.ai/outcome']='SUCCESS'`，正文为三重反引号包住的文本：头部「模型 · 已用/容量 tokens (百分比)」，随后 System prompt、System tools、可选的 MCP tools / Memory files / Skills、Messages、Free space、Autocompact buffer，数值按 0.1K 取整（`4.5k`、`1.2m`，小于 1000 为整数）。头部模型取会话当前模型。
- 在 Worker 自身会话里执行 `/context`，命令与输出会作为用户消息（`skipRun`）写进会话，并进入下一次模型请求（实测 Messages 302→584）。
- 插件做法：本轮已结算（`end_turn` 或因拒绝审批结束）、未被停止、Worker 进程退出后，另起 `codebuddy --acp --no-session-persistence`，`initialize` → `session/load`（同一会话、同一 MCP 列表）→ 必要时 `session/set_config_option` 设为本 Worker 模型 → 发送 `/context`。只接受本次提示期间没有思考、工具或模型请求 ID 的输出，头部模型须与本 Worker 一致；8 秒内未完成即放弃。实测副进程约 1.2 秒，会话文件 sha 与文件数不变。副进程随运行一起停止，它的退出状态不影响本轮结果。
- 遥测：三行取 System prompt、System tools + MCP tools、Messages；总量与容量取同一份报告，标注为原生估算（按 0.1K 取整）。下一次 `usage_update` 会清掉旧分类。
