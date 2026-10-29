# Tasks

## 1. 核实

- [x] 1.1 按实际安装版本核实 OpenCode 与 MiMo 读取配置、插件、provider 与其他 CLI 数据的位置，区分账号隔离入口与 CLI 自身来源。
  - 2026-10-28（opencode 1.19.0 `/opt/homebrew/lib/node_modules/opencode-ai/bin/opencode.exe`、mimocode 0.1.15 `~/.mimocode/bin/mimo`，macOS；从 Bun 单文件二进制提取内嵌 JS 只读核实，未读取任何用户配置或凭据内容）。
  - OpenCode：`Global.Path.home = OPENCODE_TEST_HOME ?? os.homedir()`；`ConfigPaths.directories` = `[私有 config, <home>/.opencode, OPENCODE_CONFIG_DIR]`；`.opencode` 目录的 `opencode.json(c)` 在 `OPENCODE_CONFIG`（插件 provider）之后深度合并，并加载 command/agent/mode/plugin、写 `.gitignore`、后台安装 `@opencode-ai/plugin`。服务端外部插件由 `pure`（`OPENCODE_PURE`）跳过。插件账号档案 `readOpenCodeProfile` 不读 `~/.opencode`。home 的其他用途：路径 `~` 显示、HTTP `path` 接口、`~/.claude/CLAUDE.md` 与外部 skill（已关闭）。OpenCode 没有会话导入。
  - MiMo：home 只取 `HOME || USERPROFILE || os.homedir()`；配置目录含 `~/.mimocode` 与项目 `.mimocode`；外部插件由 `MIMOCODE_PURE` 跳过；Claude Code 命令/MCP 已关闭。yargs 中间件在 `!MIMOCODE_DISABLE_CLAUDE_IMPORT && !MIMOCODE_CLAUDE_IMPORTED` 时运行 `claude-import`，读 `<HOME>/.claude/projects/*/*.jsonl` 写入数据库 `external_import`。Codex（`~/.codex/sessions`）与 OpenCode 数据库导入只由服务端导入接口触发。
  - 结论：关闭 OpenCode 的 `~/.opencode` 配置目录与 MiMo 的 Claude 会话导入。保留 MiMo 项目配置、`~/.mimocode`、真实 HOME/XDG（插件模型发现与 `assertMimoConfiguration` 依赖它们，项目级 `provider.apiKey` 是已认可的账号来源；`MIMOCODE_DISABLE_PROJECT_CONFIG` 还会去掉项目 AGENTS.md）。

## 2. 实施

- [x] 2.1 OpenCode：`openCodeEnvironment` 建私有空目录 `home` 并设 `OPENCODE_TEST_HOME`，不改 `HOME`。
  - `src/host/opencode-adapter.ts`；Worker、模型发现、登录三处共用此函数。`nativeSkillPaths` 不变，仍用 Host 真实主目录。
- [x] 2.2 MiMo：`firstPartyEnvironment('mimo')` 加 `MIMOCODE_DISABLE_CLAUDE_IMPORT=1`。
  - `src/host/first-party-models.ts`；覆盖模型发现、`runtime.ts` 的 Worker 与分支元数据启动、`first-party-account-context.ts` 登录。

## 3. 自动检查

- [x] 3.1 隔离项与 skill 可见性测试（夹具均标注为模拟）。
  - `tests/harness-opencode-accounts.test.ts`：登录、Worker、模型发现三种环境的 `OPENCODE_TEST_HOME` 是各自私有空目录、不等于真实主目录、环境不含 `HOME`；新增用例在模拟主目录放 `.opencode/opencode.json`（模拟 provider 覆盖与 MCP）和 `.opencode/skills`，断言 `skills.paths` 仍含该 skill 目录、私有 home 下没有 `.opencode`、provider 仍为已核验档案的地址。
  - `tests/first-party-models.test.ts`、`tests/first-party-account-context.test.ts`（macOS 与 Windows 登录）：环境含 `MIMOCODE_DISABLE_CLAUDE_IMPORT=1`。
  - `tests/native-http.test.ts`：MiMo 带隔离环境经 `serverConfiguration` 后 skill 根目录仍写入、隔离开关保留。
- [x] 3.2 `pnpm typecheck`、关联测试、`pnpm build:preview`。
  - 2026-10-28：`corepack pnpm exec vitest run` 关联 8 个文件（上述 4 个加 cli-native-capabilities、agy-background-environment、extended-integration、http-context-relay）225 项通过；`corepack pnpm typecheck` 通过（DSH 0.2.1-rc.3）；`corepack pnpm build:preview` 成功，隔离包 `.cache/preview-package/lib/index.js` 含 `OPENCODE_TEST_HOME` 与 `MIMOCODE_DISABLE_CLAUDE_IMPORT`。未跑全量 `pnpm test`；未正式构建、未更新 Desktop 链接。
- [x] 3.3 真实二进制前后对比（模拟主目录与夹具，不调用模型，不读写真实配置与数据库）。
  - 步骤（便于升级 CLI 时复核）：用 `node --experimental-transform-types` 调源码中的 `openCodeEnvironment`/`firstPartyEnvironment` 生成环境；`env -i` 只传 `PATH`、模拟 `HOME` 与该环境运行 CLI；OpenCode 模拟主目录放 `.opencode/opencode.json`（`SIMULATED_home_mcp`、`SIMULATED_home_provider`）与 `.opencode/skills/simulated-home-skill/SKILL.md`；MiMo 设私有 `MIMOCODE_HOME`、`MIMOCODE_DISABLE_AUTOUPDATE=1`，模拟主目录放一条 `.claude/projects/-SIMULATED-project/<uuid>.jsonl`，用 `node:sqlite` 只读统计 `external_import` 中 `source='cc'` 行数。基线去掉对应开关。
  - OpenCode（`opencode debug config|skill|paths`，退出码均 0）：基线下模拟 MCP 与 provider 均出现在解析后配置，CLI 在模拟 `~/.opencode` 写入 `.gitignore`，home 为模拟主目录；修复后两者均不出现，`~/.opencode` 无新文件，home 为私有空目录，`simulated-home-skill` 在两种情况下都列出。
  - MiMo（`mimo debug paths`，退出码 0）：基线导入 1 行；修复后 0 行。修复后 `mimo debug skill` 列出 `skills.paths` 中的 `simulated-mimo-skill`，导入仍为 0 行。
  - 脚本与输出在本次会话临时目录，未入库。

## 4. 真实验收（需已有选型授权）

- [ ] 4.1 OpenCode 与 MiMo 真实账号下派遣 Worker：确认模型与账号来源不变、任务正常完成、用户 skill 可被调用，且真实 `~/.opencode` 不再被写入、MiMo 数据库不新增 Claude 导入会话。
  - 未执行：本次没有真实模型调用授权；本机没有 `~/.opencode`，未用真实配置复现。
- [ ] 4.2 Windows：OpenCode 桌面版启动路径与 MiMo 直连登录（真实主目录）下的同样检查。
  - 未执行。
  - 2026-10-29 Windows：OpenCode 真实派遣（`zai-coding-plan/glm-5.3-flash`·low，独立 WorkerRuntime）首次进程清理未确认，磁盘清理后重试通过（文件与清理均确认）；`~/.opencode` 前后均不存在；调用前后的账号来源对比未取得。MiMo 目录读取两次失败，直连登录检查未执行。证据在 `.test-data/windows-remote/full-20261029/`（不入 Git）。

## 5. 文档

- [x] 5.1 README（中英）「关闭的原生功能」与 `doc/design.md` 同步。
  - README 账号隔离一项改为准确列出 OpenCode 与 MiMo 各自关闭的入口，并说明 MiMo 项目配置与 `~/.mimocode` 属于自身来源；`doc/design.md` 新增 2026-10-28 本变更小节，上节「已知隔离缺口」指向本节。

## 6. 未改动、待决定

- [ ] 6.1 MiMo 读取 CLAUDE.md（项目与 `~/.claude/CLAUDE.md`）、默认扫描 `.agents` skill，与 OpenCode（均关闭）不一致；不涉及账号，是否统一由用户决定。
- [ ] 6.2 OpenCode Worker 因 `OPENCODE_DISABLE_PROJECT_CONFIG=1` 不加载项目 AGENTS.md（1.19.0 源码中 AGENTS.md 查找受该开关控制）；如需保留原生项目指令，另行评估。
