## 1. 调研与 OpenSpec

- [x] 1.1 本机探测 CodeBuddy 2.181.0 的 ACP 握手、`session/new` 目录、配置项、模式、审批、拒绝、续聊与停止（模型 `hy4free`，临时目录）
  - 2026-11-07 探测脚本在会话 scratchpad，结论写入 proposal 调研表与 `doc/codebuddy-protocol.md`
- [x] 1.2 创建 `openspec/changes/add-codebuddy-cli/`（proposal、specs、design、tasks）
- [x] 1.3 `pnpm spec validate add-codebuddy-cli --strict` 与 `pnpm spec:check`
  - 2026-11-07 注册分工：`corepack pnpm spec validate add-codebuddy-cli --strict --no-interactive` 通过；`corepack pnpm spec:check` 的脚本内裸 `pnpm` 在当前 PATH 不存在，改用等价 `corepack pnpm spec validate --all --strict --no-interactive`，57/57 通过。未归档整个变更。
  - 最后复核时并行账号规格已更新：`codebuddy-cli/spec.md` 的「CodeBuddy 账号与站点」Requirement 超过 500 字，严格模式告警；变更级校验失败，全量变为 56 通过、1 失败。注册分工未修改该规格正文，撤回本项勾选，待负责账号规格的分工处理。
  - 协调复核：将账号要求拆为「CodeBuddy 账号与站点」与「CodeBuddy 站点只读识别」两条后，变更级严格校验通过，全量 57/57 通过。

## 2. 注册身份与能力声明

- [x] 2.1 `src/shared/types.ts`：`CLI_IDS`、`CLI_LABELS`（CodeBuddy Code）、`CLI_SHORT_NAMES`（codebuddy）
- [x] 2.2 `src/shared/worker-permissions.ts`：三档文案、规划模式支持
- [x] 2.3 `src/shared/conversation-features.ts`：不支持分支及理由、`expectedTransport`
- [x] 2.4 `src/shared/account-links.ts`：登录域名、`SINGLE_ACCOUNT_CLIS`
- [x] 2.5 `src/host/routing.ts`：中英文别名
- [x] 2.6 `src/host/index.ts`、`src/host/process.ts`：`codebuddyExecutable` 配置
- [x] 2.7 `src/host/native-worker.ts`、`src/host/native-bridge.mjs`：`codebuddy-acp-v1` 与 runner 映射
- [x] 2.8 `native-attachments.mjs`、`native-harness-injection.mjs`、`cli-native-capabilities.mjs`：附件、工具桥传输、能力类别与 skill 目录
  - 注册分工：附件、ACP `mcpServers`、CodeBuddy 工具名元数据候选、原生工具类别与 `.codebuddy/skills` 路径已注册；执行就绪仍为 false，未加入 steering、fork 或 Qoder 专用逻辑。模拟集成测试已核对。
- [x] 2.9 `scripts/build.mjs`：`native-codebuddy.mjs`、`codebuddy-catalog.mjs` 进入运行资源清单

## 3. 发现与启动

- [x] 3.1 `src/host/adapters.ts`：可执行文件解析、`catalogFor`、`workerArguments`（`[codebuddy, --acp]`，规划与权限交给 runner）
- [x] 3.2 `src/host/windows-cli-installation.ts`：Windows npm 入口线索
  - 注册分工：固定 npm shim 候选、`@tencent-ai/codebuddy-code` 包身份校验及专用缺失错误；合成 Windows 安装夹具通过，未在真实 Windows 运行。
- [x] 3.3 运行环境追加 `DISABLE_AUTOUPDATER=1`（运行、目录、账号终端）
  - 注册分工已完成 runtime.ts 两处原生运行环境的 CodeBuddy 专用 `DISABLE_AUTOUPDATER=1`；模拟 CodeBuddy 规划轮、Antigravity 与 Qoder 对照通过。目录与账号终端由并行分工维护，本项保留待整体验收。
  - 协调复核：目录脚本（`codebuddy-catalog.mjs`）、账号终端（`accounts.ts`）与 runner（`runNativeCodebuddy`）均带该变量；真实验收前后 `codebuddy --version` 保持 2.181.0。

## 4. 账号、站点与绑定

- [x] 4.1 `src/host/codebuddy-account.ts`：认证文件路径、登录状态（只看文件与退出标记）、站点、绑定材料、单次授权目录快照
  - 用户授权（2026-11-07，经协调会话转达，原话“允许只读站点”）：只在内存中解析认证文件，只取 `auth.domain` 映射为中国站、国际站、企业域或 iOA；解析后不保留整份对象，令牌等字段不读出、不传递；不写日志、事件、持久化或测试快照；解析失败显示“站点未公开”，错误信息不带文件内容；测试用标注为模拟的夹具；`settings.json` 与环境变量中显式设置的 `CODEBUDDY_INTERNET_ENVIRONMENT` 优先；站点变化让旧模型目录与偏好失效
  - 实现：`settings.json` 只投影两个 `env` 键 → 进程环境 → 认证文件只投影 `auth.domain`；文件以 `O_NOFOLLOW` 打开、限 1 MiB，解析异常一律吞掉不外传，读后清零缓冲；域名表优先读包内 `product.json`，失败回退 2.181.0 内置表；绑定 principal 只含站点 ID 与目录摘要
  - 真实核对（2026-11-07）：本机账号 `readCodebuddyAccount` 返回 `已登录 · 中国站`；脚本只打印返回值，未打印域名或文件内容
- [x] 4.2 `src/host/accounts.ts`：状态、动作说明、原生终端参数
- [x] 4.3 `src/host/cli-account-binding.ts`、`src/host/authorized-catalog.ts`：绑定与快照接入

## 5. 模型目录与强度

- [x] 5.1 `src/host/codebuddy-catalog.mjs` 与 `parseCodebuddyModels`：`effortOptions`、积分倍率、同名区分

## 6–8. runner、审批与拒绝结束

- [x] 6.1 `src/host/native-codebuddy.mjs`：argv、身份校验、模式映射、强度、会话级选项、工具名、拒绝结束判定
- [x] 6.2 共享 `native-acp.mjs` 可选行为：`verifyInitialize`、`defaultEffort`、`approvalFromToolCall`、`deniedCancelEndsTurn`（默认关闭）

## 9. 遥测、图标、设置页

- [x] 9.1 `src/host/telemetry.ts`：`usage_update` 上下文统计
  - 注册分工：`session/update usage_update` 只读取同会话 used/size；原始记录经 TelemetryReader 白名单缓存前后均通过测试；不接入 Grok totalTokens 回退、每轮 token 或积分回执。
- [x] 9.2 图标素材 `doc/assets/cli-icons/v5-codebuddy/`、`src/client/assets/codebuddy.png`、`icons.tsx`
  - 提交 a121e89；官方 npm 包内 `vendor/assets/icon.png`，150×150 RGBA，sha256 记录于 manifest
- [ ] 9.3 设置页与 i18n：连接页条目、账号区站点显示、新文案
  - 注册分工仅补齐英文词典（自动审批、fork、安装错误、上下文来源、站点摘要、登录提示与拒绝结束说明）；`tests/client-i18n.test.tsx` 19/19 通过。未修改设置页布局或 icons.tsx，本项保留给完整 UI 分工。
  - 协调复核：设置页按 `CLI_IDS` 通用渲染，账号区摘要直接显示站点（`已登录 · 中国站`）；Client 中只有 Qoder 积分显示是特例，CodeBuddy 无每轮积分，不需要。Desktop 界面未实机查看，本项保持未勾选。

## 10. 自动化测试

- [x] 10.1 `tests/native-codebuddy.test.ts`（模拟夹具）：握手与身份、目录与强度、模式映射与降级、规划、审批允许与拒绝、拒绝即结束、停止、恢复与重放、缺终态
- [x] 10.2 `tests/codebuddy-account.test.ts`：登录状态、退出标记、站点声明、绑定随目录变化、不读认证文件内容
- [x] 10.3 `tests/codebuddy-integration.test.ts`：注册、别名、权限档位、transport、构建清单
  - 2026-11-07：新增合成集成测试 17/17 通过；覆盖身份与别名、cbc 独占、权限/规划/fork/附件、ACP 工具桥、skills、打包资源、专用运行环境、原始与缓存上下文遥测。不运行真实 CodeBuddy。
- [x] 10.4 共享 runner 回归：`tests/native-qoder.test.ts` 等 ACP 测试保持通过
  - 2026-11-07 协调复核：`corepack pnpm vitest run` codebuddy-integration、codebuddy-account、native-codebuddy、native-acp、native-qoder、qodercn-integration、qoder-routing、worker-permissions、windows-cli-installation、cli-account-binding、windows-accounts、native-runtime：12 文件 474/474 通过
- [x] 10.5 `pnpm typecheck`、相关 vitest、`pnpm build:preview`
  - 注册分工验证：`corepack pnpm vitest run tests/codebuddy-integration.test.ts tests/worker-permissions.test.ts tests/qoder-routing.test.ts tests/qodercn-integration.test.ts tests/native-harness-tools.test.ts tests/windows-cli-installation.test.ts`：6 文件、176/176 通过。工具桥测试在沙箱内 listen EPERM，经获准环境重跑通过。
  - 其余清单相关及已修改测试：`corepack pnpm vitest run tests/native-runtime.test.ts tests/cli-settings.test.ts tests/settings-dialog.test.tsx tests/cli-account-binding.test.ts tests/harness-reasoning-records.test.tsx tests/cli-executable-paths.test.ts tests/authorized-catalog.test.ts tests/settings-display-cache.test.ts tests/panel.test.tsx tests/windows-accounts.test.ts tests/storage.test.ts tests/dispatch-storage.test.ts tests/worker-management.test.ts tests/worker-goals.test.ts tests/runtime-account-isolation.test.ts tests/running-message-settings.test.ts tests/routing.test.ts tests/client-i18n.test.tsx`：18 文件、938/938 通过；另跑 `corepack pnpm vitest run tests/extended-integration.test.ts`，1 文件、15/15 通过。仅为新增 CLI 补齐两个合成账号夹具，不跳过测试。
  - `corepack pnpm build:preview` 通过，核对 `.cache/preview-package/lib/native-codebuddy.mjs` 与 `codebuddy-catalog.mjs` 均存在；在 `.cache/preview-package` 执行 `corepack pnpm typecheck`，Host/Client 均通过（DSH 0.2.2-rc.1）。未正式 build、未更新 Desktop 链接。
  - 原工作树 `corepack pnpm typecheck`：Host 通过；Client 因缺生成的 `dsh-cliworker-now/remote` 声明失败。错误位置：index.tsx:11 TS2307、index.tsx:72 TS2339、native-cli-model-directory.ts:85/123 TS7006、settings-dialog.tsx:247/248 TS2345、worker-model-menu.tsx:72/80 TS7006、workers.ts:10/12 TS2339。未将隔离包检查等同于原工作树检查通过。
  - 协调复核：`build:preview` 后在 `.cache/preview-package` 执行 `corepack pnpm typecheck`：Host/Client 通过（DSH 0.2.2-rc.1）；预览包含 `native-codebuddy.mjs`、`codebuddy-catalog.mjs` 及其依赖 `native-spawn.mjs`、`native-launch.mjs`。原工作树 Client 的 10 项错误全部源于工作树缺少生成的 `dsh-cliworker-now/remote` 声明，与本变更无关，记为环境限制。
  - `git diff --check` 通过；本轮未运行真实 CodeBuddy、登录、模型或真实 Windows/Desktop 验收，未联网查询、提交 Git 或增版。

## 11. 真实验收（macOS，`hy4free`，临时目录）

验收方式：scratchpad 下 `accept/run.mjs` 直接调用插件 `createNativeIO` + `runNativeCodebuddy`，CLI 为 `/opt/homebrew/bin/codebuddy --acp`（2.181.0，`DISABLE_AUTOUPDATER=1`），模型 `hy4free`，强度默认（原生 `thought_level=enabled`），询问档（原生 `mode=default`），项目为 scratchpad 临时目录；审批由脚本代答。未经 Desktop UI。

- [x] 11.1 读文件、写文件（产物核对）
  - 2026-11-07 a1：Read 不询问；Write 发起 1 次审批，提问卡 `kind=file`、标题 `Write <路径>`（取自先前 `tool_call`），允许一次后 `out.txt` 内容为 `lantern`，与 `input.txt` 一致；`stopReason=end_turn`，结果 SUCCESS，会话 `01a1b5ca-d141-…`
- [x] 11.2 命令审批：允许一次、拒绝一次（拒绝即结束本轮的显示与产物）
  - a2 允许：提问卡 `kind=command`、`echo hi > cmd.txt`、`allowSession=true`；`cmd.txt` 内容 `hi`；结果 SUCCESS
  - a3 拒绝：`touch denied.txt` 被拒后原生 `stopReason=cancelled`、`codebuddy.ai/outcome=PERMISSION_DENIED`；插件补发该工具 `FAILED / 已拒绝`，结果 ERROR，原因“因拒绝审批而结束：你拒绝了 CodeBuddy 的授权请求，被拒操作未执行；可在此 Worker 续聊继续，不要自动重试”；目录中无 `denied.txt`
- [x] 11.3 同会话续聊
  - a2 以 `session/load` 续接 a1 会话，未重读文件即答出 `lantern`；重放历史未作为新正文输出
  - a4 拒绝之后再续聊：结果 SUCCESS，回复 `still-here` 并说明上一轮命令未执行
- [x] 11.4 运行中停止（进程退出核对）
  - a5：6 秒后中止，约 1.1 秒内原生返回 `stopReason=cancelled`、outcome `CANCELLED`；`io.close` 正常，验收前后 `pgrep -f "codebuddy --acp"` 均为 0。runner 结果为 ERROR“CLI 未成功完成（cancelled）”，与其他 ACP CLI 停止时的共享行为一致（停止状态由 Host 判定）；拒绝结束判定未误触发
- [x] 11.6 真实模型目录：`codebuddy-catalog.mjs` 对本机账号退出码 0，17 个模型；`hy4free` 为 `x0.00 credits`、强度 `[high]`，`hy3` 强度 `[low, medium, high, xhigh]`；临时目录为空、无残留进程
- [ ] 11.5 国际站、企业域、iOA、Windows：未执行，保持未验证
- [ ] 11.7 Desktop 实机（设置页条目、账号窗口、Worker 子会话中的审批卡与“因拒绝审批而结束”显示）：未执行，保持未验证
- 附注：验收与早期探测在 `~/.codebuddy/projects/` 下留下了以 scratchpad 路径命名的原生会话目录（CodeBuddy 自身持久化，未删除用户数据）

## 12. 文档

- [x] 12.1 `doc/codebuddy-protocol.md`
- [x] 12.2 README、README.en、AGENTS.md、usage-details（中英）、design.md

## 共享改动（供合并处理冲突）

- 共享 runner `src/host/native-acp.mjs`：新增 4 个 runner 设置 `verifyInitialize`、`defaultEffort`、`approvalFromToolCall`、`deniedCancelEndsTurn`，均默认关闭；Qoder/Kimi/Grok 等 ACP 测试保持通过
- `src/host/adapters.ts`：`executableFor`、`catalogFor`、`workerArguments` 的 codebuddy 分支；macOS 默认路径回退；`captureCatalogMetadata` 失败时在原错误上附加 `exitCode`（文案不变）
- `src/host/accounts.ts`、`cli-account-binding.ts`、`authorized-catalog.ts`：codebuddy 分支与单次授权快照
- `src/client/icons.tsx`：追加 `codebuddy` 图标与光学参数
- 注册分工修改：共享 types / worker-permissions / conversation-features / account-links；Host routing / index / process / native-worker / native-bridge / native-attachments / native-harness-injection / cli-native-capabilities / runtime / windows-cli-installation / telemetry；构建 scripts/build.mjs；Client i18n-messages；测试 codebuddy-integration / native-runtime / worker-permissions / windows-cli-installation / cli-account-binding / windows-accounts。其余并行分工文件未由注册分工编辑。
