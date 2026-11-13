# harness-cli-tool-bridge Specification

## Purpose

约束 CLI 经工具桥调用 DSH 工具时的等待与撤回：调用不因等待 Host 响应过久而单方面放弃，只受任务时限、CLI 自身工具超时与取消约束；调用方放弃时撤回对应的授权询问。

## Requirements

### Requirement: 工具桥调用不设响应等待上限，调用方放弃即撤回
CLI 经工具桥调用 DSH 工具时，载体客户端 MUST NOT 因等待 Host 响应的时间过长而单方面放弃（例如等待用户授权超过 5 分钟）；调用时长 SHALL 只受任务时限、CLI 自身的工具超时和取消约束。调用方断开连接、且没有其他请求在等待同一调用时，Host SHALL 撤回该调用：正在等待的授权提问 SHALL 撤回，该工具 MUST NOT 在之后执行。

#### Scenario: 授权等待超过 5 分钟
- **WHEN** Pi 的 DSH 备选命令工具等待授权 6 分钟后，用户选择「允许一次」
- **THEN** 工具调用仍然有效，命令执行并把结果交给 Pi

#### Scenario: 调用方放弃
- **WHEN** 工具调用等待授权期间，调用方关闭了连接
- **THEN** 提问卡撤回，之后无法再允许，命令不执行

#### Scenario: 重放请求仍在等待
- **WHEN** 同一调用有两个请求在等待，其中一个断开
- **THEN** 调用继续，结果交给仍在等待的请求

### Requirement: Antigravity 工具桥私有工作区不承载任务文件
插件为 Antigravity 工具桥加入 `--add-dir` 的本轮私有目录只用于让 CLI 读取 MCP 与 Hook 配置。PreToolUse Hook SHALL 拒绝参数中出现该目录的任何原生工具调用（路径、URI、命令或 JSON 文本，Windows 上不区分大小写和分隔符），拒绝原因 MUST 指明这是私有目录并给出项目目录；不涉及该目录的原生工具 MUST 保持 CLI 原有策略，工具桥工具的准入规则不变。

#### Scenario: 模型把任务文件写到私有目录
- **WHEN** Antigravity 模型调用写文件工具，目标路径位于本轮工具桥私有目录
- **THEN** Hook 拒绝该调用，原因写明私有目录不属于项目并给出项目目录，文件不写入私有目录

#### Scenario: 写到项目目录
- **WHEN** 模型调用写文件工具，目标路径在项目目录内或与私有目录同名前缀的其他目录
- **THEN** Hook 不改变该调用的原生权限策略

### Requirement: 受控工具转发
系统 SHALL 为已确认支持注入的 CLI 提供临时工具桥，绑定真实父子会话、Worker 与当前 run。工具调用 MUST 经宿主原有执行和权限链，不直接调用工具实现，不导出未授权、递归派遣或未接通的 DSH 模型辅助工具。目录 SHALL 继承当前子 Agent 实际可见的已配置 MCP 和普通工具，不因属于第三方 MCP 就整体排除；调用时 MUST 重核权限目录。

#### Scenario: 合法调用与去重
- **WHEN** 当前运行调用已获准工具或重发相同操作身份
- **THEN** 最多执行一次并返回原结果，同一身份不同参数被拒绝

#### Scenario: 停止与过期身份
- **WHEN** 运行已停止、身份不符或清理开始
- **THEN** 拒绝新调用，取消并等待在途调用退出，未知结果不自动重投

#### Scenario: 已配置的 MCP 工具
- **WHEN** 当前子 Agent 的真实工具目录包含已配置的 MCP 工具且调用获宿主授权
- **THEN** CLI 可通过本轮桥调用它，执行进入原生 tools.execute 与权限/审批链，保留错误结果；运行中撤销的权限不得沿旧目录继续调用

#### Scenario: ACP 桥工具原生准入
- **WHEN** 当前 ACP 会话要求一次性执行 Provider 结构化报告的工具名，且该名精确对应本轮桥的实时授权目录
- **THEN** 只选择原生 allow_once 入口，使请求抵达工具桥，宿主仍逐次执行原有权限及审批；描述、标题、原始输入、命名空间前缀或已撤销目录均不能单独构成准入依据

#### Scenario: 撤销后的缓存回执
- **WHEN** 已配置工具被当前子 Agent 的真实作用域目录撤销后，CLI 重发此前已成功的同一请求身份
- **THEN** 拒绝返回旧回执或再次执行；工具名称和 MCP 前缀不能代替当前授权

#### Scenario: 公开结果与非文本限制
- **WHEN** 宿主工具返回公开文本、错误标记以及尚未接通的图片、附件或额外上下文
- **THEN** 保留公开文本原文与顺序及宿主错误标记，对不支持内容提供明确说明并标为 MCP 错误，不泄露执行内部 value、meta 或私有附件引用

#### Scenario: 工具内部调用 DSH 模型
- **WHEN** 一个目录可见的 MCP 或普通工具在执行期间尝试调用 DSH 模型，即使该调用未带 sessionId 或 purpose
- **THEN** 通过当前 CLI 调用的异步归属拒绝该额外模型请求；普通 DSH 会话的独立模型调用保持原行为

### Requirement: 技能按需加载
系统 SHALL 通过合法技能目录按需提供说明和获准资源，不修改用户技能。依赖工具不可用时 MUST 明确说明，不将不完整迁移称为原生完整支持。

#### Scenario: 技能资源与缺失依赖
- **WHEN** CLI 请求选定技能及相对资源
- **THEN** 只返回该技能范围内获准内容，越界或依赖不可用时拒绝

#### Scenario: 技能撤销与旧资源回执
- **WHEN** 技能或其依赖工具已撤销，CLI 重发此前读取正文或资源的相同请求身份
- **THEN** 重新核对当前技能目录和工具依赖并拒绝返回缓存内容，不修改用户技能或自动执行依赖

### Requirement: CLI 临时接入与能力说明
CLI 工具桥配置 SHALL 仅用于本次受管运行，不覆盖用户全局配置。缺少隔离注入或交互处理的通路 MUST 返回具体不可用原因并在界面禁用相关操作。

#### Scenario: 不能安全注入
- **WHEN** 当前 CLI 没有已确认的临时接入口
- **THEN** 保留其原生 Agent 与通信，工具共享控件禁用并显示原因，不自动改用其他 CLI

#### Scenario: Antigravity 本轮附加目录
- **WHEN** 真实 Antigravity 受管运行具有当前会话获准的工具桥
- **THEN** 通过本轮私有附加目录加载原生 MCP 与 Hook；不覆盖项目或全局配置，不把连接凭据写入配置或 argv，运行完成、失败或停止后清理目录

#### Scenario: Antigravity 桥工具准入
- **WHEN** AGY Hook 的结构化服务器、工具名、原生会话与当前运行实时目录精确匹配
- **THEN** 仅让该调用进入工具桥并保留原生显式权限规则和 Harness 真实审批；未知、撤销或过期调用不得被前缀、提示词、显示标题或任意原始参数授权，不全局跳过权限

### Requirement: Antigravity ACP 在项目内注入 MCP
Antigravity ACP SHALL 将进程 cwd 与会话 cwd 设置为项目，通过会话 mcpServers 提供当轮工具桥，MUST NOT 添加插件私有工作区或命令审批 Hook。项目明确要求的额外工作区 SHALL 保留，且其原生命令目录限制 SHALL 如实说明。

#### Scenario: 新建与恢复
- **WHEN** 新建或加载 Antigravity ACP 会话
- **THEN** mcpServers 包含当前轮的 stdio 载体，使用现有 Host 工具准入与审批；旧轮连接不能复用

#### Scenario: MCP 实际验证
- **WHEN** 验收工具桥
- **THEN** 以载体启动和实际 tools/call 到达为证据，不能以参数存在或 initialize 成功宣称工具已加载

#### Scenario: 旧 stream 后备
- **WHEN** 旧安装版必须使用 stream
- **THEN** 保留原有工具桥隔离与生命周期，移除无效命令 relay；提示私有工作区仍可能影响默认命令目录

### Requirement: Worker 工具桥只放行插件派遣与状态工具
Worker 工具桥 SHALL 在 DSH 工具对该 Worker 可见时放行 `cliworker_start` 与 `cliworker_status`，并在 DSH 原生工具管线中以 Worker 子会话为调用方执行，策略、守卫与审批照常。其他插件工具、`run_code`、DSH 原生 `agent`／`subagent` 系列，以及 spawn、delegate、task、send_message 等派遣或多 Agent 工具 MUST 继续拒绝。工具名前缀或别名不得扩大放行范围。

#### Scenario: Worker 列出 DSH 工具
- **WHEN** Worker 通过工具桥读取可用 DSH 工具
- **THEN** 列表包含 `cliworker_start` 与 `cliworker_status`，不含 `cliworker_followup`、`run_code`、`agent` 或其他派遣工具

#### Scenario: 以别名绕过
- **WHEN** Worker 调用名为 `cliworker_start_x` 或 `cli_worker.start` 的工具
- **THEN** 工具桥拒绝调用，不执行派遣
