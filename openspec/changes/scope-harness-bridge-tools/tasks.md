# Tasks

## 1. 调查

- [x] 1.1 核对各 CLI 当前原生工具、MCP、skill 的启用与隔离情况及工具桥接入状态。
  - 2026-10-28 源码核对：工具均为 CLI 原生，DSH 以 `dsh_worker_tools` 叠加。用户自身 MCP/skill 生效：Codex（`config.toml`）、Claude（`~/.claude`，无 `--strict-mcp-config`）、Kimi、Qoder、Antigravity。被清空或隔离：OpenCode/MiMo（`mcp: {}`、外部 skills 关闭，`opencode-adapter.ts:102-124`）、Hermes（`mcp_servers: {}`、仅 terminal/file，`native-hermes-home.mjs:267-268`）、Pi/OMP（`--no-extensions --no-skills`，`pi-omp-bridge.mjs:255-268`）、ZCode 禁 `Skill`（`zcode-adapter.ts:30-48`）；Grok 用私有 `GROK_HOME`，用户自身 MCP 是否带入未核实。未接桥：OMP（安装版在 `--no-extensions` 下忽略显式扩展）、Hermes（SAFE_MODE 隔离无已核验注入入口）、ZCode（执行未准入）。`doc/native-harness-tools.md` 中 Antigravity「禁用」已过时。
- [ ] 1.2 导出 Windows 与 macOS 下子 Agent 实际 `tools.schemas()` 目录（无模型），确认能否得到来源插件，完成 DSH 工具→能力类别映射。
- [ ] 1.3 列出依赖 DSH 文件/命令工具的 DSH skill，评估影响。
- [ ] 1.4 核实各 CLI 原生开发者指令入口（Codex `developerInstructions`、Claude `--append-system-prompt` 等）与 Codex `tool_timeout_sec`；核实各 CLI MCP 对图片内容的支持；核实 Grok 私有 `GROK_HOME` 是否带入用户 MCP。

## 2. 实施

- [ ] 2.1 新增按 CLI 的原生能力表，与启动参数同源计算。
- [ ] 2.2 工具目录按能力表过滤重叠工具；同名 MCP 只保留 CLI 原生那份；交出的工具描述标明备选。
- [ ] 2.3 有原生指令入口的 CLI 附原生优先说明（只列实际交出的工具）。
- [ ] 2.4 Codex MCP 注入设置 `tool_timeout_sec`。
- [ ] 2.5 未接通执行的 CLI 不注入目录（ZCode 等），任务记录写明原因。
- [ ] 2.6 非文本结果透传或在目录阶段排除。

## 3. 自动检查

- [ ] 3.1 目录与注入夹具：重叠工具被排除、原生缺失能力（Pi shell）的 DSH 工具保留、同名 MCP 去重、描述带备选标记、说明内容与实际目录一致、未接通不注入；执行仍走宿主审批。
- [ ] 3.2 `pnpm typecheck`、关联测试、`pnpm build:preview`。

## 4. 真实验收（需已有选型授权）

- [ ] 4.1 Codex 与 Pi 任务中检查实际工具目录、原生优先的工具选择及备选 DSH 工具调用；未验证项在本任务下列出。

## 5. 文档

- [ ] 5.1 README 工具桥说明、`doc/native-harness-tools.md` 接入矩阵（含 Antigravity 现状）同步；验证记录写在本文件对应任务下。
