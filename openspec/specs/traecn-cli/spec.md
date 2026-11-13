# traecn-cli Specification

## Purpose

规定 TRAE CLI CN 接入时的身份与发现、原生账号状态与登录、来源绑定、模型目录、ACP 会话、权限映射与规划模式、审批拒绝的显示及用量统计，所有能力以 TRAE 原生协议为准。

## Requirements

### Requirement: TRAE CLI CN 身份与发现
插件 SHALL 以 CliId `traecn`（名称「TRAE CLI CN」）接入官方 TRAE CLI 2.0。自动发现 MUST 只查找命令名 `traecli`，macOS 上 SHALL 在 PATH 之外补查 `~/.local/bin/traecli`；自动发现与手动配置的路径都 MUST 以 `--version` 输出（首行为 `traecli <版本>`，并含 `installation:` 行）确认身份，确认失败时 SHALL 显示未安装或身份不符，MUST NOT 把 `trae-cli`、`trae-agent` 或其他程序当作 TRAE CLI CN。插件 MUST NOT 调用 `traecli update` 或修改用户的 `traecli.toml`。未安装时使用说明 SHALL 写明官方安装脚本需能直连 trae.cn，MUST NOT 引导非官方安装包。

#### Scenario: PATH 上只有同名开源程序
- **WHEN** PATH 上只有开源 trae-agent 提供的 `trae-cli`，没有 `traecli`
- **THEN** 连接页显示 TRAE CLI CN 未安装，不运行该程序

#### Scenario: 手动路径指向别的程序
- **WHEN** 用户把 `traecnExecutable` 设为一个 `--version` 输出不是 `traecli <版本>` 的程序
- **THEN** 显示身份不符并拒绝任务，不启动 ACP

#### Scenario: macOS Desktop 未加载 shell 配置
- **WHEN** Desktop 的 PATH 不含 `~/.local/bin`，而 `~/.local/bin/traecli` 存在且 `--version` 正确
- **THEN** 识别为已安装

#### Scenario: 初始化身份不符
- **WHEN** ACP `initialize` 回执的 `agentInfo.name` 不是 `traecli-acp`
- **THEN** 本轮失败并提示检查 CLI 路径，不发送 prompt

### Requirement: TRAE 原生账号状态与登录
账号状态 SHALL 来自有界、无 prompt 的 `traecli login status`：`Logged in using Trae` 为已登录（不区分个人与企业），`Not logged in` 为未登录，其他输出为未知。登录 SHALL 提供三种原生入口：个人账号 `traecli --enable personal_user_login login --personal`（标注“个人登录依赖 TRAE CLI 开发中特性”，开关只附加在该次命令上）、企业 SSO `traecli login --enterprise`、企业 PAT `traecli login --with-trae-pat`（令牌由用户提供，插件不代填、不保存）。退出 SHALL 使用 `traecli logout`，原生回执后刷新状态与目录。运行任务 MUST NOT 附加个人登录开关。

#### Scenario: 未登录
- **WHEN** `traecli login status` 输出 `Not logged in`
- **THEN** 账号区显示未登录并列出个人账号、企业 SSO、企业 PAT 三种登录，拒绝发送任务

#### Scenario: 个人登录
- **WHEN** 用户在登录窗口选择个人账号
- **THEN** 插件在原生终端运行 `traecli --enable personal_user_login login --personal`，不修改 `traecli.toml`

### Requirement: TRAE 来源绑定
来源绑定 SHALL 只取 `$TRAE_HOME/cli/auth.json`（默认 `~/.trae/cli/auth.json`）中的稳定主体字段摘要，以及 `TRAECLI_PERSONAL_ACCESS_TOKEN`、`TRAECLI_HOST` 存在时的摘要。插件 MUST NOT 读取、记录或输出访问令牌、刷新令牌和设备私钥。

#### Scenario: 换号后目录失效
- **WHEN** 用户退出后用另一个账号登录，`auth.json` 的主体字段改变
- **THEN** 已缓存的模型目录与 Worker 选型校验失效，新任务要求重新确认模型

#### Scenario: 套餐不支持 CLI
- **WHEN** 原生返回 `Current Trae enterprise plan does not support CLI usage.`（测试夹具模拟）
- **THEN** 账号或任务显示该原生原因并拒绝启动，不显示为未安装或未登录

### Requirement: TRAE 模型目录
模型目录 SHALL 在确认已登录后来自 `traecli models --json`，执行 ID 取 `config_name`、显示名取 `name`。未登录时 `[]` MUST 报未登录，已登录时 `[]` MUST 报“当前账号暂无可确认模型”，二者都 MUST NOT 发布为成功的空目录。每个模型的强度 SHALL 只有原生默认（`default`），插件 MUST NOT 提供其他强度，直到 TRAE 公开可核实的强度来源。执行时 SHALL 通过 ACP `session/set_config_option` 选择模型并核对回执。

#### Scenario: 已登录的目录
- **WHEN** 已登录，`models --json` 返回 18 项
- **THEN** 目录列出 18 个模型，执行 ID 为各自的 `config_name`，强度只有原生默认

#### Scenario: 所选模型不在 ACP 目录
- **WHEN** Worker 保存的模型不在本次 `session/new` 返回的 `model` 选项中
- **THEN** 拒绝发送任务并要求重新选型，不改用默认模型

### Requirement: TRAE ACP 会话
TRAE CLI CN SHALL 以 `traecli --permission-mode <default|auto|bypass_permissions> acp serve` 启动（transport `traecn-acp-v1`），在原生身份、会话 ID、模型与模式回执确认后才发送 prompt。续聊 SHALL 用已确认的会话 ID `session/load`，恢复时的历史重放 MUST NOT 进入本轮正文；恢复失败时 MUST 报错，MUST NOT 新建会话。正文、公开思考与工具（ID、输入、输出、终态）SHALL 分开投影；缺少工具终态 MUST NOT 报告成功。停止 SHALL 先发 `session/cancel`，只有进程范围退出后才报告停止成功。分支 SHALL 使用原生 `session/fork` 并核对返回的新会话 ID。

#### Scenario: 续聊
- **WHEN** 用户在同一 Worker 续聊
- **THEN** 以原会话 ID `session/load`，重放的上一轮内容不重复显示，新一轮正常完成

#### Scenario: 恢复失败
- **WHEN** `session/load` 返回错误
- **THEN** 本轮失败并说明原因，不新建会话、不换 CLI

#### Scenario: 运行中停止
- **WHEN** 用户停止正在执行命令的 TRAE Worker
- **THEN** 插件发送 `session/cancel`，等 TRAE 进程范围退出后显示已停止，不显示为成功

### Requirement: TRAE 权限映射与规划模式
TRAE CLI CN SHALL 提供「询问」「仅工作区编辑」「完全权限」三档，「询问」档的启动与审批见「TRAE「询问」档启动与审批」。中档 SHALL 名为「仅工作区编辑」并映射原生 `default`：工作区内读写与命令由 TRAE 自动批准，工作区外的授权请求转交 DSH 审批。完全权限 SHALL 映射 `bypass_permissions`。插件 MUST NOT 使用 TRAE 的 `auto` 档或 `approvals_reviewer` 的 `auto_review`、`guardian_subagent`。规划模式 SHALL 以 `default` 启动并通过 ACP `mode` 配置项切到 `plan`，确认会话当前模式为 `plan` 后才发送 prompt，授权请求直接拒绝。每轮新起 TRAE 进程，换档或切换规划 SHALL 从下一轮生效。原生回读与所选模式不一致时 MUST 停止本轮。

#### Scenario: 仅工作区编辑下写用户目录
- **WHEN** Worker 档位为仅工作区编辑，TRAE 要写工作区外的用户目录文件
- **THEN** 按本轮来源出现 DSH 审批；允许后文件写入，拒绝后文件未生成

#### Scenario: 规划模式
- **WHEN** 主对话要求以规划模式派遣 TRAE
- **THEN** 会话当前模式确认为 `plan` 后才发送任务，不以只读沙箱冒充规划

#### Scenario: 原生模式回读不符
- **WHEN** 运行中收到的 `current_mode_update` 与所选模式不同
- **THEN** 停止本轮并说明实际权限与所选模式不匹配

### Requirement: TRAE「询问」档启动与审批
TRAE CLI CN「询问」档（`read-only` 且非规划）SHALL 以 `traecli -c sandbox_mode="read-only" -c approval_policy="on-request" -c approvals_reviewer="user" acp serve` 启动，MUST NOT 同时传 `--permission-mode`，且 MUST NOT 设置或回读 ACP 模式；TRAE 发出的每个 `session/request_permission` SHALL 按本轮来源转交 DSH 审批，拒绝后该操作 MUST NOT 执行。Worker 没有保存档位且主对话为仅可查看时，TRAE SHALL 按「询问」档运行。

#### Scenario: 询问档写文件被拒绝
- **WHEN** Worker 档位为询问，TRAE 要在工作区内新建文件，用户在 DSH 审批中拒绝
- **THEN** 文件未生成，本轮显示“因拒绝审批而结束”，可以续聊

#### Scenario: 询问档写文件被允许
- **WHEN** Worker 档位为询问，TRAE 要在工作区内新建文件，用户允许
- **THEN** 文件按要求写入

#### Scenario: 询问档只读命令
- **WHEN** Worker 档位为询问，TRAE 只执行 `ls` 等只读命令
- **THEN** 不出现审批，命令正常返回

#### Scenario: 询问档启动参数
- **WHEN** 插件以询问档启动 TRAE
- **THEN** argv 含三项 `-c` 设置与 `acp serve`，不含 `--permission-mode`；会话建立后不发送 `mode` 配置

#### Scenario: 仅可查看下派遣
- **WHEN** 主对话为仅可查看，用户派遣没有保存档位的 TRAE Worker
- **THEN** 派遣不被拒绝，TRAE 按「询问」档运行，改动前先出现 DSH 审批

### Requirement: 拒绝审批结束本轮的显示
用户在 DSH 拒绝 TRAE 的授权请求后，TRAE 以 `cancelled` 结束本轮且用户没有主动停止时，Worker SHALL 显示“因拒绝审批而结束”，MUST NOT 显示为已取消或 CLI 错误；被拒操作未执行，用户可以续聊。

#### Scenario: 拒绝工作区外写入
- **WHEN** 用户拒绝 TRAE 写用户目录的请求，TRAE 随后以 `cancelled` 结束本轮
- **THEN** Worker 显示“因拒绝审批而结束”，文件未生成，同一 Worker 可以续聊

#### Scenario: 用户主动停止
- **WHEN** 用户在审批前后点了停止
- **THEN** 按停止处理，不显示为因拒绝审批而结束

### Requirement: TRAE 原生功能与用量
TRAE 的原生子 Agent、记忆、skills 与联网 SHALL 跟随用户原生设置，插件不改 `TRAE_HOME`。附件 SHALL 按 ACP `promptCapabilities` 传递。用量 SHALL 只在本轮 `end_turn` 时取 `session/prompt` 回执的 `usage`，总量为零或与输入、输出之和不符时 MUST 视为未公开；上下文 SHALL 取同一回执 `_trae/tokenUsage.contextWindow` 的 `used`/`size`。未核实前 SHALL NOT 声明运行中引导与 DSH 工具桥注入，并在连接页或文档说明原因。

#### Scenario: 取消时的零用量
- **WHEN** 本轮以 `cancelled` 结束，回执 usage 全为零
- **THEN** 不报告本轮用量为零，保持未知

#### Scenario: 国际版询问
- **WHEN** 用户询问 TRAE 国际版
- **THEN** 使用说明写明 2026-11-07 查证未发现官方国际版 CLI，不把国内版改称国际版
