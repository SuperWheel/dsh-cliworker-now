# Design

## Context

各 CLI 登录状态与绑定的来源（以 `src/host/accounts.ts` `readStatus` 与 `src/host/cli-account-binding.ts` 为准，排查时逐个核对）：

| CLI | 插件读取的来源 |
| --- | --- |
| Antigravity | Windows 凭据管理器 `gemini:antigravity`／macOS 钥匙串，再到 `~/.gemini/jetski-standalone-oauth-token`（变更 `v0.9.1-agy-token-file-fallback-leeyl`） |
| Codex | 按 `cli_auth_credentials_store` 读 `~/.codex/auth.json` 或系统凭据库，旧版回退 `codex login status` |
| Claude Code | `claude auth status --json`，按所选路由 |
| Kimi | `kimi provider list --json` |
| MiMo | MiMo 本地配置（`mimo-configuration.ts`） |
| ZCode | ZCode 授权目录 `.zcode/v2/credentials.json` |
| Grok Build | `~/.grok/auth.json`，插件续期 |
| OMP、Pi | 各自账号存储，经可执行文件读原生登录方式列表 |
| Hermes Agent | Hermes 本地账号与 Nous 授权，插件续期 |
| OpenCode | 插件私有 OpenCode 授权目录 |
| Qoder、Qoder CN | Qoder SDK daemon |
| CodeBuddy Code | CodeBuddy 登录状态与 `auth.json` 站点域名 |
| TRAE CN | `~/.trae/cli/auth.json`（`TRAE_HOME` 可改） |
| WorkBuddy CN、WorkBuddy | 桌面端 bootstrap 元数据与密钥 |

## Decisions

### 决定 1：Antigravity 单独成变更
issue #13 的修复已有独立规格、设计与 Windows 测试，保留为 `v0.9.1-agy-token-file-fallback-leeyl`，同属 REQ-0136；本变更排查其余 16 个 CLI。

### 决定 2：排查方法沿用 issue #13 的做法
先确认 CLI 自己读取登录的顺序和位置（官方文档、程序内文本、只读键名与文件名），不输出凭据值；再让插件按同样顺序读取。同一账号的绑定 MUST NOT 因存放位置变化而改变，避免误判换号。

### 决定 3：验收按「一个账号成功即视为可登录」
沿用 2026-11-09 的约定：同一 CLI 一个账号登录成功即视为其他账号或站点可登录；退出、切换账号仍按证据验证。只对排查中有改动的 CLI 做真实派遣验收。

### 决定 4：更新后重读写成规格
代码已在更新完成与版本指纹变化时作废账号与模型显示缓存，现有测试覆盖更新服务调用作废回调（`tests/cli-management-phase-b.test.ts`）。规格补写这条行为，防止后续改动丢失。

## Risks

- 部分 CLI 需要真实账号或订阅；缺少时写明阻塞。
- 排查期间 CLI 仍会自动更新，结论以记录的版本号为准。
- Kimi 探测须设 `KIMI_CODE_NO_AUTO_UPDATE=1`；Windows 凭据管理器经 SSH 不可见，须在交互桌面会话验证。
