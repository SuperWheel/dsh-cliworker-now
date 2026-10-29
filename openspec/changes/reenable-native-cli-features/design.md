# Design: 重新启用 CLI 原生功能

## 关闭项分类

| CLI | 关闭项 | 类别 | 本次处理 |
| --- | --- | --- | --- |
| Grok | 网页搜索、网页抓取 | 无记录理由 | 启用 |
| Grok | 子 Agent | 两层任务树 | 保留（用户 2026-10-29 决定） |
| Grok | 记忆 | 无记录理由（跨会话内容） | 跟随用户原生设置，共用原生记忆 |
| ZCode | Agent、Task、SendMessage、工作流 | 两层任务树 | 保留（用户 2026-10-29 决定） |
| ZCode | Skill | 与 Agent 一并禁用（核实：不涉及委派） | 随子 Agent 一并保留 |
| ZCode | 记忆（桥回复 `memoryEnabled: false`，原清单漏列） | 无记录理由 | 跟随桌面端设置，共用原生记忆 |
| ZCode | 浏览器 REPL（`mcp__node_repl__js`） | 无记录理由 | 保留，需核实后再议 |
| OpenCode/MiMo | 外部 skill | 初次接入隔离 | 启用（核实目录） |
| OpenCode/MiMo | 外部插件、Claude Code 配置导入、项目配置 | 账号隔离 | 保留 |
| OpenCode/MiMo、OMP | LSP | 避免自动下载与性能 | 保留 |
| Pi | bash | 无法遵循 DSH 权限（无原生审批） | 仅完全权限启用 |
| OMP | bash | 同 Pi，OMP 有原生 `approvalMode` | 工作区内修改（`write`，审批转 DSH）与完全权限（`yolo`）启用 |
| Pi/OMP | 扩展、用户 skill、规则 | 账号隔离 / 加载用户扩展 | 保留 |
| Hermes | 插件、MCP、只开 terminal/file | 安全隔离 | 保留（工具桥接入后另议） |
| Hermes | 内置记忆 | 无记录理由 | 跟随账号原生设置，共用原生记忆，工具集加 `memory` |
| OMP | 记忆 | 账号隔离（记忆依赖含账号的私有会话库） | 保留（用户 2026-10-29 决定） |

## 实现要点

- Grok：删除 `--disable-web-search` 与 `GROK_WEB_FETCH: '0'`；核实 ACP 模式下网页抓取是否另需权限审批，按 `relay-native-approvals-to-host` 处理。
- OpenCode/MiMo：`OPENCODE_DISABLE_EXTERNAL_SKILLS` 只控制兼容的外部 skill 目录（如 `.claude/skills`、`.agents/skills`）；插件把 `XDG_CONFIG_HOME` 指向私有目录，用户 OpenCode 原生 skill 目录不在其中。需按实际版本核实 skill 发现路径，采用只读方式把用户 skill 目录提供给 CLI（如通过 CLI 支持的 skill 路径配置），不复制用户 provider 配置。外部 skill 目录中的 `.claude/skills` 不含凭据，可启用；若同时会触发读取 Claude 配置则保留关闭。
- Pi：`--tools` 在完全权限时追加 `bash`；预设来自 `relay-native-approvals-to-host` 的每轮快照；能力表随之更新，DSH 命令工具自动退出目录。
- OMP：16.4.4 核实 `approvalMode` 为 `always-ask/write/yolo`，`write` 下经 RPC `extension_ui_request`（select，选项 Approve/Deny）询问，可回 `extension_ui_response`。桥把它转为 DSH 审批帧，按 `relay-native-approvals-to-host` 的通路回写；工作区内修改用 `write`，完全权限用 `yolo`，两档均开放 bash。
- OpenCode/MiMo 结论：两者均支持配置 `skills.paths`。不打开 `OPENCODE_DISABLE_EXTERNAL_SKILLS`（`.claude/skills` 还需打开 Claude Code 导入，`.agents/skills` 不是 OpenCode 自己的目录），改为把用户自己的 skill 根目录写入 `skills.paths`，skill 权限改为 allow。

## 用户决定与实现（2026-10-29）

用户原话：「内部子agent不启用，然后记忆要启用」；补充「记忆要看原生cli默认有没有开启，如果用户在之前的cli里开启了记忆那就启用记忆，如果用户之前没管理过，那就不开启」。记忆位置选「与直接使用共用」；OMP 选「保持关闭并记理由」；ZCode 选「一起核实并启用」。

- 子 Agent：Grok、ZCode 现有关闭参数不变，ZCode `Skill` 随之保留。Claude Task、Codex 多 Agent 维持现状，不在本变更调整。
- 记忆判定（插件只读开关字段，不读凭据）：Worker 开关 = 用户原生 CLI 当前生效的设置，未设置取 CLI 默认值。
  - Grok 1.0.62：`~/.grok/requirements.toml` → `GROK_MEMORY` → `~/.grok/config.toml`，文件内 `[memory_v2] enabled` 优先于 `[memory] enabled`；默认关；远端托管设置不可见，按未设置。开启时不传 `--no-memory`、`GROK_MEMORY=1`。
  - Hermes：账号 `config.yaml` 的 `memory.memory_enabled`/`user_profile_enabled`（缺省开），附带字数上限与 `nudge_interval`；开启时 `api_server` 工具集加 `memory`。外部记忆服务需要插件，仍关闭。
  - ZCode：桌面端 `~/.zcode/v2/setting.json` 的 `memoryEnabled`（默认 false）。CLI 自身 `features.memory` 默认开，由客户端在 `session/requestRuntimePreferences` 回复用户开关；adapter 经 `CLIWORKER_ZCODE_NATIVE_MEMORY` 把开关交给桥，桥删除该变量后再启动 CLI。分支与元数据操作仍回复关闭。记忆提取用本轮模型。
- 共用：Worker 私有记忆路径换成指向原生记忆目录的链接（Windows junction），临时名建好后改名发布；原有空目录替换，含文件的目录改名保留；关闭时只删除链接。Grok `<GROK_HOME>/memory-v2` → `~/.grok/memory-v2`；Hermes `hermes-http-home/memories` → `<账号 HERMES_HOME>/memories`；ZCode `<ZCODE_STORAGE_DIR>/cli/memories` → `<ZCODE_STORAGE_DIR 或 ~/.zcode>/cli/memories`。
- OMP（17.0.1 源码核实）：本地记忆从 `agent.db` 的会话整理，第二阶段按本库结果整份同步并重写记忆目录，整理模型取 `smol` 角色；Worker 的 `agent.db` 私有且含账号。共用目录会被各自的库覆盖，单个 Worker 内又只整理闲置足够久的旧会话，基本不生效，因此保留 `backend: off`。

## 依赖

- Pi bash 依赖 `relay-native-approvals-to-host` 提供的预设读取（任务 2.1）。
- 能力表变化由 `scope-harness-bridge-tools` 统一处理。

## 风险与回退

- Grok 网页能力会访问外网：属于 Grok 原生功能，按 DSH 预设与 CLI 原生权限处理。
- 共用记忆会把 Worker 的任务内容写进用户原生记忆，CLI 后台整理可能额外调用模型：属于用户已开启的原生行为。回退：删除链接并恢复 `--no-memory`/`memory_enabled: false`/`memoryEnabled: false`。
- 用户 skill 可能包含与当前任务冲突的指令：属于用户自己的配置，与原生使用一致。
- 回退：恢复对应参数即可。
