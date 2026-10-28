## Why

`reenable-native-cli-features`（提交 17b0763）调查 skill 时发现：OpenCode 与 MiMo Worker 虽已关闭外部插件和多数导入开关，仍有入口会读入插件没有核验的配置，或把其他 CLI 的数据带进本 CLI。按项目原则，这类入口属于账号隔离，必须关闭；但 MiMo 的模型与账号本来就来自用户自己的 MiMo 配置，不能为了隔离改变来源。

2026-10-28 对已安装的 opencode 1.19.0、mimocode 0.1.15 二进制内嵌源码重新核实（只读，未读取任何用户配置或凭据内容）：

- OpenCode（`src/host/opencode-adapter.ts` 的 `openCodeEnvironment`）把 `XDG_CONFIG_HOME`、`OPENCODE_CONFIG_DIR` 指向私有目录，但 CLI 的配置目录列表还包含 `<Global.Path.home>/.opencode`，其中 home 取 `OPENCODE_TEST_HOME ?? os.homedir()`，即真实 HOME。该目录中的 `opencode.json(c)` 会在插件写入的 provider 配置之后合并，可以覆盖所选 provider 的 `apiKey`/`baseURL`，也会追加 `mcp`、`agent`、`instructions` 等；目录下的 `command/`、`agent/`、`mode/` 也会加载；CLI 还会在该目录写 `.gitignore` 并后台安装 `@opencode-ai/plugin` 依赖。插件的账号档案（`readOpenCodeProfile`）只认 `~/.config/opencode` 与插件登录目录，不包含 `~/.opencode`。外部插件已由 `OPENCODE_PURE=1` 在服务端跳过。
- MiMo（`src/host/first-party-models.ts` 的 `firstPartyEnvironment('mimo')`）在每次启动的命令行中间件里运行 `claude-import`：扫描 `~/.claude/projects/*/*.jsonl`（Claude Code 会话记录），并写入 MiMo 当前数据库（Worker 与模型发现用的是用户真实 MiMo 数据库）。该导入只有 `MIMOCODE_DISABLE_CLAUDE_IMPORT` 能关闭，目前没有设置。Codex、OpenCode 会话导入只经服务端导入接口触发，插件不调用。
- MiMo 读取真实 HOME、XDG 配置、`~/.mimocode` 与项目 `mimocode.json(c)`/`.mimocode`。这些都是 MiMo 自己的配置；插件的模型发现（`readFirstPartyModelSources`）与启动前检查（`assertMimoConfiguration`）本来就把它们当作自身来源（含项目级 `provider.apiKey`）。外部插件已由 `MIMOCODE_PURE=1` 跳过，Claude Code 命令与 MCP 已关闭。

## What Changes

- OpenCode：Worker、模型发现与账号登录的环境把 CLI 的 Global home 指向插件私有的空目录，真实 `~/.opencode` 不再作为配置目录参与合并、加载或依赖安装。shell 的 `HOME` 不变。
- OpenCode：用户放在 `~/.opencode/skill(s)` 的 skill 继续以绝对路径通过 `skills.paths` 提供，保持可见。
- MiMo：模型发现、Worker、分支元数据操作与账号登录共用的环境加入 `MIMOCODE_DISABLE_CLAUDE_IMPORT=1`，不再把 Claude Code 会话导入 MiMo 数据库。已导入的历史会话保留，插件不删除用户数据。
- MiMo 项目配置、`~/.mimocode`、真实 HOME 与 XDG 配置保持不变（它们是 MiMo 自身的账号与模型来源）；记录不关闭的理由。
- 不改动：Claude 指令文件（CLAUDE.md）读取、MiMo `.agents` skill 等非账号类行为，留待单独决定。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cli-account-isolation`：新增 OpenCode/MiMo 不读入未核验配置目录、不导入其他 CLI 会话数据的要求，并保证用户 skill 仍可见。

## Impact

- Host：`src/host/opencode-adapter.ts`（`openCodeEnvironment`，同时影响 `prepareOpenCode`、`discoverOpenCode`、`harness-opencode-accounts.ts` 登录）；`src/host/first-party-models.ts`（`firstPartyEnvironment`，同时影响 MiMo 模型发现、`runtime.ts` 的 Worker 与分支元数据启动、`first-party-account-context.ts` 登录）。
- Client、Gateway 协议、安装方式：无变化。
- 私有存储：OpenCode 每个状态目录多一个空的 `home` 子目录（0700）。
- 测试：`tests/harness-opencode-accounts.test.ts`、`tests/first-party-models.test.ts`、`tests/first-party-account-context.test.ts`、`tests/native-http.test.ts`。
- 文档：README（中英）「关闭的原生功能」、`doc/design.md`。
