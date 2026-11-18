# Qoder CLI 原生通信协议核验

核验日期：2026-10-17。插件版本仍为 v0.8.1。实际任务使用 Qoder 自身的 ACP stdio；账号和模型目录使用同一已安装 CLI 的 SDK 控制元数据接口（第 9 节）。包检查、初始化和目录查询均不代表真实模型任务通过。

## 1. 官方来源与版本

| 来源 | 本次结论 |
| --- | --- |
| [官方 ACP 文档](https://docs.qoder.com/cli/acp) | `qoder --acp` 启动 stdio ACP Server，复用 CLI 登录；支持本地登录或 `QODER_PERSONAL_ACCESS_TOKEN`。 |
| [官方 CLI 参数](https://docs.qoder.com/cli/cli-reference) | 原生模型、会话、stream-json、权限和 ACP 参数入口。实际发行包对参数的支持优先于文档举例。 |
| [官方脚本模式](https://docs.qoder.com/cli/run-in-scripts) | 双向 stream-json 支持连续结构化输入；普通文本 headless 不能完成交互审批。 |
| [官方 SDK 工作原理](https://docs.qoder.com/cli/sdk/how-it-works) | SDK 在初始化后驱动本地运行时；消息流与双向控制请求分别处理，stderr 为诊断。 |
| [官方 SDK 模型策略](https://docs.qoder.com/cli/sdk/model-policy) | 当前账号模型目录与模型参数由运行时提供，不能把文档中的档位示例当固定目录。 |
| [官方 CLI 更新日志](https://docs.qoder.com/zh/release-notes/qoder-cli) | 页面本次显示到 2026-10-15 的 1.1.72；1.1.66 修复了 `session/load` 在历史重放完成前提前返回的问题。 |
| [官方 npm CLI 1.1.73](https://registry.npmjs.org/@qoder-ai/qodercli/-/qodercli-1.1.73.tgz) | 本次 npm latest 实际为 1.1.73，包内 `package.json`、`--version`、ACP `agentInfo.version` 三者一致。 |
| [官方原生发行清单](https://qoder-ide.oss-accelerate.aliyuncs.com/qodercli/channels/manifest.json) | 本次 latest 同为 1.1.73，published_at 为 2026-10-16T11:49:05.015Z。原生安装 shell 只做下载校验，最终目录和入口由二进制的 install 子命令管理。 |
| [官方 npm SDK 1.0.53](https://registry.npmjs.org/@qoder-ai/qoder-agent-sdk/-/qoder-agent-sdk-1.0.53.tgz) | 本次 SDK latest 为 1.0.53；`dist/runtime-manifest.json` 指向 CLI 1.1.71，默认 transport 为 `worker`。 |

CLI tarball SHA-256：`76bed33e16861809574feb5973ed1feea692f2f613cfbeb0bd03ed77adcf6d0f`。

SDK tarball SHA-256：`b3eca4c48803dfa501bc7929b5aba553b932ea113631e3bb0e4dd0767e21e8c8`。

下载和解包仅在临时目录完成，没有执行安装脚本或全局安装。npm 兼容包提供 `qoder` 和 `qodercli` 两个可执行入口。官方目前推荐原生安装脚本；npm 包保留兼容入口，要求 Node.js >=20。本次探针直接由 Node 运行官方 `bundle/qodercli.js`。

## 2. 选择 ACP 的依据

ACP 使用 JSON-RPC 2.0，每行一个 JSON 对象，走 stdin/stdout；不使用 Content-Length 封包，也不按 Claude Code 的 control_request 格式解释。

Qoder 1.1.73 同时实现 `session/set_model` 和 `session/set_config_option`。本插件复用已有 `native-acp.mjs` 的 configOptions 路径，模型、强度与权限值以运行时回执确认。无需加入另一套 SDK runtime 或依据相似字段猜测兼容性。

SDK 的双向 stream-json 是另一个正式接口，具备 initialize、interrupt、权限回调、模型目录、上下文与账号用量查询。它的版本和默认 worker 运行时与独立 CLI 不完全同步，因此本次不把 SDK 的全部能力投射到 ACP；特别是 ACP 未公开的账号身份、缓存分类和上下文占用均不能借 SDK 文档补齐。

## 3. 初始化与会话

发送 `initialize`：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientCapabilities": {},
    "clientInfo": { "name": "dsh-cliworker-now", "version": "0.8.1" }
  }
}
```

未登录、未启用模拟的 1.1.73 实际回执包含：

```json
{
  "protocolVersion": 1,
  "authMethods": [{ "id": "qodercli-login", "name": "Use qodercli login" }],
  "agentInfo": { "name": "qoder-cli", "title": "Qoder CLI", "version": "1.1.73" },
  "agentCapabilities": {
    "_meta": { "qoder": { "promptQueueing": true } },
    "loadSession": true,
    "sessionCapabilities": {
      "additionalDirectories": {}, "close": {}, "delete": {},
      "fork": {}, "list": {}, "resume": {}
    },
    "promptCapabilities": { "image": true, "embeddedContext": true },
    "mcpCapabilities": { "http": true, "sse": true }
  }
}
```

初始化成功不能证明已经登录。`session/new`、`session/load`、模型设置和 prompt 各自会检查认证；账号错误必须向上报告。

| 方法 | 参数与语义 |
| --- | --- |
| `session/new` | `{cwd,mcpServers}`；回执返回真实 `sessionId`、`modes`、`models`、`configOptions`。 |
| `session/load` | `{sessionId,cwd,mcpServers}`；恢复同一 ID，先重放历史，再返回配置状态；不得把重放内容当作本轮新消息。 |
| `session/prompt` | `{sessionId,prompt:[{type:"text",text}]}`；等待该请求的最终 stopReason。 |
| `session/cancel` | notification `{sessionId}`；取消排队与当前 prompt。通知写出本身不能证明进程和子进程已退出。 |
| `session/close` | request `{sessionId}`；释放运行时会话资源，不表示删除已持久化会话。 |

1.1.73 源码在 `resumeSessionInternal(..., true)` 中明确 await 历史重放；恢复响应不一定重复 `sessionId`。没有证明恢复成功时不得新建另一会话继续。

## 4. 模型与思考强度

`session/new`/`session/load` 的 `models.availableModels[].modelId` 来自原生模型的 `key`；对应 `configOptions`：

```json
{
  "id": "model", "type": "select", "category": "model",
  "currentValue": "<原生模型 ID>",
  "options": [{ "value": "<原生模型 ID>", "name": "<原生显示名>" }]
}
```

模型通过 `session/set_config_option` 的 `{sessionId,configId:"model",value:"<原生模型 ID>"}` 设置，`value` 必须是字符串。回执的 model currentValue 必须与选择一致。不要把显示名、旧文档中的 lite/performance 或 SDK 示例用作模型 ID。

`--list-models` 目前是面向人的表格：系统模型只输出显示名，外部模型的 key 也可能被截断，不能可靠构造可执行模型目录。任务使用 ACP 结构化模型值；独立目录查询现读取同一 CLI 的 SDK catalog-ready initialize（第 9 节）。无法认证或无法取得结构化目录时返回不可用。

支持强度的模型另行返回 `id:"reasoning_effort"`、`category:"thought_level"` 的 select option，取值来自当前模型的原生配置。1.1.73 的名称格式化代码识别 none/low/medium/high/xhigh/max，但这不是每个模型都支持这些值的证据。任务设置使用实际 options；目录可直接读取同一运行时的 efforts/supportsDisabled。default 表示不覆盖原生值，不发送猜测的关闭开关。

## 5. 权限与规划边界

官方 1.1.73 模拟空会话实际返回的 ACP 模式如下，与发行包 `buildModeState()` 一致：

| ACP mode ID | 原生语义 |
| --- | --- |
| `default` | 按原生规则，必要时请求审批。 |
| `acceptEdits` | 自动批准原生允许的文件编辑。 |
| `auto` | 使用 Qoder 自身分类器自动审批。 |
| `dontAsk` | 需要审批时拒绝。 |
| `yolo` | 绕过权限。插件不得默认使用。 |

CLI 帮助页的对应 flag 值使用 `accept_edits`、`dont_ask`、`bypass_permissions`，不能直接当 ACP mode ID。ACP `session/set_mode` 和 config option `mode` 使用上表值。

插件为 Qoder 指定 `modeConfigId:"mode"`，使用 `session/set_config_option` 的字符串 `value:"acceptEdits"` 设置并检查返回的 `configOptions[].currentValue`。这是本次已实际验证的同一配置路径；`session/set_mode` 的空对象成功响应本身不提供模式回执。运行中收到不同的 mode 配置时也应取消当前任务。

1.1.73 的 ACP 未宣告 `plan` 模式，实际 CLI 参数 choices 也没有 plan。官方参数文档曾列出 plan，不能据此声称当前 ACP 提供规划保护。宿主处于规划模式时应在发送 prompt 前明确失败；不得默默选 default 或仅向提示词加“不要写文件”。若将来实现原生规划状态协议，须补充独立的实际证据。

原生额外审批走 `session/request_permission`，响应使用 ACP 的 `outcome` 结构，选择服务端提供的 `reject_once`；没有可选拒绝项时返回 cancelled。权限请求不能套用 Claude 的 can_use_tool 协议。文件、终端客户端能力保持不宣告，CLI 使用自己的文件和进程能力。

## 6. 公开事件、工具与用量

正文：`session/update.params.update.sessionUpdate="agent_message_chunk"`，内容为 text。公开思考：`agent_thought_chunk`，仅显示实际提供的文本。未提供思考时不可制造可展开的思考过程。

工具：`tool_call` / `tool_call_update`，用 `toolCallId` 关联；状态为 pending/in_progress/completed/failed。读取真实 rawInput、rawOutput 和 content。Qoder 的 `title` 可能是命令正文或“Read 路径”，原始工具名在 `_meta.qoder.toolName`，映射工具桥时应保留它。`terminal:false` 时结果仍由 content/rawOutput 交付，不需要伪造客户端终端。

1.1.73 在 prompt 回执扩展了以下实际源码字段：

```json
{
  "stopReason": "end_turn",
  "usage": { "inputTokens": 12, "outputTokens": 4, "totalTokens": 16 },
  "_meta": {
    "quota": {
      "token_count": { "input_tokens": 12, "output_tokens": 4 },
      "model_usage": [{ "model": "<原生模型 ID>", "token_count": { "input_tokens": 12, "output_tokens": 4 } }]
    }
  }
}
```

以上数字仅说明字段形状，是模拟示例。input/output 覆盖一次 `session/prompt` 对应整轮查询中的累计请求，total 为二者之和；它不是最后一个 assistant 文本片段的独立用量，也不等于单次模型响应或当前上下文。源码从最终 result.usage 汇总，按模型细分仅在扩展的 model_usage 中提供。源码没有在此提供缓存读写分类、当前上下文占用、上下文窗口或 Credits。只在存在且有效时采集，不补零、不把累计账单 token 当当前上下文占用，也不把同一用量重复累计。该版本的 ACP 运行时没有观察到独立 usage_update 的发送实现，不能因标准 schema 含该类型就等待它作为完成条件。

### 6.1 官方隐藏计数与原生上下文比例（2026-10-17 真实历史复核）

1.1.73 的 `aU()` 会在未公开 Token 计数的原生路由下将 input/output/cache 等字段置零；ACP 又从这些公开后的 SDK 用量生成整轮三元组。因此 `{inputTokens:0,outputTokens:0,totalTokens:0}` 无法证明真实账单为零，插件将其视为未公开，而不是展示「0 tok」。没有通过环境开关解锁隐藏计数，也不从 Credits、正文长度或别的模型反推 Token。非零且总和一致的 ACP 计数仍可显示，缓存分类缺失时保持未知；其 input 标为「CLI 报告输入」，因为 ACP 没有说明该输入在不同原生 provider 下的缓存计数口径，不能标成「含缓存」或「未缓存」。

用户截图对应已完成记录的只读检查确认：ACP 三项均为零，原生 transcript 的终态 assistant 却有 `usage.context_usage_ratio=0.17617777777777777`，且保留 Credits。两者互相独立，不能据此生成账单 Token 或窗口容量。原生 ContextMeter 可直接显示该公开比例（17.6%）；详情中的 Token 数及容量仍为「— / —」，分类未知，并说明比例来源。此次复核没有发送任务或新模型请求。

比例只从官方项目目录 `projects/<QI(cwd)>/<sessionId>.jsonl` 精确读取。ACP `session/prompt` 的 `result.userMessageId` 必须对应同会话、同 cwd 的原生 user UUID；从其 parentUuid 链寻找同模型、非 sidechain、未中断的 `end_turn` assistant。遇到后续用户轮次即停止，不借用新轮次的数据。已有历史可在该身份链完整时只读恢复比例；缺失 userMessageId、模型不符或无公开比例时保持未知，不修改旧事件。

读取检查目录/文件身份、所有者、无符号链接、单链接、私有记录权限、稳定文件快照、完整 UTF-8/JSONL，以及 16 MiB、20,000 行、每行 2 MiB 上限。缓存仅保留数字观测与来源指纹；凭据、提示词与正文不进入遥测缓存。原生 Qoder 根目录可为 0755，`projects` 与项目记录目录仍要求 0700、记录文件要求 0600。文件不可用不影响 CLI 终态和停止清理。

原生「轮次 / 步骤」和耗时组件统计的是 Harness 调用 CLI 的会话轮次与桥接步骤，不能冒称 Qoder 内部模型请求次数。其首 Token 时间包含 CLI 启动与会话准备；详情明确标注该边界。Qoder 未公开的内部轮数、请求 Token 账单及上下文分项仍不补造。

仅 `stopReason=end_turn` 可进入通常的成功判定；cancelled、refusal、max_turn_requests 和错误均不是成功。工具缺终态、权限拒绝和进程未清理仍应失败或保持不确定。

### 6.2 上下文与积分补读修复（2026-10-18）

参考 [Codingns4DSH 的 ACP 补充读取](https://github.com/jingyi0605/Codingns4DSH/blob/27b4c95065e9f3ae01d513c60673a871487257f3/src/host/cli-adapters/qoder-driver.ts#L523-L638) 的数据来源，继续使用 ACP，独立实现以下采集与显示：

- ACP 主回执有效时优先保留；缺失、隐藏或不一致时，独立检查 `_meta.quota.token_count` 的输入输出和总和，不能逐桶混合两个来源。两处全零仍标为未公开。
- 按既有 userMessageId、parent 链、会话、项目和模型身份限定本轮。原生 `message.usage.credits` 按 request/message ID 去重，采用每个请求最后一份有效记录再求和；有请求缺失积分或多条无法识别请求的记录时不补零、不推算总额。明确零积分可以显示。原生完成、比例和积分分别核对，积分不要求 token 或比例同时存在。
- 同轮 `runtime-config` 明确提供容量时可使用；否则有界检查固定日志目录下最近四份 `qodercli.log` 的末尾最多 256 KiB，单文件至多 32 MiB、目录项至多 512 个。同会话主链的窗口行还须落在原生用户消息与终态消息的时间范围，排除后续轮次和不同模型。容量证据有效时，`round(比例 × 容量)` 仅作为明确标记的上下文估算，不进入 token 账单。缺失日志不影响原有积分和比例。
- POSIX 保留私有记录权限规则。Windows 原生 Qoder 的默认文件可由 Administrators 拥有且继承只读 ACE；数字采集显式允许“当前用户所有权，或 Administrators 所有权加当前用户适用的完全控制 ACE”，其他主体不能写、删除或改 ACL。仍逐路径异步验证、前后校验描述符和文件身份，拒绝链接与替换，不修改任何原生权限。通用读取器默认策略不变。
- 数字观测与历史补读共同传递积分、比例和已核实窗口，源指纹变化使缓存失效。现有原生用量入口显示本轮积分；token 无来源时显示「Token 未公开」，上下文只有比例时保留「— / —」。历史正文与原始回执不改写。

本次按用户要求只在 Windows 验收：关联八文件 118 项及必要类型检查通过，真实历史只读核对和正式 Desktop 冷启动、积分及上下文弹层交互见 `doc/tasks.md`。Mac 仅生成隔离构建产物，没有执行测试或桌面验收；没有新增真实模型请求。

### 6.3 积分计费显示（2026-10-18）

按用户后续要求，Qoder 用量模块采用积分计费名称：入口只显示积分，详情标题为「积分用量」，不再并列 Token 字样。该规则不依赖本轮是否已有积分：缺失、等待或断连时仍显示积分未知，已确认零积分显示0。断连只保留当前归属的计费单位，数值清空；释放归属或切换代际时同时清除单位。后台有效 token 回执仍按原规则校验保存，不用它替代积分或改变上下文计量单位。其他 CLI 沿用其实际 token 用量。

## 7. 初次接入探针与当时的未验证项

| 验证 | 结果 |
| --- | --- |
| 本机 PATH 的 qoder/qodercli | 初次探针未发现；后续已安装入口及真实账号目录结果见第 9 节。 |
| 官方 npm 元数据、tarball、包内版本与 SHA-256 | 已核对；latest 1.1.73，SDK latest 1.0.53。 |
| 隔离配置下 CLI --version / --help | 通过；未使用用户配置和凭据。 |
| 非模拟 ACP initialize | 通过；没有发送任务，未登录状态也可初始化。 |
| 官方隐藏 --fake-responses 下 initialize → session/new → set_config_option(mode=dontAsk) → session/close | 通过；明确属于模拟空会话，不发送 session/prompt，没有模型调用。回执验证 configOptions、模型/模式字段及字符串取值。 |
| SDK stream-json 的未登录启动 | 已核验：缺认证 payload 返回 auth_payload_missing；qodercli payload 配合空账号目录返回 auth_required，exit 41、num_turns=0。 |
| SDK stream-json initialize → account_info → end_session | 明确模拟通过：只使用临时合成账号、官方 --fake-responses 和拒绝出站的回环代理；没有发送 user/prompt。取得真实控制回执形状，但不属于真实账号验收。 |
| 真实账号目录、真实模型与强度列表 | 初次未验证；模拟目录只有 Fake Responses，不得混入真实模型列表。后续 17 模型实机结果见第 9 节。 |
| 真实首轮、工具产物、同会话恢复与运行中取消 | 未验证；源码核验不能替代这些真实验收。 |
| Windows/Linux、原生独立运行时 | 未运行；本次探针为 macOS Node npm 兼容包。 |

探针使用临时 `QODER_CONFIG_DIR` 和临时 cwd，不修改 HOME、原生账号或用户会话。禁用临时运行的自动更新和提交 Hook；没有执行安装脚本。模拟探针原始响应留在临时目录，不把用户日志或账号材料提交仓库。

ACP initialize/authenticate/session state 没有公开稳定账号主键；下面的同一 CLI 元数据接口用于读取该身份。不能以会随刷新改变的密文哈希冒充稳定 principal，也不能因 ACP initialize 成功把“未登录”标为“已连接”。

## 8. 同一 CLI 的只读账号元数据

1.1.73 自身的双向 stream-json 提供 `account_info` 控制请求，不需要安装 SDK、运行其旧版 CLI 或由插件解密原生账号。SDK 类型只是查找入口的线索，最终已经对照 1.1.73 `account_info` handler / `vCr(config)` 及实际模拟 wire 核验。

元数据进程使用与实际任务相同的 Qoder 可执行文件和认证来源；第 9 节将可写配置放入每次私有目录。参数数组为：

```text
--print --output-format stream-json --input-format stream-json
--no-session-persistence --tools "" --disable-builtin-skills
--strict-mcp-config --mcp-config {"mcpServers":{}}
```

仅设置上述格式参数不足以进入 SDK 认证与控制启动路径。还需声明该进程的 `QODER_AGENT_SDK_ENTRYPOINT=sdk-ts`、`QODER_AGENT_SDK_VERSION=1.0.53`，以及 `QODER_SDK_AUTH_PAYLOAD_FILE`。复用浏览器登录时 payload 内容为 `{"type":"qodercli"}`；1.1.73 明确将它映射为 storagePolicy=readOnly、refreshStrategy=none，原生 CLI 自行读取账号且不续期写回。PAT 的官方 payload 类型为 accessToken，敏感值仅交给所选子进程的私有认证文件。目录 0700、文件 0600，CLI 读取后会删除 payload，Host 仍负责失败路径和最终清理。

初始化后再查询账号，不能把仅发送 account_info 而未初始化的超时解释为未登录。每条控制请求单独关联 request_id；官方 SDK 为 type 请求补上同值 subtype，本次实际 wire 使用：

```json
{"type":"control_request","request_id":"init","request":{"type":"initialize","subtype":"initialize"}}
{"type":"control_request","request_id":"account","request":{"type":"account_info","subtype":"account_info"}}
```

第二个请求的成功回包形状如下，内容为本次明确标注的合成身份：

```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "account",
    "response": { "account": { "userId": "synthetic-account", "email": "synthetic@example.invalid" } }
  }
}
```

原生 handler 从当前进程认证信息中的 uid/name/email/organization_id/organization_name 读取，返回 userId/name/email/organization/organizationName；有可确认套餐名时另带 subscriptionType。SDK 的宽类型还允许 tokenSource/apiKeySource，但本次 1.1.73 handler 没有填这两项，不能依赖它们。账号主键需有效的 userId，并区分原生账号目录、来源和组织；显示名、邮箱或套餐名不能单独代替稳定身份。它也不证明 BYOK 路由和模型授权，后者仍由独立配置绑定、同一 CLI 的动态目录和任务 ACP 选型回执确认。get_usage_info 仅返回额度与会话 Credits，不能用于推断账号主键。

查询后发送同格式的 end_session，并停止输入、通过受管进程清理确认退出。模拟探针收到 end_session success，但未在随后两秒内自然退出，最后经过终止清理；不能把控制回执本身当作清理完成证据。该探针只证明协议与合成身份解析；真实登录、过期凭据、PAT、独立原生发行物及 Windows 仍未实际验收。没有启动模型请求，也没有通过查询为用户自动登录。


## 9. Desktop 目录修复与只读边界

2026-10-17 Desktop 复验时，本机已安装 `~/.qoder/entry/qoder` 1.1.73，并已能读取真实登录。此状态晚于第 7 节初次探针的“未安装/未验证”记录。真实 ACP 元数据取得 17 项模型及各自强度后，先 close 再 delete 空会话会因不存在 transcript 返回 -32602；直接 delete 可清理，但 preview 进一步发现共享缓存刷新及退出分类问题。均未发送 prompt。

官方 1.1.73 bundle SHA-256 为 `26f340bac4890e14385f45bbc3d05f8d8a061853982b6c3a6853d2aaccac543e`。静态核验得到：

- `.models/default` 是带 key/uid/scene/updatedAt 的 24 小时目录默认值缓存，`_doInitCore/reloadSharedCache` 会写回。它不是用户保存在 settings 的模型偏好。旧探针没有该文件前值，不能推测恢复。
- ACP `wYd/Foe` 使用普通可写认证策略，不能将 SDK readOnly payload 直接套到 ACP。目录因此复用已存在的 SDK 控制传输；不安装 SDK，不使用其捆绑的不同版本运行时，实际任务继续走 ACP。
- SDK initialize 设置 `supportsCatalogReadyInitialize:true`，等待当前认证和目录就绪；`FHd` 返回 `models:KB(config).map(veA)`。使用 `value`、`displayName`、`isEnabled`、`efforts`、`supportsDisabled`，只公布 isEnabled=true 的模型。官方 `DT` 仅在 supportsDisabled=true 时追加 none，不能从 isReasoning 或模型名字猜强度。

目录查询只有 initialize 和 end_session；账号查询为 initialize、account_info、end_session。均使用 `--no-session-persistence`、空 tools、禁用 hooks/自动更新和空 MCP。目录不创建 ACP 会话、不切换模型、不需要持久化 transcript。

每次查询创建 0700 私有配置目录，0600 写入 auth payload 及必要原生配置副本：用户 settings.json、.env、有限数量的 `.models/<slot>/customs`。不复制默认目录缓存、历史或锁。文件读取拒绝链接、异常类型及超限内容。浏览器认证使用 qodercli payload，`QODER_SDK_AUTH_CONFIG_DIR` 指向原始认证根，原生 readOnly/none 策略禁止 token 刷新；启动前要求原 machine_id 已存在且非空，避免 telemetry 自动初始化共享文件。PAT 使用 accessToken payload 和私有 auth 根；若原 machine_id 已存在，仅复制该标识以保留 customs 解密，不复制 user 文件。PAT 缺标识时只允许原生在私有根创建。

cwd 保持原项目，保留项目/local 设置和项目 `.env` 优先级；SDK 子进程启用官方 `QODER_SDK_CUSTOM_BASE_URL_BYOK=1` 入口以保留配置的 providers。以下两类配置在 spawn 前明确拒绝，不静默忽略来源：

- 官方 `G8o/MNu` 会自动迁移并写回的旧 project/local 字段，包括旧 disable 开关、tools.approvalMode、model 的旧全局强度/上下文/功能开关及 preferences.generation。提示先在原生 CLI 完成迁移；插件不替用户改文件。
- 生效 `.env` 含 Qoder 认证或运行控制变量、Gemini 模型/home 声明。按原生项目优先、用户后备的规则检查，账号绑定的 PAT 快速路径也不能跳过；否则 SDK 浏览器身份可能与实际 ACP 从 `.env` 读取的 PAT 不一致。普通代理变量仍保留。

官方 SIGTERM handler 将退出码设为 143，Node 因而可能报告 `{exitCode:143,signal:null}`。只有已确认 end_session、无取消或协议错误、未观察到提前 done 且 Host 发起本次正常终止，才将 143/null 或 SIGTERM/SIGKILL 归为本次收尾；其他非零、提前 143、取消、结束拒绝仍失败。成功还必须等待完整流结算和受管进程范围退出，随后才删除私有根。无法确认范围时保留私有根并明确报告清理未确认。

本修复已完成 3 个 Qoder 定向文件的 94 项离线测试及独立静态审阅。最终源码经 rc.2 Host/Client 类型检查与隔离 preview 后，使用已安装 CLI 实际取得 17 项模型及强度：两次控制请求为 initialize/end_session，结束回执成功，退出码 0，进程范围退出确认，私有根已删除。原账号、机器标识、设置、默认目录缓存及已有会话前后哈希一致，零 prompt、零模型请求。证据为私有 `.test-data/qoder-catalog-cleanup-20261017/preview-final-check/verification.json`。Desktop 结果另见 [统一验收记录](../tasks.md)；真实首轮、工具、续聊、运行中取消、PAT 实机及其他平台仍需独立验收。

## 10. 设置目录的单次操作快照

隔离修复安装后，设置冷开仍顺序启动 5 个原生元数据进程：账号状态 1 个、缓存入口 binding 1 个、授权目录的前后 binding 各 1 个、模型目录 1 个。Codex、Grok、Pi 的对应 binding 多为本地文件读取，这条通用调用链在 Qoder 上会重复支付原生初始化成本。同版本 SDK 的 catalog-ready initialize 已由 `FHd` 同时返回 `account:vCr(config)` 和 `models:KB(config).map(veA)`，因此一次授权目录可以使用同一进程的当前账号与目录。

性能修复只在一个 `authorizedCatalog('qoder', …)` 操作内复用该投影。AsyncLocalStorage 的 backend、config、可执行文件、项目路径和 signal 必须完全匹配；退出或失败后将 scope 失活并清除 Promise。消费者只得到副本，异步后代、并行操作及后续独立请求不能复用已经结束的账号状态。完整 end_session、范围退出和私有目录清理仍先于投影发布。

操作开始前和结束后分别读取完整来源指纹：原账号 user 与 machine_id、用户 settings/.env、项目及 local settings 和项目 .env、有序自定义模型目录及各 customs 文件、实际启动入口与解释器身份、物理项目路径、Host 环境和已保存的 Qoder 路径选择。文件缺失也进入指纹；不安全或无法确认的来源直接失败，不能把两次“无法读取”视为相等。这里只保存哈希，不保存账号材料。它确认初始化期间本地认证和路由来源未改变，并不等同于第二次远端鉴权；真实任务开始前的独立原生账号核验继续执行。

只有 Qoder 冷缓存和显式刷新允许由这个完整授权操作负责 binding，省去缓存入口的重复查询；热缓存命中仍重新读取当前 binding。旧 Worker 的 expected binding、CLI 身份、非空目录、取消、缓存版本变化及失败后不得回退旧目录的检查均保留。离线模拟实链目标为冷开 2 个进程、显式刷新 1 个、热缓存目录 1 个、重开账号加热目录 2 个；没有跨请求的登录 TTL。

初轮 5 个关联文件的 158 项离线测试通过，涵盖上述进程数量、查询期间退出登录/切号、设置/.env/customs 与执行入口变化、并发与失活 scope、取消及清理未确认。随后 Desktop 重开暴露账号查询的外层通用 10 秒预算会在成功元数据后的进程清理期间先行取消；仅 Qoder 的账号状态工作截止预算对齐到原生查询的 15 秒，其他 CLI 仍为 10 秒。预算从外层查询开始计算，不延长登录缓存，也不跳过退出确认；超时后仍须等待清理，所以 15 秒不是强制返回的最长耗时。完整清理仍先于身份发布。

这项窄修复连同关联回归共 6 个文件 241 项通过。新增模拟时钟验证 6 秒元数据加 5 秒清理后返回 authenticated、元数据在 15 秒仍未完成时拒绝迟到结果、主动取消立即发起清理且等待范围退出。真实加载耗时、构建与 Desktop 最终结果以 [统一验收记录](../tasks.md) 为准，不能用模拟进程数量代替实测加速；repo 目录的 Node 元数据计时与 Desktop 实际父项目的 UI 计时分别记录。

### 6.4 回复功能条积分与逐轮归属（2026-10-18）

原生回复下方的用量入口与输入框底部均按积分展示，标题为“积分用量”。回复只使用该 Harness turn 精确绑定的已结算 run，按 run 去重后读取对应原生请求积分；历史读取不借用当前 Worker 模型或后续轮次账单。任一绑定运行缺失或不安全时，整轮积分显示 —，明确零有效。断连清空数值但保留单位；积分与实际窗口及隐藏 token 相互独立。统计弹层取消重复缺失说明，未知字段继续用 —。
