## Context

动机见 proposal.md「Why」。相关现状：

- OpenCode 的环境只由 `openCodeEnvironment` 生成，Worker（`prepareOpenCode`）、模型发现（`discoverOpenCode`）与登录（`harness-opencode-accounts.ts`）三处共用；原生 HTTP 通路（`native-session-http.mjs`）在此环境上叠加 `OPENCODE_CONFIG_CONTENT`。
- MiMo 没有私有配置目录：模型发现（`readFirstPartyModelSources`）、Worker 与分支元数据启动（`runtime.ts`）都用 `firstPartyEnvironment('mimo')` 加真实 HOME/XDG；登录（`first-party-account-context.ts`）在此基础上换成私有 HOME（Windows 直接用真实路径）。
- opencode 1.19.0 配置合并顺序（内嵌源码 `Config.loadInstanceState`）：私有全局配置 → `OPENCODE_CONFIG`（插件写入的 provider）→ 项目配置（已关闭）→ 配置目录列表 `[私有 config, <home>/.opencode, OPENCODE_CONFIG_DIR]` 中 `.opencode` 目录的 `opencode.json(c)`，并对每个目录写 `.gitignore`、后台安装 `@opencode-ai/plugin`、加载 command/agent/mode/plugin → `OPENCODE_CONFIG_CONTENT` → 系统托管配置。合并是深度合并，`OPENCODE_CONFIG_CONTENT` 里的 `mcp: {}`、`plugin: []` 不会删除前面加入的键。
- opencode 1.19.0 的 `Global.Path.home` 是 getter：`process.env.OPENCODE_TEST_HOME ?? os.homedir()`；用途只有 `.opencode` 目录扫描、路径显示里的 `~` 缩写、HTTP `path` 接口返回值，以及 `~/.claude/CLAUDE.md` 与外部 skill 扫描（两者已由开关关闭）。
- mimocode 0.1.15 在 yargs 中间件中运行：`if (!MIMOCODE_DISABLE_CLAUDE_IMPORT && !MIMOCODE_CLAUDE_IMPORTED) claude-import`，读取 `<HOME>/.claude/projects/*/*.jsonl` 写入 `external_import` 与会话表。MiMo 的 home 只取 `HOME || USERPROFILE || os.homedir()`，没有单独覆盖项。

## Goals / Non-Goals

**Goals:**

- 去掉 OpenCode 对真实 `~/.opencode` 的读取与写入，保留其中 skill。
- 去掉 MiMo 启动时的 Claude Code 会话导入。
- 不改变 OpenCode 与 MiMo 的账号、provider、模型来源，不改变 shell 命令所见的 `HOME`。

**Non-Goals:**

- 不关闭 MiMo 项目配置或 `~/.mimocode`：它们是 MiMo 自身来源，模型发现会把项目级 `provider.apiKey` 认作账号来源；关闭会改变用户可选模型，且 `MIMOCODE_DISABLE_PROJECT_CONFIG` 还会一并去掉项目 `AGENTS.md` 指令。
- 不处理 CLAUDE.md 指令读取（MiMo 目前读取、OpenCode 已关闭）和 MiMo 默认扫描的 `.agents` skill：它们不涉及账号、provider 或凭据，是否统一另行决定。
- 不清理用户 MiMo 数据库中已导入的 Claude 会话。
- 系统托管配置（`/Library/Application Support/opencode` 等）属于管理员策略，维持现状。

## Decisions

### OpenCode：用 `OPENCODE_TEST_HOME` 指向私有空目录

`openCodeEnvironment` 在状态目录下新建 `home` 子目录（与 config/data/cache 同样 0700、拒绝符号链接），并设 `OPENCODE_TEST_HOME` 为该目录。

备选：

- 覆盖 `HOME`：也能改变 `os.homedir()`，但 OpenCode 的 shell 工具继承此环境，用户命令会失去真实的 Git、SSH、npm 配置，影响面远大于缺口本身。否决。
- 启动前检测 `~/.opencode/opencode.json(c)` 并拒绝派遣：不能阻止 command/agent 加载与依赖安装，且会让存在该目录的用户无法使用。否决。
- 用 `OPENCODE_CONFIG_CONTENT` 覆盖：深度合并无法删除已加入的 provider 选项或 MCP。否决。

`OPENCODE_TEST_HOME` 名称带 TEST，但在 1.19.0 中是生产代码路径读取的 getter，且只影响上文列出的几处。风险见下文。

### OpenCode：skill 仍由 Host 计算真实路径

`nativeSkillPaths` 在 Host 进程内用真实 `homedir()` 计算 `~/.opencode/{skill,skills}`，作为绝对路径写入 `skills.paths`，不依赖 CLI 的 home。无需改动，只补测试证明 home 改向后 skill 仍在列表中。

### MiMo：`firstPartyEnvironment('mimo')` 加 `MIMOCODE_DISABLE_CLAUDE_IMPORT=1`

所有 MiMo 启动入口都经过这一个函数，一处修改覆盖模型发现、Worker、分支元数据和登录。备选是覆盖 `HOME`，否决理由同 OpenCode，且会改变 MiMo 读取 `~/.mimocode` 自身配置。

## Risks / Trade-offs

- [OpenCode 后续版本移除或改名 `OPENCODE_TEST_HOME`，隔离悄然失效] → 文档与代码注释写明核实版本 1.19.0；自动测试断言环境包含该项；升级 CLI 时按 tasks.md 记录的对比步骤重新核对 `debug config`。
- [用户原本依赖 `~/.opencode` 中的 command/agent] → 这些与 `~/.config/opencode` 下同类内容一样，在 Worker 中本来就不加载（私有 `XDG_CONFIG_HOME`）；本次只是让两个全局目录一致。skill 保留。
- [OpenCode 路径显示里的 `~` 不再缩写真实主目录] → 仅影响显示文本，不影响行为。
- [MiMo 历史中已导入的 Claude 会话仍在数据库] → 不删除用户数据；如需清理由用户在 MiMo 内处理。

## Migration Plan

无数据迁移。新环境在下一次模型发现、派遣或登录时生效；正在运行的 Worker 保持启动时的环境。回退：删除 `OPENCODE_TEST_HOME` 一项与 `MIMOCODE_DISABLE_CLAUDE_IMPORT` 一项即可恢复原行为，私有 `home` 空目录可留可删。
