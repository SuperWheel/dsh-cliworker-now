# TRAE CLI CN 原生协议与权限

核验日期：2026-11-07，macOS 安装版 `traecli 0.213.1`（`installation: public`）。插件 v0.8.8 的接入定稿见 [提案](../openspec/changes/add-traecn-cli/proposal.md)、[设计](../openspec/changes/add-traecn-cli/design.md) 和 [规格](../openspec/changes/add-traecn-cli/specs/traecn-cli/spec.md)。本页整理这些文件与 [任务 §0](../openspec/changes/add-traecn-cli/tasks.md) 已记录的前置实测，不表示本次文档工作重新执行了 CLI，也不表示插件集成或 Desktop 已验收。未有实测记录的内容标为「待核实」。

## 1. 身份、安装与账号

| 项目 | 安装版与接入决定 |
| --- | --- |
| 插件 CLI / 会话协议 | `traecn` / `traecn-acp-v1`，名称 TRAE CLI CN |
| 官方程序 | `traecli` → `~/.local/share/traecli/current/traex`；实测安装目录为 `releases/0.213.1-aarch64-apple-darwin` |
| 自动发现 / 手动配置 | 只自动查 `traecli`；macOS / Linux 补 `~/.local/bin/traecli`；`traecnExecutable` 默认 `traecli`，可指定绝对路径 |
| 身份核对 | `--version` 首行为 `traecli <版本>` 且含 `installation:` 行；ACP `agentInfo.name` 必须为 `traecli-acp` |
| 同名程序 | 安装器另建 `trae-cli`、`trae-agent`、`coco`、`ta` 链接；不用于自动发现。手动指定同品牌链接仍核对版本身份；开源 Python bytedance/trae-agent 不是此 CLI |
| 国内 / 国际 | 2026-11-07 只找到国内版，未发现官方国际版 CLI；不建国际版入口 |
| 配置与运行根 | `TRAE_HOME` 默认 `~/.trae`，配置 `$TRAE_HOME/traecli.toml`，账号和运行数据 `$TRAE_HOME/cli/`；插件继承原生环境，不改配置根 |

官方安装入口为 `sh -c "$(curl -fsSL https://trae.cn/trae-cli/install_v2.sh)"`，需要能直连 trae.cn；前置境外出口探测返回 403 `denied by region block`，不提供非官方安装包。官方有 Windows `install_v2.ps1`，安装落点与执行均待核实。官方文档写明仅企业版旗舰版套餐开放 CLI；个人账号在前置实测中通过开发中特性登录后完成任务，不代表普遍可用。

账号状态使用 `traecli login status`：`Logged in using Trae` / 退出 0 为已登录，不区分个人与企业；`Not logged in` / 退出 1 为未登录，其他输出保持未知。原生套餐不支持原因单独显示，不能误报未安装或未登录。

- 个人：`traecli --enable personal_user_login login --personal`，特性为 under development，`--enable` 只作用于该次登录命令。
- 企业 SSO：`traecli login --enterprise`。
- 企业 PAT：`traecli login --with-trae-pat`，从 `TRAECLI_PERSONAL_ACCESS_TOKEN` 读取，未设置时读 stdin；令牌由用户在原生终端提供，插件不代填、不保存。
- 退出：`traecli logout`，结束后刷新状态、账号来源与模型目录。

来源绑定只取 `$TRAE_HOME/cli/auth.json` 的稳定主体字段摘要（`auth_mode`、`trae.user_id`、`trae.region`、`trae.login_method`、`trae.credential_kind`、`trae.endpoints.api_base_url`）及存在时的环境来源摘要。插件不读取或记录访问令牌、刷新令牌或设备私钥。完整企业 SSO/PAT 流程待核实。

## 2. 启动 argv 与 initialize 回执

参数以数组传入，不拼接任务 shell 命令：

```text
[exe, "--permission-mode", launchMode, "acp", "serve"]
```

`launchMode` 取 `default`（仅工作区编辑、规划启动）或 `bypass_permissions`（完全权限）。不使用 `exec --json`；不附加 `--enable personal_user_login`、`-s`、`-a`、`-y` 或 `-c`。安装版 `--permission-mode` 接受 `default`、`auto`、`bypass_permissions`，不接受 `plan` 或未知值；`--no-daemon` 仅支持交互模式，不能用于 ACP。

ACP 为 stdio JSON-RPC。下列为定稿记录中的字段摘记，不是完整原始报文的逐字副本；未记录的字段、版本值与扩展结构待核实。

| initialize 回执字段 | 已记录内容 |
| --- | --- |
| `agentInfo.name` | `traecli-acp`；身份不符时不发 prompt |
| `loadSession` 能力 | `true` |
| `sessionCapabilities` | list、fork、resume、close、additionalDirectories |
| MCP 能力 | 只声明 HTTP |
| `_meta.steering.supported` | `true`，只有声明，真实运行中引导待核实 |
| `_meta.trae.acpBackend` | `legacy` |

附件依据 `promptCapabilities` 传递，图片是否可传由 `promptCapabilities.image` 判定；本次记录未提供图片理解的真实验收，待核实。

## 3. session/new、模式与配置项

`session/new` 返回原生会话 ID。插件传项目目录与 `mcpServers: []`，不注入 DSH 工具桥。安装版带 `--permission-mode` 启动时才返回 `modes` 及 `mode` 配置项；模式有 `default`（Workspace Edit）、`plan`、`auto` 和 `bypass_permissions`（Full Access）。

| 配置项 | 已测形态与插件处理 |
| --- | --- |
| `mode` | `session/set_config_option` 接受标量字符串；切到 `plan` 后通知 `current_mode_update`，回执 `currentValue: plan`。插件同时核对 mode 配置更新与当前模式，回读不符停止本轮 |
| `model` | `session/new` 的选项为 18 个模型；模型 ID 等于 `traecli models --json` 的 `config_name`，原生默认 `Doubao-Seed-Code`。`session/set_config_option` 切换产生 `config_option_update` 并回执，确认后才发送 prompt |
| 强度 | ACP 未返回强度配置项；模型 `_meta.trae` 只有 `supportsMaxMode`；`-c model_reasoning_effort` 无可见效果。插件不提供强度选择，非 `default` 强度在发送前拒绝 |

模型目录查询先确认登录，再读取 `models --json`，显示名为 `name`、执行 ID 为 `config_name`。未登录的空数组不是成功目录；已登录空数组报「当前账号暂无可确认模型」。所选模型不在当次 ACP 目录时拒绝发送，要求重新选择，不改用原生默认模型。

权限映射：

| Worker 档位 / 模式 | 启动与会话模式 | 边界 |
| --- | --- | --- |
| 询问 | 不提供 | `default` 会自动批准工作区内改动与命令，不能冒充逐项询问；非规划的 `read-only` 直接拒绝启动 |
| 仅工作区编辑 | 启动及会话 `default` | 工作区内读写、命令及实测 `/tmp` 自动批准；其他工作区外授权请求交 DSH，不是 OS 沙箱 |
| 完全权限 | 启动及会话 `bypass_permissions` | 免确认；不可用时仅允许降至 `default`，说明本轮按仅工作区编辑运行 |
| 规划 | 以 `default` 启动，ACP `mode=plan` | 确认当前模式 `plan` 才发 prompt，审批直接拒绝；不能用 `--permission-mode plan` 启动 |

原生 `auto` 由 TRAE 审查子 Agent 代批，插件不映射此档。Worker 没保存档位且主对话为仅可查看时拒绝派遣，提示选择 Worker 档位或切换权限预设。

## 4. 事件与审批形态

前置真实任务使用 `glm-5.3-flash`，读取 `seed.txt`、写 `notes.txt` 并通过命令写 `cmd.txt`。记录的 ACP 更新如下；没有保留完整负载的子结构不在本页补造。

| 更新 / 回执 | 已记录字段与处理 |
| --- | --- |
| `agent_thought_chunk` | 公开思考内容，与正文分开投影 |
| `agent_message_chunk` | 正文块，带 `messageId` |
| `tool_call` | 工具 ID、`title`、`kind`、输入；已见 `kind` 为 read / edit / execute。执行类 `rawInput.command` 是数组 `['/bin/zsh', '-lc', …]`，不能当作一个命令字符串 |
| `tool_call_update` | 工具状态与输出；正常工具观察到 completed，拒绝操作观察到 failed。缺少工具终态不能报告成功 |
| `usage_update` | 上下文 `used` / `size`；不是本轮 Token 总量 |
| `config_option_update` | 模型 / 模式配置更新，参与选型与权限回读核对 |
| `current_mode_update` | 当前模式；已实测切换到 plan |
| `session/prompt` 回执 | 正常 `stopReason: end_turn`；取消或拒绝审批后可为 `cancelled`，另含 usage / 元数据 |

工作区外请求通过 `session/request_permission` 转 DSH。审批形态摘记：

| 请求部分 | 已记录内容 |
| --- | --- |
| 工具描述 | 工具调用的 `title` 与 `locations` 提供详情；执行命令的输入可以是数组 |
| 选项 ID / kind | `approved` / `allow_once`；`abort` / `reject_once` |
| 会话级批准 | 未提供；DSH 不显示「本会话始终允许」 |
| 未记录字段 | 完整原始请求负载、选项显示文案及其他扩展字段待核实 |

允许时选择原生 `approved`，拒绝时选择原生 `abort`。前置记录中拒绝后工具 failed、本轮 `cancelled`，被拒文件未生成。插件把“本轮有过 DSH 拒绝、原生 `cancelled`、用户未主动停止且无其他失败”显示为「因拒绝审批而结束：被拒操作未执行，可续聊继续」；不把该场景显示成用户取消或 CLI 错误。用户主动停止仍按停止处理。

## 5. cancel、load、fork 与进程退出

- `session/cancel`：前置实测在 6 秒后取消，prompt 回执 `stopReason: cancelled`、usage 全零，`late.txt` 未生成；随后关闭 stdin，进程退出 0，未残留 `traex` / `sleep`。插件只有确认进程范围退出才报告停止成功，不能把收到 cancelled 当作清理完成。
- `session/load`：新进程使用已确认会话 ID；先重放 `user_message_chunk`、工具和 `agent_message_chunk`，再回执。前置续聊正确回答了上一轮写入内容。runner 在 load 回执前不接纳正文，重放不重复进入本轮；恢复失败明确报错，不新建会话。
- `session/fork`：前置实测返回新的会话 ID；`session/close` 回执 `{}`，再 load 新 ID 重放了 3 条用户消息，确认分支带历史。插件仅提供最新完成轮的原生分支，不提供较早轮次分支。
- initialize 宣告的 list、resume、additionalDirectories 等能力不等于逐项执行通过；上述记录以外的行为待核实。

## 6. usage 与上下文

前置 `session/prompt` 正常回执包含 `usage` 与 `_meta["_trae/tokenUsage"]`，字段整理如下：

| 来源 | 字段 / 口径 |
| --- | --- |
| `usage` | `inputTokens`、`outputTokens`、`totalTokens`、`thoughtTokens`；缓存读/写为提案所记 cachedRead / cachedWrite，完整键名待核实 |
| `_meta["_trae/tokenUsage"]` | `turn`、`sessionTotal`、`last`、`contextWindow`；前三项的完整内部结构待核实，不作为推算来源 |
| `contextWindow` | `used` / `size`，插件从同一 prompt 回执采集上下文 |

插件仅在本轮 `stopReason: end_turn` 且用量为非负整数、`totalTokens === inputTokens + outputTokens`、总量非零时采纳本轮 `cliworker.traecn_prompt_usage`。思考与缓存字段按原生报告附带，输入口径为 reported，是否包含缓存的计费含义未公开；不沿用 Qoder 的积分口径。上下文合法时发布 `cliworker.traecn_context`（`used` / `size`）。

取消时实测全零，不报告为“本轮用量零”，保持未知。缺失、非法或加和不符的数据保持未公开；不以累计量替代本轮或当前上下文，不从模型名称猜容量。

## 7. 原生能力与验证边界

- 原生读写、命令、联网、子 Agent、记忆和 skills 跟随用户原生设置；不关闭 `multi_agent`（安装版默认开启），不更换 `TRAE_HOME`。记忆库为 `$TRAE_HOME/cli/memories_1.sqlite`，用户 skills 路径为 `~/.trae/skills` 与 `~/.agents/skills`。项目 `.trae/skills` / `.agents/skills` 来自程序字符串，实际加载待核实；各原生扩展能力不能据此视为插件端到端验收通过。
- DSH 工具桥不提供：ACP 仅声明 HTTP MCP；`_meta.trae.options.mcpServers` 声明的值是已配置 MCP 服务名且有替换语义，不等于标准 ACP 的服务定义。未经核实的注入可能失效或覆盖用户 MCP。工具桥加载、调用与配置互操作待核实。
- 运行中引导不提供：`_meta.steering.supported: true` 只是声明，真实 steering 往返待核实；运行中发送按原生 Inbox 排队。
- 程序存在默认开启的 `in_app_updates` 与 `traecli update`；前置探测后 `current` 始终指向 0.213.1，未观察到升级，不能据此保证未来不更新。插件不调用 update。
- 前置 macOS CLI 探测已核对事件、产物和退出；插件回归、真实 Worker、Desktop 明暗图标及 Windows 验收仍须看 [本次任务清单](../openspec/changes/add-traecn-cli/tasks.md) 的实际记录，不能由本页替代。其他模型、企业账号完整流程、图片理解、项目 skills、MCP 工具桥及 steering 均待核实。
