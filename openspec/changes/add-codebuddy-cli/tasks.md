## 1. 调研与 OpenSpec

- [x] 1.1 本机探测 CodeBuddy 2.181.0 的 ACP 握手、`session/new` 目录、配置项、模式、审批、拒绝、续聊与停止（模型 `hy4free`，临时目录）
  - 2026-11-07 探测脚本在会话 scratchpad，结论写入 proposal 调研表与 `doc/codebuddy-protocol.md`
- [x] 1.2 创建 `openspec/changes/add-codebuddy-cli/`（proposal、specs、design、tasks）
- [ ] 1.3 `pnpm spec validate add-codebuddy-cli --strict` 与 `pnpm spec:check`

## 2. 注册身份与能力声明

- [ ] 2.1 `src/shared/types.ts`：`CLI_IDS`、`CLI_LABELS`（CodeBuddy Code）、`CLI_SHORT_NAMES`（codebuddy）
- [ ] 2.2 `src/shared/worker-permissions.ts`：三档文案、规划模式支持
- [ ] 2.3 `src/shared/conversation-features.ts`：不支持分支及理由、`expectedTransport`
- [ ] 2.4 `src/shared/account-links.ts`：登录域名、`SINGLE_ACCOUNT_CLIS`
- [ ] 2.5 `src/host/routing.ts`：中英文别名
- [ ] 2.6 `src/host/index.ts`、`src/host/process.ts`：`codebuddyExecutable` 配置
- [ ] 2.7 `src/host/native-worker.ts`、`src/host/native-bridge.mjs`：`codebuddy-acp-v1` 与 runner 映射
- [ ] 2.8 `native-attachments.mjs`、`native-harness-injection.mjs`、`cli-native-capabilities.mjs`：附件、工具桥传输、能力类别与 skill 目录
- [ ] 2.9 `scripts/build.mjs`：`native-codebuddy.mjs`、`codebuddy-catalog.mjs` 进入运行资源清单

## 3. 发现与启动

- [ ] 3.1 `src/host/adapters.ts`：可执行文件解析、`catalogFor`、`workerArguments`（`[codebuddy, --acp]`，规划与权限交给 runner）
- [ ] 3.2 `src/host/windows-cli-installation.ts`：Windows npm 入口线索
- [ ] 3.3 运行环境追加 `DISABLE_AUTOUPDATER=1`（运行、目录、账号终端）

## 4. 账号、站点与绑定

- [ ] 4.1 `src/host/codebuddy-account.ts`：认证文件路径、登录状态（不读内容）、站点声明、绑定材料、单次授权目录快照
- [ ] 4.2 `src/host/accounts.ts`：状态、动作说明、原生终端参数
- [ ] 4.3 `src/host/cli-account-binding.ts`、`src/host/authorized-catalog.ts`：绑定与快照接入

## 5. 模型目录与强度

- [ ] 5.1 `src/host/codebuddy-catalog.mjs` 与 `parseCodebuddyModels`：`effortOptions`、积分倍率、同名区分

## 6–8. runner、审批与拒绝结束

- [ ] 6.1 `src/host/native-codebuddy.mjs`：argv、身份校验、模式映射、强度、会话级选项、工具名、拒绝结束判定
- [ ] 6.2 共享 `native-acp.mjs` 可选行为：`verifyInitialize`、`defaultEffort`、`approvalFromToolCall`、`deniedTurnEnd`（默认关闭）

## 9. 遥测、图标、设置页

- [ ] 9.1 `src/host/telemetry.ts`：`usage_update` 上下文统计
- [ ] 9.2 图标素材 `doc/assets/cli-icons/v5-codebuddy/`、`src/client/assets/codebuddy.png`、`icons.tsx`
- [ ] 9.3 设置页与 i18n：连接页条目、账号区站点显示、新文案

## 10. 自动化测试

- [ ] 10.1 `tests/native-codebuddy.test.ts`（模拟夹具）：握手与身份、目录与强度、模式映射与降级、规划、审批允许与拒绝、拒绝即结束、停止、恢复与重放、缺终态
- [ ] 10.2 `tests/codebuddy-account.test.ts`：登录状态、退出标记、站点声明、绑定随目录变化、不读认证文件内容
- [ ] 10.3 `tests/codebuddy-integration.test.ts`：注册、别名、权限档位、transport、构建清单
- [ ] 10.4 共享 runner 回归：`tests/native-qoder.test.ts` 等 ACP 测试保持通过
- [ ] 10.5 `pnpm typecheck`、相关 vitest、`pnpm build:preview`

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

- 待实施后补全清单
