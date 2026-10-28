# Tasks

## 1. 调查

- [x] 1.1 核对各 CLI 当前原生工具、MCP、skill 的启用与隔离情况及工具桥接入状态。
  - 2026-10-28 源码核对：工具均为 CLI 原生，DSH 以 `dsh_worker_tools` 叠加。用户自身 MCP/skill 生效：Codex（`config.toml`）、Claude（`~/.claude`，无 `--strict-mcp-config`）、Kimi、Qoder、Antigravity。被清空或隔离：OpenCode/MiMo（`mcp: {}`、外部 skills 关闭，`opencode-adapter.ts:102-124`）、Hermes（`mcp_servers: {}`、仅 terminal/file，`native-hermes-home.mjs:267-268`）、Pi/OMP（`--no-extensions --no-skills`，`pi-omp-bridge.mjs:255-268`）、ZCode 禁 `Skill`（`zcode-adapter.ts:30-48`）；Grok 用私有 `GROK_HOME`，用户自身 MCP 是否带入未核实。未接桥：OMP（安装版在 `--no-extensions` 下忽略显式扩展）、Hermes（SAFE_MODE 隔离无已核验注入入口）、ZCode（执行未准入）。`doc/native-harness-tools.md` 中 Antigravity「禁用」已过时。
- [x] 1.2 导出 Windows 与 macOS 下子 Agent 实际 `tools.schemas()` 目录（无模型），确认能否得到来源插件，完成 DSH 工具→能力类别映射。
  - 2026-10-28 macOS（darwin arm64，Node 22.23.1）：使用 DSH Desktop 0.12.1 内置的 dsh-base 0.2.1-rc.2 包（解包 app.asar，未启动或退出 Desktop、未读用户 profile/MCP/设置），按 dsh-base `cordis.patch.yml` 与 standard preset 组装真实插件，经 `ctx.agents.create` 建父/子 Agent，`applyChildComposition` 后 `presentAs('native')`，导出 `child.ctx.tools.schemas(child)`。LLM 为调用即抛错的桩；模型、元数据、网络调用均为 0，2 次假 stdio MCP 进程均关闭。
  - 结果：基础 25 项，standard 子 Agent 31 项（working_directory、read、write、edit、read_image、glob、grep、job_output/list/kill、skill、get/create/update_goal、todo_write、exit_plan_mode、web_search、web_fetch、bash、send_message、interrupt_agent、list_agents、subagent、subagent_fork、workflow、present、ask_user_question、schedule_create/list/delete/update）；加假 MCP 后 37 项（另含 list_mcp_resources、list_mcp_resource_templates、read_mcp_resource）；可选插件 38 项（terminal_*、str_replace_editor、bash-persistent 同名 `bash`）。
  - 来源插件：不能得到。`register()` 原样存定义、`schemas()` 只投影 name/description/parameters/deferLoading（dsh-tools/lib/index.js:2974-2982、3114-3146），定义无 plugin/package 字段。故能力表按精确工具名映射（`cli-native-capabilities.mjs` 的 `dshClasses`），映射已与上述导出逐项核对；MCP 名称规则 `mcp__<server>__<raw>`、非法字符替换并在有损时追加 12 位哈希，假服务器三例实测一致。
  - Windows 未执行，仅源码：基础集以 `pwsh`（dsh-tool-pwsh）替代 `bash`（dsh-base/cordis.patch.yml:281-287），pwsh-persistent 同名 `pwsh`，terminal_* 同名。映射已含 `pwsh`；Windows 实际目录待合并后在 Windows 上补核。
  - 导出脚本与 JSON 在本会话临时目录，未入库；主会话需复核时可重新运行同法。
- [x] 1.3 列出依赖 DSH 文件/命令工具的 DSH skill，评估影响。
  - 2026-10-28 本机（只读名称/frontmatter）：DSH 技能发现顺序为项目 `.dsh/skills`、项目 `.agents/skills`、customSkillDirs、`~/.dsh/skills`（本机不存在）、`~/.agents/skills`（31 个：cliworker-agy、cliworker-kimi、lark-* 27 个、tabbit）、受信 bundledSkillDir；本项目另有 6 个 openspec-*。扫描 6408 个候选 SKILL.md，均未声明 `requiredTools`。
  - 正文要求 DSH 式工具的：editing-cordis-compositions、cordis-plugin-development、cordis-composition-reference（grep）、diagnose-windows-sandbox-acl，以及 Office 系列（Bash/Node 调 LibreOffice Kit）。这些步骤改由 CLI 原生工具完成；Harness 专属路径或审批上下文相关的步骤可能在原生工具下行为不同，未逐项验证。
  - 影响处理：`requiredTools` 检查改为按获准目录（含被原生覆盖而未交出的工具），声明依赖的技能不会因去重而拒读；运行时 provider 返回 `requiredTools` 的情况未实测。
- [x] 1.4 核实各 CLI 原生开发者指令入口（Codex `developerInstructions`、Claude `--append-system-prompt` 等）与 Codex `tool_timeout_sec`；核实各 CLI MCP 对图片内容的支持；核实 Grok 私有 `GROK_HOME` 是否带入用户 MCP。
  - 2026-10-28 仅用 `--help`、`codex app-server generate-json-schema/generate-ts`、安装包源码与官方文档，无模型请求、登录或配置改动。版本：Codex 0.162.1、Claude Code 2.1.287、Pi 1.0.4、OpenCode 1.19.0、MiMo 0.1.15、ZCode 0.17.0；Kimi/Qoder/Grok/agy 帮助均退出 0（Kimi 带 `KIMI_CODE_NO_AUTO_UPDATE=1`）。
  - Codex：`ThreadStartParams`/`ThreadResumeParams` 均有 `developerInstructions: string|null`，与 `baseInstructions` 分离；不与配置的 `developer_instructions` 拼接（会取代），故用户已配置时不发送。`mcp_servers.<name>.tool_timeout_sec` 默认 60 秒，类型 number（官方 config schema）；`-c ...=1800` 的运行时解析未启动 app-server 验证。
  - Claude：`--append-system-prompt` 追加，兼容 `--print`、stream-json 与 `--resume`；恢复会话默认沿用首轮系统提示快照（`--system-prompt-snapshot`），未加 off，续聊时可能保留首轮说明。
  - Pi：`--append-system-prompt` 进入原生 addendum，保留 preamble；Pi 以私有 `PI_CODING_AGENT_DIR` 与 `--no-context-files` 运行。OpenCode：`prompt_async.system` 追加在 agent 提示之后。MiMo：`system` + `systemMode: "append"`，只取首轮请求，以 user 角色提醒注入。Grok：ACP `session/new._meta.rules` 追加（`systemPromptOverride` 才替换），`session/load` 持久性未核实。Kimi ACP 无入口（`session/new` 不读指令 `_meta`）；Qoder `--append-system-prompt` 在 ACP 及恢复下是否生效未核实；agy 只有会替换提示的自定义 agent；ZCode 无主会话指令字段。
  - MCP 图片：Claude 官方文档支持；OpenCode、MiMo、Kimi 源码确认转为图片输入（有大小/格式限制）；Codex 协议可表示图片但 MCP→模型转换未核实；Qoder、Grok、agy 未核实；Pi 原生扩展可返回图片，但本插件扩展桥只接受文本；ZCode 源码支持（未接桥）。
  - Grok：私有 `GROK_HOME` 不继承 `~/.grok/config.toml`，但默认仍扫描 `~/.claude.json`、`~/.cursor/mcp.json`、项目 `.mcp.json`，插件未关闭该扫描。

## 2. 实施

- [x] 2.1 新增按 CLI 的原生能力表，与启动参数同源计算。
  - `src/host/cli-native-capabilities.mjs`（+ `.d.mts`，已加入两份构建复制清单）：`nativeCliCapabilities({ cli, mode, mcpServers })` 返回 classes / withheld / mcpServers / mcpImages。Pi `--tools` 改读 `piOmpNativeTools`（`pi-omp-bridge.mjs`），Grok 的 `--disable-web-search`、`GROK_WEB_FETCH=0` 与规划工具改读 `GROK_NATIVE_WEB`、`GROK_PLAN_TOOLS`（`grok-adapter.ts`），输出与改动前一致（原测试通过）。后续 `reenable-native-cli-features` 改这些常量即同时改启动参数与目录。
  - Host 在 `index.ts` 工具桥准备处按 `cli`、`worker.mode` 及 `nativeCliMcpServers(cli, project)`（只读服务器名称）构造并传入。能力表为空（未知 CLI）即恢复全部交出。
- [x] 2.2 工具目录按能力表过滤重叠工具；同名 MCP 只保留 CLI 原生那份；交出的工具描述标明备选。
  - `native-harness-tools.ts`：`grantedTools`（宿主获准）与 `visibleTools`（去掉 `nativeCoverage` 命中者）分开；`tools/list`、`tools/call`、缓存回执复核都用 `visibleTools`，被覆盖工具不可经桥调用；描述加「备选（DSH）：仅在 CLI 自身工具无法完成时使用。」（含三个 skill 读取工具）。规划模式的写入列入 `withheld`，不作备选。DSH `skill` 工具不交出，技能只经 `dsh_read_skill` 按需读取。
- [x] 2.3 有原生指令入口的 CLI 附原生优先说明（只列实际交出的工具）。
  - 说明由 `nativeFirstGuidance` 生成，工具名取 `NativeHarnessConnection.tools`（运行开始时实际交出的快照）；工具桥未就绪或没有交出工具时不发。接入：Codex `developerInstructions`（start/resume）、Claude `--append-system-prompt`、Pi `--append-system-prompt`（列 Pi 实际看到的扩展工具名）、OpenCode/MiMo `prompt_async.system`、Grok 新会话 `_meta.rules`。Kimi、Qoder、Antigravity 无已核实入口，不加；不改写用户任务。
- [x] 2.4 Codex MCP 注入设置 `tool_timeout_sec`。
  - 宿主审批无独立等待上限（dsh-user-approval 无超时），取本次任务时限：`buildNativeHarnessInjection({ toolTimeoutMs: config.timeoutMs })` → `mcp_servers.dsh_worker_tools.tool_timeout_sec=<秒>`。与 `configure-worker-time-limit` 合并时应改用其统一 deadline；「不限制」时需给出明确上限。
- [x] 2.5 未接通执行的 CLI 不注入目录（ZCode 等），任务记录写明原因。
  - `nativeHarnessToolCapability('zcode')` 返回 transport=false、原因「ZCode 工具桥执行尚未核验，未注入 DSH 工具目录」；Host 不建工具桥并把原因写入 `harnessConversation.reasons.tools/skills`；ZCode 的 `mcpServers` 随之为空。
- [x] 2.6 非文本结果透传或在目录阶段排除。
  - MCP 支持图片的 CLI（Claude、OpenCode、MiMo、Kimi）：Host 经 `attachments.imageHostPath` 读取图片附件，转为 `{ type: 'image', data, mimeType }` 透传（`harness-attachments.ts` `readHarnessImage`，仅 png/jpeg/webp/gif，受 1 MiB 桥响应上限约束）。其余 CLI 保持「非文本内容尚不支持」并标错。`read_image`（只返回图片）：原生能看图时按重叠排除，否则在 MCP 不支持图片时于目录阶段排除。MCP 工具是否返回图片无法在目录阶段预知，仍按调用时投影处理；文件引用目前无工具产生，额外上下文仍标错。

## 3. 自动检查

- [x] 3.1 目录与注入夹具：重叠工具被排除、原生缺失能力（Pi shell）的 DSH 工具保留、同名 MCP 去重、描述带备选标记、说明内容与实际目录一致、未接通不注入；执行仍走宿主审批。
  - 新增 `tests/cli-native-capabilities.test.ts`（模拟夹具，目录名按 1.2 导出）：Codex 只交出 web_search、web_fetch、todo_write、ask_user_question、DSH 独有 MCP，且被覆盖工具调用被拒、未执行；Pi 交出 bash/terminal/job，调用经 `authorize`（宿主授权）后执行一次；规划模式不交写入；同名 MCP（含非法字符规范化）去重、空能力表回退；被覆盖的 `requiredTools` 仍可读技能；说明与 `connection.tools` 一致；Claude 图片透传、Codex 保持错误投影；ZCode 不注入；Codex `tool_timeout_sec`；Claude `--append-system-prompt` 在 `--print` 前且任务原样；Codex 已配 `developer_instructions` 时检测为真；Grok 新会话带 `_meta.rules`、恢复不带、任务文本不含说明；Antigravity 保留搜索/网页备选；Codex/Claude/Kimi/Grok/Antigravity MCP 名称只读名称。
  - 更新 `native-harness-tools.test.ts`（描述前缀、ZCode 不注入）与 `harness-service-integration.test.ts`（真实 Host 准备路径传入 OpenCode 规划模式能力表）。
  - Codex 审查后修正（2026-10-28）：同名 MCP 只认确定身份，即服务器名合法且 `mcp__<server>__` 之后不再含 `__`。规范化或带哈希后缀的名称、可能属于 `github__x` 之类其他服务器的名称，都保留为备选。Codex 读取顺序为 `CODEX_HOME`，再到项目各上级目录的 `.codex/config.toml`，后层的 `enabled` 生效。`enabled = false`（含行内表写法）不算原生覆盖。TOML 按字符串扫描，多行字符串和注释里的示例行不算定义；`[mcp_servers]` 下的普通值也不算服务器。Claude 的 `disabledMcpServers` 不算；项目 `.mcp.json` 只算 `enableAllProjectMcpServers` 或 `enabledMcpjsonServers` 已批准且不在 `disabledMcpjsonServers` 中的服务器。`developer_instructions` 检测也包含上级目录各层，多行值里的示例不算。夹具已覆盖上述情形。
  - 未单测：Codex runner 实际发送 `developerInstructions`、OpenCode/MiMo runner 实际发送 `system`、Pi bridge 实际带 `--append-system-prompt`（代码走查 + 共用的 `nativeHarnessGuidance`/`nativeFirstGuidance` 单测覆盖）。
- [x] 3.2 `pnpm typecheck`、关联测试、`pnpm build:preview`。
  - 2026-10-28 macOS：`corepack pnpm build:preview` 退出 0，`lib/cli-native-capabilities.mjs` 与 `lib/types/host/cli-native-capabilities.mjs` 均已打包。新 worktree 无 `lib/`，Client 类型检查缺生成的 `lib/typert.remote-client.d.ts`；复制预览产物到被忽略的 `lib/` 后 `corepack pnpm typecheck` 通过（Host/Client，DSH 0.2.1-rc.3）。
  - 关联测试 24 个文件 555 项通过：cli-native-capabilities、native-harness-tools/extended/lease、native-agy-harness、harness-service-integration、harness-model-guard、pi-omp-adapter/native、grok-adapter/context-status/model-context、native-acp、native-qoder、native-zcode、native-http、native-primary-runners、native-guidance、codex-run-usage、kimi-durable-usage、harness-native-attachments、native-attachments、ten-cli-native-parity、native-launch。未运行全量 `pnpm test`，未运行 `pnpm build`，未做 Windows 检查。
  - 审查修正后：`corepack pnpm vitest run`（全量）238 个文件中 235 个通过、3 个跳过，4748 项中 4735 项通过、13 项跳过；`corepack pnpm typecheck` 通过。仍未运行 `pnpm build`，也未做 Windows 检查。

## 4. 真实验收（需已有选型授权）

- [ ] 4.1 Codex 与 Pi 任务中检查实际工具目录、原生优先的工具选择及备选 DSH 工具调用；未验证项在本任务下列出。
  - 待合并后由主会话执行。尚未验证：真实 CLI 收到的目录与说明、原生优先的实际工具选择、Pi 备选 bash 经宿主审批、Codex `tool_timeout_sec` 与 `developerInstructions` 运行时生效、Claude/OpenCode/MiMo/Grok 说明实际生效、图片透传、Windows 目录（pwsh）。

## 5. 文档

- [x] 5.1 README 工具桥说明、`doc/native-harness-tools.md` 接入矩阵（含 Antigravity 现状）同步；验证记录写在本文件对应任务下。
  - README（中/英）新增「原生工具优先，DSH 工具作为备选」；`doc/native-harness-tools.md` 更新 ZCode、Antigravity 行并新增「原生工具优先」一节（映射、MCP 名称来源、逐 CLI 说明入口与图片支持）；`doc/cli-harness-capabilities.md` 修正 Antigravity/ZCode 行；`doc/design.md` 追加决策记录。
