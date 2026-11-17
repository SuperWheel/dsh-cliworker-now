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

### 决定 4：CLI 更新不作废账号与模型缓存
用户 2026-11-17 决定：插件的定位是自动读取 CLI 的账号，CLI 更新后怎么处理登录，插件就怎么处理。CLI 更新不会让用户掉登录，插件也不因更新结束或版本指纹变化作废账号与模型显示缓存；它们照常按 10 分钟有效期，从 CLI 自己的登录来源重读。只有首次安装结束后作废一次，因为缓存里是「未安装」。执行入口（路径）变化、登录、退出、切换账号、启用状态变化的作废规则不变。

### 决定 5：绑定只看账号与站点，不看安装位置和版本
排查发现 WorkBuddy 两版把内置 CLI 版本和安装路径算进绑定，TRAE CN 把授权文件的绝对路径算进绑定，CLI 一更新或搬家就被当成换号。修法：绑定只由账号主体（无主体的 CLI 用站点）和路由生成，版本、安装路径、凭据的物理存放方式不参与。代价是这些 CLI 已保存的绑定在插件升级后对不上，需要重新绑定一次。插件私有账号与 CLI 自己的账号之间的来源区分是有意设计，保持不变。

### 决定 6：按 CLI 原生顺序补齐登录来源，不自行续期
CodeBuddy 的环境令牌、apiKeyHelper 与 API Key，MiMo 的 Token Plan 账号，Pi 1.5.2 的仅 env 凭据与模板，ZCode 0.17 的 `enc:v2` 加密及 `auth-source`，Hermes 的嵌套 `renewal` 与签发时间排序，都按各 CLI 安装包里的读取顺序补齐。插件只检查来源是否存在、读取身份字段，不执行 apiKeyHelper，不自己调用 OAuth 刷新接口；需要续期的走 CLI 原生入口，没有安全入口时给出明确提示，不显示成未登录。

### 决定 7：不在本次处理的差异
OMP、Pi 的 profile 与目录环境变量、OMP 在 XDG 目录存在时改用 XDG 数据目录：本机与测试机都未设置、目录不存在，Desktop 一般也不继承终端环境，只记录不修改。OpenCode 的 `OPENCODE_AUTH_CONTENT` 和 `wellknown` 凭据属于既有隔离边界。WorkBuddy 不提供账号主体接口，同站点换号仍无法识别，维持既有站点绑定语义。TRAE CN 0.215.0 的 `cli_auth_credentials_store` 支持 keyring／auto，存入钥匙串成功后会删除 `auth.json`（服务名先查 `Codex Auth` 再查 `TRAE CLI Auth`）；Mac 本机为文件存储且钥匙串无该条目（Windows 凭据管理器经 SSH 不可见，未核实），本次不实现钥匙串读取，此模式下仍显示未登录。

## Risks

- 部分 CLI 需要真实账号或订阅；缺少时写明阻塞。
- 排查期间 CLI 仍会自动更新，结论以记录的版本号为准。
- Kimi 探测须设 `KIMI_CODE_NO_AUTO_UPDATE=1`；Windows 凭据管理器经 SSH 不可见，须在交互桌面会话验证。
