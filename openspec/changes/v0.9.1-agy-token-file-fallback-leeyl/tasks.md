# Tasks

## 1. 定位根因 〔后端｜2h〕
- [x] 1.1 对照 issue #13 截图与设置页状态来源
  - 设置页「未登录」= Host 账号状态 `unconfigured`（`settings-dialog.tsx` `connectionStatus`）；Windows 状态来自 `windows-agy-account.ps1`，`CredRead("gemini:antigravity")` 返回 1168 时投影为 `unconfigured`
  - 「Antigravity 无法确认当前自身账号」来自 `cli-account-binding.ts` 绑定失败；账号窗口「当前已登录」来自 agy 画面识别，说明 agy 自己有有效登录
- [x] 1.2 核对 agy 1.5.9 的存储行为（Mac `~/.local/bin/agy` 与 Windows 测试机同为 1.5.9）
  - 符号 `codeassistclient.(*compositeTokenStorage)`（`LoadStoredToken`、`peekKeyringStoredToken`、`fallbackSaveTokenToFile`）
  - 文本：`Failed to load token from keyring, falling back to file`、`Using file-based token storage because a keyring timeout was recorded within the last %v`、`Keyring %s failed (%v); using file-based token storage for writes for the rest of this process`、`Failed to clear stale keyring credential after file fallback`、`failed to remove token from both keyring (%v) and file (%v)`
  - 本机钥匙串条目字段为 `token`、`auth_method`、`id_token_email`、`writer_id`（只读键名，未输出值）
  - Windows 测试机经 SSH 看不到凭据管理器（非交互登录），`%USERPROFILE%\.gemini` 下没有令牌文件；交互桌面计划任务本次未能运行，未取得凭据管理器结果

## 2. 实现修复 〔后端｜2h｜前置 1〕
- [x] 2.1 `account-identity.ts`：抽出 `readAgyTokenFile`（有界、不跟随链接、读后比对）与 `agyTokenFile`，`localAccountIdentity` 改用它，行为不变
  - 证据：`src/host/account-identity.ts` 的 `readAgyTokenFile`；`tests/account-identity.test.ts` 原有项通过
- [x] 2.2 `agy-windows-account.ts`：凭据管理器投影为 `unconfigured`／`unavailable` 时读令牌文件；新增 `projectAgyCredential`，主体摘要与帮助脚本同算法；无项且文件损坏时为 `unavailable`
  - 证据：`src/host/agy-windows-account.ts` 的 `readNativeWindowsAgyAccount`、`windowsAgyAccountFromFile`、`projectAgyCredential`；测试见 3.1
- [x] 2.3 `agy-macos-account.ts`：新增 `readMacAgyLogin`，初版在钥匙串无项或 `MacAgyKeychainError` 时读令牌文件（无项回退已由 5.2 修正）；进程清理失败照常抛出；状态与绑定都改用它
  - 证据：`src/host/agy-macos-account.ts` 的 `readMacAgyLogin`；测试见 3.2
- [x] 2.4 `cli-account-binding.ts`：macOS 改用 `readMacAgyLogin`；Windows 来源标识保持 `windows-credential:gemini:antigravity`
  - 证据：`src/host/cli-account-binding.ts` Antigravity 分支；测试见 3.2 的绑定一致项
- [x] 2.5 Windows 测试清单（`scripts/windows-remote-common.mjs`、`.github/workflows/windows.yml`）加入 `tests/agy-windows-account.test.ts`
  - 证据：两处清单各出现 1 次；`tests/windows-remote.test.ts` 28 项通过

## 3. 模拟回归测试 〔测试｜1h｜前置 2〕
- [x] 3.1 `tests/agy-windows-account.test.ts` 新增 6 项（合成凭据与临时 home）
  - 凭据管理器 `unconfigured`／`unavailable` 时读文件得已登录与邮箱、不含令牌；凭据管理器有登录或已过期时不看文件；两处皆无为未登录、文件损坏为 `unavailable`；文件主体摘要与帮助脚本一致、非 Google 签发不出摘要；仅文件登录时模型目录可用
  - 该文件改为模拟 `homedir`，不再读开发者真实 `~/.gemini`
- [x] 3.2 `tests/agy-macos-account.test.ts`：初版把旧断言「无项不读旧文件」改为回退（已由第 5 节修正）；新增无项／钥匙串不可读时读文件、钥匙串优先、同一登录在钥匙串与文件间绑定不变、文件损坏仍报钥匙串不可读
  - 证据：同 3.4 的相关测试运行
- [x] 3.3 `tests/cli-account-binding.test.ts` 的 macOS mock 改为 `readMacAgyLogin`
  - 证据：同 3.4；`cli-account-binding.test.ts` 全部通过
- [x] 3.4 Mac 验证
  - 证据：`corepack pnpm exec vitest run` 相关 7 个文件 170 项通过；账号与 agy 原生回归 5 个文件 226 项通过；`tests/windows-remote.test.ts` 28 项通过
  - 证据：`corepack pnpm typecheck` 通过（against DSH 0.2.2-rc.3）
- [x] 3.5 Windows 隔离测试 `node scripts/windows-remote.mjs`
  - 证据：运行 `46628922-269b-4367-bdfa-24caae7e02a4`（win32，Node v24.15.0）：install、typecheck、windows-tests、mac-package-host-load 等 9 个阶段退出码均为 0；Windows 测试 480 项（476 通过、4 跳过、0 失败）；`tests/agy-windows-account.test.ts` 24 项全部通过
  - 首次运行因测试机残留 11-15 的 `run.lock`（记录的 PID 48844 已不存在）失败，确认无进程后删除该锁重跑

## 4. 实机验证 〔测试｜1h｜前置 3〕
- [x] 4.1 Windows 上凭据管理器无项、仅令牌文件的真实 agy 登录：设置页显示已登录、模型可选（需要能复现 agy 回退到文件的环境，或报告者确认）
  - 2026-11-17 用户在 Windows 实机测试并确认全部通过（用户口头确认，未附截图或日志；测试时的插件构建与 agy 版本未记录）
- [x] 4.2 「凭据库无项时 agy 自己也读文件」的真实确认（1.5.10 组合存储已有静态分支证据，但真实 CLI 调用路径与 macOS 仅文件登录尚待确认，见 design）
  - 2026-11-17 用户在 Windows 实机测试并确认全部通过（用户口头确认，未附截图或日志；测试时的插件构建与 agy 版本未记录）

## 5. macOS 退出回归修复 〔后端｜2h｜前置 2〕
- [x] 5.1 核对只读状态、二进制存储分支与退出重读链路
  - 根因：macOS 把钥匙串缺失与读取失败合并，旧文件恢复 authenticated，专用 `AgyAccountGuide.proves` 要求 unconfigured 而失败；绑定同用 `readMacAgyLogin`。`accounts.ts` 的识别、发命令后、轮询及终端退出重读均走同一 identity。
  - 只读：钥匙串退出码 44；令牌文件存在、559 字节、mtime 2026-11-05 20:29:27 +08:00，仅取元数据；本机 agy 1.5.10。未读令牌内容、未用 security -w/-g；静态函数地址及二进制摘要见 design.md。
  - 1.5.10 组合存储有文件读取及清除分支，可保留不含 token 的元数据；不等于真实 `/logout` 已验收，撤回此前「1.5.x 两处文件都删」推断。
- [x] 5.2 修复状态及绑定共用读取，并同步规格与用户文档
  - 改动：`src/host/agy-macos-account.ts` 仅 MacAgyKeychainError 回退文件，明确缺失直接返回；Windows 代码和测试保持原样，不增加凭据删除或时间戳。`README.md`、`doc/design.md`、本变更 proposal/design/specs/tasks 同步决策及识别限制。
  - 测试改动：`tests/agy-macos-account.test.ts` 使用合成钥匙串、临时 HOME；`confirms native macOS logout with a missing keychain item and a %s stale file (simulated)` 两项同时核对状态、专用退出确认、绑定拒绝及文件原样保留；保留不可读回退、优先级、绑定一致，并增加模拟超时、取消及清理未确认测试。
- [x] 5.3 运行关联测试、类型检查、完整 Vitest 与严格规格校验
  - 关联测试：`corepack pnpm exec vitest run tests/agy-macos-account.test.ts tests/agy-windows-account.test.ts tests/cli-account-binding.test.ts tests/agy-account-guide.test.ts tests/accounts.test.ts tests/account-identity.test.ts tests/os-credential-store.test.ts`，7 文件 347 项通过。
  - `corepack pnpm typecheck` 通过（DSH 0.2.2-rc.3）；`corepack pnpm spec validate --all --strict` 40/40 通过；`git diff --check` 通过。
  - 最终 `corepack pnpm exec vitest run`：361 文件通过、4 文件跳过；8819 项通过、15 项跳过、0 失败（总计 8834，124.28 秒）；日志 `/tmp/agy-logout-vitest-full-unrestricted.log`。全部为自动测试，不代表真实账号或 Desktop 验收。
  - 首次沙箱内全量：341 文件通过、20 失败、4 跳过；8430 项通过、389 失败、15 跳过，另 20 个错误。单独复现环回 registry `listen EPERM 127.0.0.1` 后获准在沙箱外重跑；日志 `/tmp/agy-logout-vitest-full.log`。诊断额外运行 `pi-omp-native.test.ts` 33/33 通过。
  - 首次沙箱外全量正遇另一 agent 提交 `3b62780` 的 Grok 签名修改：8818 通过、1 失败、15 跳过（签名测试已读到新用例，但源码报错文本仍是旧版），日志 `/tmp/agy-logout-vitest-full-concurrent-edit.log`；当前 `cli-management-task4-native.test.ts` 单独 29/29 通过，随后完整复跑得到上述 0 失败结果。本次未编辑 Grok 文件。下载预算测试没有触发需重跑的失败。
- [x] 5.4 用户重新构建后在真实 Mac Desktop 复测退出及状态刷新
  - 2026-11-17 Mac Desktop 部署 6f2a095 正式构建（`build:preview` 与 `build` 通过，重启前 Host 无子进程），用户实测 Antigravity「退出登录」成功（用户口头确认，未附截图）。仅文件有效、钥匙串恢复可读这一情形仍未实测，见下一行。
  - （未执行：按任务约束不运行真实登录/退出、账号切换、模型，不重启或更新 Desktop；等待用户复测。）同时确认仅文件有效、钥匙串恢复可读的实际原生行为；本轮不宣称该情形已兼容。不归档隐藏该缺口。

## 6. Linux 读取 agy CLI 文件存储 〔后端｜2h〕
- [x] 6.1 核对报告者的 Linux 证据与 agy 存储位置
  - 2026-11-17 报告者在 issue #13 补充：「我是linux系统，/.gemini/antigravity-cli路径有antigravity-oauth-token文件」；关闭登录弹窗时显示「正在关闭终端…」属正常提示。
  - 插件原先在 Linux 只读 `~/.gemini/jetski-standalone-oauth-token`（`account-identity.ts` 状态与模型目录、`cli-account-binding.ts` 绑定），读不到新位置。
  - 本机 agy 1.5.10 二进制只读核对：含 `auth.cliFileTokenStorage`、`auth.CLITokenFilePath`、独立 `-oauth-token` 常量；旧 `jetski-standalone-oauth-token` 在 `codeassistclient` 包。未下载 Linux 版二进制，新旧并存时 agy 自身的优先顺序未证实（见 design 决定 6）。
- [x] 6.2 实现 Linux 读取顺序：CLI 文件存储优先，缺失时读旧文件；CLI 文件损坏或是链接时报告读取失败
  - `src/host/account-identity.ts` 新增 `agyCliTokenFile`、`readLinuxAgyTokenFile`，`readAgyTokenFile` 增加路径参数（默认仍为旧文件，macOS、Windows 调用不变）；`localAccountIdentity`（仅 Linux 使用）改走新顺序。`src/host/cli-account-binding.ts` Linux 分支改用 `readLinuxAgyTokenFile`，来源标识仍为 `~/.gemini`；两处都没有时与 macOS 一致报未登录。
  - 规格增量新增「Linux Antigravity 按 CLI 文件存储读取登录」；proposal、design 决定 6 与 `doc/design.md` 同步。README 未改（README 支持平台只列 macOS/Windows）。
- [x] 6.3 模拟测试与关联回归
  - `tests/account-identity.test.ts` 新增 4 项（只有 CLI 文件、两处并存以 CLI 文件为准与缺失回退、CLI 文件损坏或链接不改读旧文件、链接目录拒绝）；`tests/cli-account-binding.test.ts` 新增 1 项（模拟 linux 平台：CLI 文件绑定、轮换稳定、旧文件不影响、CLI 文件删除后按旧文件、两处都无时拒绝）。
  - `corepack pnpm exec vitest run` agy 关联 9 个文件（cli-account-binding、account-identity、agy-macos-account、agy-windows-account、agy-models、agy-account-guide、accounts、authorized-catalog-windows-agy、windows-accounts）：371 项全部通过；`corepack pnpm typecheck` 通过。
- [ ] 6.4 Linux 实机确认（无 Linux 环境；发布后请 issue #13 报告者确认）

## 跟进

- issue 截图 3：关闭账号终端时停在「正在关闭终端…」，设置页提示「此 CLI 已有账号终端，请先关闭后重试」，未复现，未处理。
