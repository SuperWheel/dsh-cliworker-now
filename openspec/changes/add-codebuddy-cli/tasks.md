## 1. 调研与 OpenSpec

- [x] 1.1 本机探测 CodeBuddy 2.181.0 的 ACP 握手、`session/new` 目录、配置项、模式、审批、拒绝、续聊与停止（模型 `hy4free`，临时目录）
  - 2026-11-07 探测脚本在会话 scratchpad，结论写入 proposal 调研表与 `doc/codebuddy-protocol.md`
- [x] 1.2 创建 `openspec/changes/add-codebuddy-cli/`（proposal、specs、design、tasks）
- [ ] 1.3 `pnpm spec validate add-codebuddy-cli --strict` 与 `pnpm spec:check`
  - 2026-11-07 注册分工：`corepack pnpm spec validate add-codebuddy-cli --strict --no-interactive` 通过；`corepack pnpm spec:check` 的脚本内裸 `pnpm` 在当前 PATH 不存在，改用等价 `corepack pnpm spec validate --all --strict --no-interactive`，57/57 通过。未归档整个变更。
  - 最后复核时并行账号规格已更新：`codebuddy-cli/spec.md` 的「CodeBuddy 账号与站点」Requirement 超过 500 字，严格模式告警；变更级校验失败，全量变为 56 通过、1 失败。注册分工未修改该规格正文，撤回本项勾选，待负责账号规格的分工处理。

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

- [ ] 3.1 `src/host/adapters.ts`：可执行文件解析、`catalogFor`、`workerArguments`（`[codebuddy, --acp]`，规划与权限交给 runner）
- [x] 3.2 `src/host/windows-cli-installation.ts`：Windows npm 入口线索
  - 注册分工：固定 npm shim 候选、`@tencent-ai/codebuddy-code` 包身份校验及专用缺失错误；合成 Windows 安装夹具通过，未在真实 Windows 运行。
- [ ] 3.3 运行环境追加 `DISABLE_AUTOUPDATER=1`（运行、目录、账号终端）
  - 注册分工已完成 runtime.ts 两处原生运行环境的 CodeBuddy 专用 `DISABLE_AUTOUPDATER=1`；模拟 CodeBuddy 规划轮、Antigravity 与 Qoder 对照通过。目录与账号终端由并行分工维护，本项保留待整体验收。

## 4. 账号、站点与绑定

- [ ] 4.1 `src/host/codebuddy-account.ts`：认证文件路径、登录状态（只看文件与退出标记）、站点、绑定材料、单次授权目录快照
  - 用户授权（2026-11-07，经协调会话转达，原话“允许只读站点”）：只在内存中解析认证文件，只取 `auth.domain` 映射为中国站、国际站、企业域或 iOA；解析后不保留整份对象，令牌等字段不读出、不传递；不写日志、事件、持久化或测试快照；解析失败显示“站点未公开”，错误信息不带文件内容；测试用标注为模拟的夹具；`settings.json` 与环境变量中显式设置的 `CODEBUDDY_INTERNET_ENVIRONMENT` 优先；站点变化让旧模型目录与偏好失效
- [ ] 4.2 `src/host/accounts.ts`：状态、动作说明、原生终端参数
- [ ] 4.3 `src/host/cli-account-binding.ts`、`src/host/authorized-catalog.ts`：绑定与快照接入

## 5. 模型目录与强度

- [ ] 5.1 `src/host/codebuddy-catalog.mjs` 与 `parseCodebuddyModels`：`effortOptions`、积分倍率、同名区分

## 6–8. runner、审批与拒绝结束

- [ ] 6.1 `src/host/native-codebuddy.mjs`：argv、身份校验、模式映射、强度、会话级选项、工具名、拒绝结束判定
- [ ] 6.2 共享 `native-acp.mjs` 可选行为：`verifyInitialize`、`defaultEffort`、`approvalFromToolCall`、`deniedTurnEnd`（默认关闭）

## 9. 遥测、图标、设置页

- [x] 9.1 `src/host/telemetry.ts`：`usage_update` 上下文统计
  - 注册分工：`session/update usage_update` 只读取同会话 used/size；原始记录经 TelemetryReader 白名单缓存前后均通过测试；不接入 Grok totalTokens 回退、每轮 token 或积分回执。
- [ ] 9.2 图标素材 `doc/assets/cli-icons/v5-codebuddy/`、`src/client/assets/codebuddy.png`、`icons.tsx`
- [ ] 9.3 设置页与 i18n：连接页条目、账号区站点显示、新文案
  - 注册分工仅补齐英文词典（自动审批、fork、安装错误、上下文来源、站点摘要、登录提示与拒绝结束说明）；`tests/client-i18n.test.tsx` 19/19 通过。未修改设置页布局或 icons.tsx，本项保留给完整 UI 分工。

## 10. 自动化测试

- [ ] 10.1 `tests/native-codebuddy.test.ts`（模拟夹具）：握手与身份、目录与强度、模式映射与降级、规划、审批允许与拒绝、拒绝即结束、停止、恢复与重放、缺终态
- [ ] 10.2 `tests/codebuddy-account.test.ts`：登录状态、退出标记、站点声明、绑定随目录变化、不读认证文件内容
- [x] 10.3 `tests/codebuddy-integration.test.ts`：注册、别名、权限档位、transport、构建清单
  - 2026-11-07：新增合成集成测试 17/17 通过；覆盖身份与别名、cbc 独占、权限/规划/fork/附件、ACP 工具桥、skills、打包资源、专用运行环境、原始与缓存上下文遥测。不运行真实 CodeBuddy。
- [ ] 10.4 共享 runner 回归：`tests/native-qoder.test.ts` 等 ACP 测试保持通过
- [ ] 10.5 `pnpm typecheck`、相关 vitest、`pnpm build:preview`
  - 注册分工验证：`corepack pnpm vitest run tests/codebuddy-integration.test.ts tests/worker-permissions.test.ts tests/qoder-routing.test.ts tests/qodercn-integration.test.ts tests/native-harness-tools.test.ts tests/windows-cli-installation.test.ts`：6 文件、176/176 通过。工具桥测试在沙箱内 listen EPERM，经获准环境重跑通过。
  - 其余清单相关及已修改测试：`corepack pnpm vitest run tests/native-runtime.test.ts tests/cli-settings.test.ts tests/settings-dialog.test.tsx tests/cli-account-binding.test.ts tests/harness-reasoning-records.test.tsx tests/cli-executable-paths.test.ts tests/authorized-catalog.test.ts tests/settings-display-cache.test.ts tests/panel.test.tsx tests/windows-accounts.test.ts tests/storage.test.ts tests/dispatch-storage.test.ts tests/worker-management.test.ts tests/worker-goals.test.ts tests/runtime-account-isolation.test.ts tests/running-message-settings.test.ts tests/routing.test.ts tests/client-i18n.test.tsx`：18 文件、938/938 通过；另跑 `corepack pnpm vitest run tests/extended-integration.test.ts`，1 文件、15/15 通过。仅为新增 CLI 补齐两个合成账号夹具，不跳过测试。
  - `corepack pnpm build:preview` 通过，核对 `.cache/preview-package/lib/native-codebuddy.mjs` 与 `codebuddy-catalog.mjs` 均存在；在 `.cache/preview-package` 执行 `corepack pnpm typecheck`，Host/Client 均通过（DSH 0.2.2-rc.1）。未正式 build、未更新 Desktop 链接。
  - 原工作树 `corepack pnpm typecheck`：Host 通过；Client 因缺生成的 `dsh-cliworker-now/remote` 声明失败。错误位置：index.tsx:11 TS2307、index.tsx:72 TS2339、native-cli-model-directory.ts:85/123 TS7006、settings-dialog.tsx:247/248 TS2345、worker-model-menu.tsx:72/80 TS7006、workers.ts:10/12 TS2339。保留本项未勾选，未将隔离包检查等同于原工作树检查通过。
  - `git diff --check` 通过；本轮未运行真实 CodeBuddy、登录、模型或真实 Windows/Desktop 验收，未联网查询、提交 Git 或增版。

## 11. 真实验收（macOS，`hy4free`，临时目录）

- [ ] 11.1 读文件、写文件（产物核对）
- [ ] 11.2 命令审批：允许一次、拒绝一次（拒绝即结束本轮的显示与产物）
- [ ] 11.3 同会话续聊
- [ ] 11.4 运行中停止（进程退出核对）
- [ ] 11.5 国际站、企业域、iOA、Windows：未执行时保持未验证

## 12. 文档

- [ ] 12.1 `doc/codebuddy-protocol.md`
- [ ] 12.2 README、README.en、AGENTS.md、usage-details（中英）、design.md

## 共享改动（供合并处理冲突）

- 注册分工修改：共享 types / worker-permissions / conversation-features / account-links；Host routing / index / process / native-worker / native-bridge / native-attachments / native-harness-injection / cli-native-capabilities / runtime / windows-cli-installation / telemetry；构建 scripts/build.mjs；Client i18n-messages；测试 codebuddy-integration / native-runtime / worker-permissions / windows-cli-installation / cli-account-binding / windows-accounts。其余并行分工文件未由注册分工编辑。
