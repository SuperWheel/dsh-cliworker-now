# Tasks

## 1. 排查方法与更新后保留登录缓存 〔后端｜3h〕
- [x] 1.1 去掉更新与版本指纹变化时对账号和模型缓存的作废（用户 2026-11-17 决定）
  - 证据：`src/host/cli-management/service.ts` 删除版本指纹变化时的 `invalidateModels` 调用；更新收尾改为仅 `intent === 'install'` 时调用
  - 证据：规格增量改为修改「连接快照、过期更新与来源作废」，见 `specs/cli-update/spec.md`
- [x] 1.2 模拟测试：更新成功、失败、取消及之后版本指纹变化都不作废；安装完成作废一次
  - 证据：`tests/cli-management-admission.test.ts` 改写 3 项；`tests/cli-management-phase-b.test.ts`、`tests/cli-management-local-artifacts-windows.test.ts` 的更新断言改为不调用；`tests/cli-management-install.test.ts` 新增安装后调用一次的断言
  - 证据：`corepack pnpm exec vitest run` 上述 4 个文件 159 项通过；临时恢复旧的指纹作废代码时 admission 3 项失败，恢复后通过
- [x] 1.3 记录 17 个 CLI 排查时的版本号（Mac 与 Windows 各一份）
  - 证据（2026-11-17 只读排查，Mac／Windows）：Antigravity 1.5.9／1.5.9；Codex 0.169.0／0.169.0；Claude Code 2.1.311／2.1.325；Kimi 2.6.1／2.5.3；MiMo 0.1.17／0.1.17；ZCode CLI 0.17.1／0.17.1（桌面 3.18.2）；Grok Build 1.0.77／1.0.77；Hermes Agent 0.23.1／0.23.1；OMP 18.20.2／18.20.2；Pi 1.5.2／1.5.2（Windows 插件记录的是 npm 全局包 1.5.2；另有 2026-10-10 的旧托管安装 1.1.0 在 PATH 前面）；OpenCode 1.19.5／1.19.5；Qoder 1.1.89／1.1.89；Qoder CN 1.1.89／1.1.89；CodeBuddy Code 2.184.0（Mac）；TRAE CN 0.215.0／0.215.0；WorkBuddy CN 桌面 5.11.3（CLI 2.176.0）／5.9.3（CLI 2.165.0）；WorkBuddy 国际版 Mac 未安装／5.9.4（CLI 2.165.0）
  - 证据：Kimi 命令均带 `KIMI_CODE_NO_AUTO_UPDATE=1`；Windows 经 SSH 只读查询；Windows Grok 的 `~/.grok/version.json` 仍写 1.0.50，以可执行文件内版本常量为准
  - 更正：最初把 Windows 旧托管安装 `~/.pi/agent/install` 的 `current-version`（1.1.0）误记为插件所用版本；插件实际路径是 npm 全局 `@earendil-works/pi-coding-agent` 1.5.2

## 2. 官方账号类：Codex、Claude Code、Kimi、MiMo 〔后端｜6h｜前置 1〕
- [x] 2.1 Codex：ChatGPT 账号与 API Key 两种登录，核对 auth.json 与系统凭据库
  - 证据：0.169.0 默认存储仍为 `file`（官方源码 `codex-rs/config/src/types.rs`）；两端 `codex login status` 退出 0；两端未配置 `cli_auth_credentials_store`，`auth.json` 键型与插件一致
  - 修复：`cli-account-binding.ts` 按 TOML 读取顶层 `cli_auth_credentials_store`（带引号键、表作用域）；keyring/auto 绑定去掉存储方式；`codex-account.ts` 新增经 `getAuthStatus(includeToken, refreshToken:false)` 取 API Key 并立即摘要的绑定读取
  - 证据：`vitest run tests/cli-account-binding.test.ts tests/codex-account.test.ts tests/accounts.test.ts` 3 个文件 240 项通过；文件模式哈希输入用冻结测试确认不变
  - 遗留：app-server 只提供邮箱与工作区名，同一 OAuth 账号在文件与钥匙串之间切换绑定仍可能不同
- [x] 2.2 Claude Code：官方账号与 API／代理路由，核对 auth status 字段与钥匙串条目名
  - 证据：Mac 2.1.311／Windows 2.1.325；Mac 无后缀与带目录哈希后缀两个钥匙串条目均存在（只查存在性）；官方覆盖后 `auth status --json` 退出 0；未发现新缺陷，无改动
  - 未执行：Windows 凭据管理器经 SSH 不可见
- [x] 2.3 Kimi：核对 provider list 输出；探测设 KIMI_CODE_NO_AUTO_UPDATE=1
  - 证据：两端 `provider list --json` 退出 0；2.6.1 包内 `resolveKimiTokenStorageName` 槽位映射、`doEnsureFresh` 惰性续期；`provider list` 与模型目录查询都不续期，只有 `/usage` 前会续期
  - 修复：`kimi-accounts.ts` 共用槽位解析；`kimi-oauth-models.ts` 与 `first-party-models.ts`（仅 Kimi 部分）按真实槽位读取凭据与指纹，绑定沿用逻辑锚点；过期但有刷新令牌返回 `KIMI_OAUTH_REFRESH_REQUIRED`「请在 Kimi 原生终端执行 /usage 后重试」
  - 证据：`vitest run tests/kimi-*.test.ts tests/first-party-*.test.ts` 7 个文件 277 项通过
  - 审查修复：原生缺失或为 0 的 `expires_at` 视为不过期，投影为 `Number.MAX_SAFE_INTEGER`，否则绑定被共享到期判断拒绝；共享 `oauthPrincipal` 未改
  - 证据：`vitest run tests/kimi-*.test.ts tests/first-party-*.test.ts tests/cli-account-binding.test.ts` 8 个文件 365 项通过
- [x] 2.4 MiMo：核对配置路径与未登录提示文字
  - 证据：0.1.17 路径与未登录文字与插件一致；二进制含 `xiaomi-token-plan-cn/ams/sgp`，插件原只读 `xiaomi`
  - 修复：`mimo-configuration.ts` 按原生顺序识别 4 个官方服务商；`first-party-models.ts`（仅 MiMo 部分）Token Plan 走各自集群地址，`xiaomi` 绑定不变
  - 证据：`vitest run tests/first-party-*.test.ts tests/accounts.test.ts` 4 个文件 273 项通过
  - 未执行：无 Token Plan 账号，未做真实登录

## 3. 订阅与续期类：ZCode、Grok Build、Hermes Agent 〔后端｜6h｜前置 1〕
- [x] 3.1 ZCode：订阅账号与自有 API Key，核对 credentials.json 版本与键名
  - 证据：0.17.1 `zcode.cjs` 新增 `enc:v2:os:`、`enc:v2:env:` 与 `account-provider:<id>:auth-source`；未标记但有 OAuth 令牌的记录原生走项目访问令牌流程；本机凭据仍为 `enc:v1:`
  - 修复：新增 `zcode-credentials.ts` 只读解码（v1、v2:env、v2:os 校验来源与指纹，未知格式不当明文，不写不迁移）；OAuth 不再要求旧绑定 Key 确认身份；同一身份已有绑定 Key 时继续用于模型目录与执行
  - 证据：`vitest run tests/*zcode*.test.ts tests/*zcode*.test.tsx tests/cli-account-binding.test.ts` 17 个文件 451 项通过
  - 审查修复：改为按字段延迟解码，无关的旧条目解不开不再拖垮当前账号；必需字段解不开仍判不可用
  - 证据：同一命令 17 个文件 461 项通过
  - 遗留：真实系统凭据库读取未实现（返回不可用）；无绑定 Key 的 OAuth 账号模型目录待原生项目令牌流程支持
- [x] 3.2 Grok Build：核对 auth.json 与续期接口；访问令牌过期后派遣前能续期
  - 2026-11-17 用户决定本版不做真实测试；只有静态核对与模拟测试，真实行为未验证（真实续期未验证）
  - 证据：两端 1.0.77；默认 `~/.grok/auth.json` 结构未变；公开 OIDC discovery 的 `token_endpoint` 支持 refresh_token；续期链路 `grok-models.ts:310` → `grok-renewal.ts:112`；无改动
  - 未执行：真实续期未验证
- [x] 3.3 Hermes Agent：核对共享状态与 Nous 续期；续期失败时提示重新登录
  - 证据：两端 0.23.1；`auth_nous.py:447` 优先匹配主体的嵌套 `renewal`，`auth_oauth_grants.py:413` 按 iat、obtained_at、exp 排序
  - 修复：`hermes-nous-refresh.py` 按原生规则选择状态与排序，锁顺序与即时落盘不变
  - 证据：`vitest run tests/hermes-*.test.ts` 18 个文件 347 项通过；对原生排序函数 576 组合成数据对照一致

## 4. 多服务商类：OMP、Pi、OpenCode 〔后端｜5h｜前置 1〕
- [x] 4.1 OMP：核对账号存储与原生登录方式列表，逐条退出凭据
  - 2026-11-17 用户决定本版不做真实测试；只有静态核对与模拟测试，真实行为未验证（真实逐条退出未验证）
  - 证据：两端 18.20.2；`agent.db` 的 `auth_credentials` 表字段与插件一致；隔离元数据助手退出 0，94 项登录方式；无改动
  - 未执行：真实逐条退出；profile、`PI_CODING_AGENT_DIR` 与 XDG 目录覆盖见设计决定 7
- [x] 4.2 Pi：同 OMP，并核对安装完整性提示
  - 证据：Mac 1.5.2 `checkPiInstallationIntegrity` 通过；隔离元数据助手退出 0，43 项
  - 修复：`pi-omp-native.ts`、`pi-native-catalog.mjs`（新增 `.d.mts`）接受只带 env 的 API 凭据，按凭据私有 env、进程 env 解析模板；`cli-account-binding.ts` Pi/OMP 段使用受保护摘要
  - 证据：`vitest run tests/pi-omp-*.test.ts tests/cli-account-binding.test.ts tests/account-logout.test.ts` 351 项通过、2 项仅 Windows 跳过；对已安装 Pi 解析器 121 组模板对照一致
  - 未执行：AWS profile 的真实模型权限未验证；Windows 上 1.5.2 的核对见 8.5
- [x] 4.3 OpenCode：核对授权档案结构；替换同一服务商 Key 后状态立即正确
  - 证据：两端 1.19.5；`auth.json` 与 XDG 路径一致，未发现新版改路径或结构；无改动
  - 未执行：替换 Key 的真实登录流程

## 5. 原生会话类：Qoder、Qoder CN、CodeBuddy Code、TRAE CN 〔后端｜6h｜前置 1〕
- [x] 5.1 Qoder：核对 SDK daemon 协议与启动参数
  - 证据：两端 1.1.89，与插件一致，无改动
- [x] 5.2 Qoder CN：同 Qoder，国内与国际账号不混用
  - 证据：两端 1.1.89，与插件一致，无改动
- [x] 5.3 CodeBuddy Code：核对 auth.json 结构与站点字段，国内站与国际站
  - 证据：2.184.0 `dist/codebuddy.js` 认证顺序 `CODEBUDDY_AUTH_TOKEN` → `apiKeyHelper` → `CODEBUDDY_API_KEY` → 登录文件；settings 按用户、项目、项目本地合并
  - 修复：`codebuddy-account.ts` 按此顺序判断（只查存在，不执行 helper），读取项目级站点；`accounts.ts` 与 `cli-account-binding.ts` 传入项目目录
  - 证据：CodeBuddy 相关 5 个测试文件 234 项通过
  - 审查修复：新增 `codebuddyEnvironment()`，把登录判断用到的 6 个 CodeBuddy 变量只转发给 CodeBuddy 的目录查询、Worker、版本探测与账号终端子进程；环境凭据摘要计入绑定，无环境凭据时绑定逐字节不变；模型目录查询保留在私有临时目录，不进入用户项目
  - 证据：`vitest run tests/codebuddy-account.test.ts tests/codebuddy-integration.test.ts tests/codebuddy-usage.test.ts tests/native-codebuddy.test.ts tests/cli-management-codebuddy-native.test.ts tests/native-runtime.test.ts` 6 个文件 260 项通过
  - 遗留：产品配置的 `custom-token` 来源未接入；只在项目级 settings 配置的 apiKeyHelper 不进入模型目录查询
- [x] 5.4 TRAE CN：核对授权文件路径、字段与官方 CLI 身份校验
  - 证据：traex 0.215.0 `find_cli_home` 优先非空 `TRAECLI_HOME`；`cli_auth_credentials_store` 支持 keyring/auto，存入钥匙串后删除 `auth.json`
  - 修复：`traecn-accounts.ts` 新增 `traeCliHome` 并透传 `TRAECLI_HOME`；绑定来源改为固定 `trae-cli-auth`
  - 证据：TRAE 相关 6 个测试文件 159 项通过
  - 遗留：钥匙串存储模式未实现读取，见设计决定 7

## 6. 桌面端类：WorkBuddy CN、WorkBuddy 〔后端｜3h｜前置 1〕
- [x] 6.1 WorkBuddy CN：桌面端更新后核对 bootstrap 元数据位置与格式
  - 证据：Mac 5.11.3（CLI 2.176.0）、Windows 5.9.3（CLI 2.165.0）bootstrap 键名未变；原绑定含 CLI 版本与安装路径，更新即被判换号
  - 修复：`workbuddy-metadata.ts` 绑定改为 CLI ID 加规范站点
  - 证据：`vitest run tests/workbuddy-*.test.ts tests/native-workbuddy.test.ts` 7 个文件 176 项通过
  - 未执行：桌面端关闭时的真实表现
- [x] 6.2 WorkBuddy：同 WorkBuddy CN，两版账号不混用
  - 证据：Windows 5.9.4（CLI 2.165.0），两版认证 ID 不同；模拟测试确认两版绑定仍不同
  - 未执行：Mac 未安装国际版

## 7. 发布前验收 〔测试｜4h｜前置 2,3,4,5,6〕
- [x] 7.1 有改动的 CLI 补模拟测试，`corepack pnpm typecheck` 与相关测试通过
  - 证据（2026-11-17）：`corepack pnpm typecheck` 通过；`corepack pnpm exec vitest run` 全量 354 个文件通过、4 个跳过，8461 项通过、14 项跳过；`corepack pnpm build:preview` 通过
  - 证据：Codex 审查（gpt-6-astra）提出 3 个 P2（ZCode 整份解码、Kimi 无到期时间绑定、CodeBuddy 环境凭据未转发），均已修复并补测试
  - 构建修复：`scripts/build.mjs` 把新引用的 `pi-native-catalog.mjs` 加入 `lib/types/host` 复制清单
- [x] 7.2 Windows 隔离测试 `node scripts/windows-remote.mjs` 通过
  - 证据：`--config .test-data/windows-remote/config-d.json` 运行 75aa13d9-aa05-4669-90a9-42057e8815e2 全部阶段通过，Windows 测试 671 项中 667 项通过、4 项跳过，模型调用 0
  - 清单新增 `tests/pi-omp-native.test.ts`、`tests/zcode-account-models.test.ts`、`tests/first-party-account-context.test.ts`、`tests/kimi-accounts.test.ts`（`scripts/windows-remote-common.mjs` 与 `.github/workflows/windows.yml` 同步）
  - 未纳入：`tests/traecn-accounts.test.ts` 在 Windows 有 8 项既有失败（账号终端与退出用例只按 macOS 写，HEAD 即有），本次新增的 TRAE 路径用例在该次运行中通过
  - 过程：C 盘写满导致两次 ENOSPC，按用户要求清理插件与 DSH 残留后改用 D 盘配置
- [x] 7.3 有改动的 CLI 在 Mac 与 Windows 上真实验收：设置页、账号窗口、模型目录、派遣、续聊、退出
  - 2026-11-17 用户决定本版不做真实测试；只有静态核对与模拟测试，真实行为未验证。已有实机记录只覆盖：Mac 与 Windows 设置页连接状态（11-17 全部绿点，见 v0.9.1-cli-update-takeover-switch-leeyl 3.9、3.10）、Windows agy 仅令牌文件登录（用户实测通过）、Mac agy 退出登录失败（用户实测，修复见 v0.9.1-agy-token-file-fallback-leeyl）
- [ ] 7.4 发布后在 GitHub issue #13 回复版本号，请报告者确认

## 8. 遗留项补齐 〔后端｜8h｜前置 3,5〕
- [x] 8.1 ZCode：读取系统凭据库中的 `enc:v2:os:` 密钥（macOS 钥匙串、Windows 凭据管理器）
  - 2026-11-17（Fable）：新增共享只读模块 `src/host/os-credential-store.ts` 与 `windows-credential-read.ps1`，`zcode-credentials.ts` 经它读取 `enc:v2:os:` 的密钥。
    - 依据：ZCode 0.17.1 原生实现为 `@napi-rs/keyring`，服务名 `ZCode Credential Encryption`，账号为凭据文件绝对路径的 sha256。
    - 等待上限 20 秒；读不到时报「无法确认」，不报「未登录」。
  - macOS 拒绝或超时后，该条目在后台路径上不再读取，直到 Host 重启；用户主动打开账号窗口、刷新、派遣或查模型时重试一次。条目不存在不算拒绝。`tests/os-credential-store.test.ts` 36 项模拟测试。
  - 未执行：没有读过任何真实的钥匙串或凭据管理器条目，ps1 未在 Windows 运行过，macOS 授权弹窗未实测。本机 ZCode 凭据全部为 `enc:v1`，不走系统凭据库。
- [x] 8.2 TRAE CN：按 `cli_auth_credentials_store` 读取钥匙串存储的登录，同一账号文件与钥匙串绑定一致
  - 2026-11-17（Fable）：
    - 设置读取 `$TRAE_HOME/traecli.toml` 与项目 `.trae/traecli.toml`，支持 file / keyring / auto / ephemeral 四种模式。
    - keyring 依次读服务 `Codex Auth`、`TRAE CLI Auth`；auto 模式读不到时回退到 `auth.json`，与原生 `AutoAuthStorage::load` 一致。
    - 同一账号的投影与文件模式相同，绑定一致。
  - 未执行：TRAE 的钥匙串账号名（`cli|` 加 CLI 目录 sha256 前 16 位）是根据二进制字符串和上游 Codex 的规则推断的，本机没有钥匙串条目可核对；未读取 `/etc/trae/traecli.toml`、profile 与 `-c` 覆盖。
- [x] 8.3 CodeBuddy：只在项目级 settings 配置的认证也能用于模型目录查询，查询仍不进入用户项目
  - 2026-11-17（Codex gpt-6.1-sol high）：
    - 把项目的 `settings.json` 与 `settings.local.json` 原样复制到私有临时目录（目录 0700，文件 0600），用原生的 `CODEBUDDY_PROJECT_CONFIG_DIR` 指向副本。
    - 命令行参数里没有密钥；查询结束（成功、失败或取消）后删除副本；项目配置变化时模型缓存失效。
    - 依据：CodeBuddy 2.184.0 的 `getProjectHomeDir()` 支持绝对路径覆盖，合并顺序为用户、项目、项目本地。
    - 相关 6 个测试文件共 271 项通过，typecheck 通过。
  - 未执行：相对路径的 apiKeyHelper 会按临时目录解析，依赖项目目录的 helper 不支持；Windows 与真实账号未测。
- [x] 8.4 Codex：同一账号在文件与钥匙串存储之间切换绑定一致，文件模式既有绑定不变
  - 2026-11-17：Codex gpt-6-astra high 核对 rust-v0.169.0 后确认，官方 RPC 拿不到 id_token，而 `getAuthStatus` 可能刷新令牌，所以不改 RPC 方案。之后由 Fable 实现 `src/host/codex-auth-store.ts`：
    - 直存后端：服务 `Codex Auth`，账号 `cli|` 加 `CODEX_HOME` sha256 前 16 位。
    - secrets 后端：`secrets/codex_auth.age`，scrypt 解密，口令在钥匙串服务 `codex`；已用 C2SP 公开测试向量核对。
    - 取得完整的 AuthDotJson 后复用文件模式的投影；冻结的文件模式哈希不变；移除 `getAuthStatus(includeToken)` 的绑定路径。
    - `tests/cli-account-binding.test.ts` 改为跨模式相等、auto 读取顺序和读不到时报错等模拟测试。
  - 未执行：未读取真实钥匙串；Windows 规范路径（`\\?\C:\…`）的摘要形式未核实；每次 secrets 读取在 Windows 上约耗时 1 秒（scrypt 工作因子 18）。
- [x] 8.5 Windows 核对插件所用 Pi 1.5.2（npm 全局包）的安装完整性、登录方式列表与账号读取；确认插件不会误用 PATH 上的旧托管安装 1.1.0
  - 2026-11-17（Codex gpt-6.1-sol high，SSH，未调用模型）：
    - 记录的 npm 入口与规范化后的 `dist\cli.js` 执行 `--version` 都输出 1.5.2，退出码 0。
    - `checkPiInstallationIntegrity` 通过；登录方式列表 43 项；插件账号文件为 deepseek api_key，可读（未输出值）。
    - 账号终端与 Worker 都用记录的路径启动，不按名字在 PATH 上找 `pi`（`adapters.ts:469`、`accounts.ts:1037`、`pi-omp-accounts.ts:190`）。
    - 托管 1.1.0 与路径记录的哈希前后不变。
  - 重复安装的成因与修复转入变更 `v0.9.1-cli-update-in-place-leeyl`。

## 跟进

- 每个 CLI 的结论统一写在对应子任务的证据里：版本、登录来源、Mac 与 Windows 结果；无账号或订阅的写「未执行：原因」。
