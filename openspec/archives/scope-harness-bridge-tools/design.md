# Design: CLI 原生工具优先，DSH 工具作为备选

## 能力表

Host 新增按 CLI 的原生能力表（如 `src/host/cli-native-capabilities.ts`），描述该 CLI 在插件当前启动参数下**实际启用**的能力类别：`file-read`、`file-write`、`search`、`shell`、`web`、`mcp:<server>`、`skills`。它随启动参数计算，例如：

- Codex：file-read/write、search、shell、web（随权限预设）、用户 `config.toml` 中的 MCP 名称、原生 skills。
- Pi：file-read、search，写任务加 file-write；**无 shell**（`pi-omp-bridge.mjs:421`）。
- Grok：关闭 web（`--disable-web-search`、`GROK_WEB_FETCH=0`）。
- OpenCode/MiMo：外部 skills 关闭、`mcp: {}`。

DSH 工具按来源插件映射到能力类别（`dsh-tool-fs`→file-read/write、`dsh-tool-fs-search`→search、`dsh-tool-bash`/`dsh-tool-pwsh`/`dsh-tool-terminal`→shell、`dsh-tool-web`→web、MCP 服务器→`mcp:<server>`）。若 `tools.schemas()` 不暴露来源插件，退而用工具名精确映射，并在实施时用实际目录核实。

规则：DSH 工具的能力类别已被该 CLI 原生覆盖 → 不交出；否则交出并标记备选。能力表与启动参数同源计算，后续变更重新启用某原生能力时，对应 DSH 工具自动退出目录。

## 原生优先说明

- Codex：`thread/start.developerInstructions`，不覆盖 `baseInstructions` 与 AGENTS.md。
- Claude Code：`--append-system-prompt`（需核实与当前参数兼容）。
- 其他 CLI：逐一核实原生指令入口；没有则不加，不改写用户任务。
- 内容控制在数行：原生工具与 skill 优先；`dsh_worker_tools` 仅在原生工具缺失或失败时使用；列出实际交出的工具名。

## 其他

- 工具描述前缀：「备选（DSH）：仅在 CLI 自身工具无法完成时使用。」
- `tool_timeout_sec`：取宿主审批等待上限与单工具执行上限之和，需先确认 Codex 默认值与字段生效方式。
- 非文本内容：统计可能返回图片等内容的宿主工具；CLI 原生 MCP 支持的透传，不支持的在目录阶段排除。
- 风险：依赖 DSH 文件工具的 DSH skill 失效。缓解：实施前列出受影响技能；其操作改由 CLI 原生工具完成。
- 回退：能力表置空即恢复「全部交出」。
