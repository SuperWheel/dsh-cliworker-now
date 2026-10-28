# Design: 重新启用 CLI 原生功能

## 关闭项分类

| CLI | 关闭项 | 类别 | 本次处理 |
| --- | --- | --- | --- |
| Grok | 网页搜索、网页抓取 | 无记录理由 | 启用 |
| Grok | 子 Agent | 两层任务树（存疑） | 待用户决定 |
| Grok | 记忆 | 无记录理由（跨会话内容） | 待用户决定 |
| ZCode | Agent、Task、SendMessage、工作流 | 两层任务树（存疑） | 待用户决定 |
| ZCode | Skill | 与 Agent 一并禁用，需核实是否涉及委派 | 随子 Agent 决定一起处理 |
| ZCode | 浏览器 REPL（`mcp__node_repl__js`） | 无记录理由 | 保留，需核实后再议 |
| OpenCode/MiMo | 外部 skill | 初次接入隔离 | 启用（核实目录） |
| OpenCode/MiMo | 外部插件、Claude Code 配置导入、项目配置 | 账号隔离 | 保留 |
| OpenCode/MiMo、OMP | LSP | 避免自动下载与性能 | 保留 |
| Pi | bash | 无法遵循 DSH 权限（无原生审批） | 仅完全权限启用 |
| OMP | bash | 同 Pi，OMP 有原生 `approvalMode` | 核实后按预设映射 |
| Pi/OMP | 扩展、用户 skill、规则 | 账号隔离 / 加载用户扩展 | 保留 |
| Hermes | 插件、MCP、记忆、只开 terminal/file | 安全隔离 | 保留（工具桥接入后另议） |

## 实现要点

- Grok：删除 `--disable-web-search` 与 `GROK_WEB_FETCH: '0'`；核实 ACP 模式下网页抓取是否另需权限审批，按 `relay-native-approvals-to-host` 处理。
- OpenCode/MiMo：`OPENCODE_DISABLE_EXTERNAL_SKILLS` 只控制兼容的外部 skill 目录（如 `.claude/skills`、`.agents/skills`）；插件把 `XDG_CONFIG_HOME` 指向私有目录，用户 OpenCode 原生 skill 目录不在其中。需按实际版本核实 skill 发现路径，采用只读方式把用户 skill 目录提供给 CLI（如通过 CLI 支持的 skill 路径配置），不复制用户 provider 配置。外部 skill 目录中的 `.claude/skills` 不含凭据，可启用；若同时会触发读取 Claude 配置则保留关闭。
- Pi：`--tools` 在完全权限时追加 `bash`；预设来自 `relay-native-approvals-to-host` 的每轮快照；能力表随之更新，DSH 命令工具自动退出目录。
- OMP：先核实 `approvalMode` 的取值与是否产生可拦截的审批事件。

## 依赖

- Pi bash 依赖 `relay-native-approvals-to-host` 提供的预设读取（任务 2.1）。
- 能力表变化由 `scope-harness-bridge-tools` 统一处理。

## 风险与回退

- Grok 网页能力会访问外网：属于 Grok 原生功能，按 DSH 预设与 CLI 原生权限处理。
- 用户 skill 可能包含与当前任务冲突的指令：属于用户自己的配置，与原生使用一致。
- 回退：恢复对应参数即可。
