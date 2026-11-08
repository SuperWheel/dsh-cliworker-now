## Why

v0.8.8 新接入的 CodeBuddy Code、TRAE CN、WorkBuddy CN 与 WorkBuddy 在 2026-11-08 Mac Desktop 验收中暴露几处缺口：CodeBuddy 与 WorkBuddy 不显示用量；无法分支时理由含糊；因拒绝审批而结束的轮次在 Worker 窗口看不到结果说明；设置页左栏没有标出 WorkBuddy 两项为试验性；WorkBuddy CN 桌面管理窗口英文页脚换行错乱，关闭后再打开显示“桌面管理暂不可用”；派遣结果不写明本轮实际权限档位。

## What Changes

- CodeBuddy 与 WorkBuddy 两版：ACP 回执不含用量，改为读取 CLI 自己写的原生会话文件中本轮各请求的 `usage` 与 `rawUsage.credit`。这几款 CLI 按积分计费，与 Qoder 一样显示积分；任一请求缺积分数据，或本轮有子 Agent 时，积分显示为未知，不把 token 当积分。TRAE CN 回执本身带 token，保持默认的 token 显示。
- WorkBuddy 两版补上 ACP `usage_update` 上下文统计。
- 分支：CodeBuddy 的 ACP 实测没有 `session/fork`（返回 Method not found），WorkBuddy 内置 CLI 也没有实现，两者仍为不支持，并写明各自的实测理由。TRAE CN 已有原生分支，不改。
- 拒绝审批结束的结果说明作为“本轮结果说明”行投影到原生 Worker 窗口。
- 设置页左栏的 WorkBuddy CN 与 WorkBuddy 在名称下加一行“试验性”。
- WorkBuddy 桌面管理窗口：重新打开前等待上一次的账号读取或会话停止完成，不再被拒；有已知原因时显示原因；英文页脚按钮不折行，说明文字可换行。
- `cliworker_start`、`cliworker_followup` 的返回与完成结果附带本轮实际权限档位及其来源。档位规则不变。

## Capabilities

### Modified Capabilities

- `worker-permission-levels`：新增“派遣结果写明实际档位”。
- `worker-run-outcomes`：新增“结果说明在 Worker 窗口可见”。

## Impact

- Host：`src/host/codebuddy-durable-usage.mjs`（新增）、`native-codebuddy.mjs`、`native-workbuddy.mjs`、`telemetry.ts`、`harness-turn-usage.ts`、`runtime.ts`、`harness-conversation-stream.ts`、`workbuddy-desktop.ts`、`accounts.ts`、`index.ts`。
- Shared：`telemetry.ts`（`CREDIT_BILLED_CLIS`）、`conversation-features.ts`、`types.ts`、`workbuddy.ts`、`worker-permissions.ts`。
- Client：`settings-dialog.tsx`、`styles.ts`、`account-login/workbuddy-desktop-window.tsx`、用量显示组件、`i18n-messages.ts`。
- 构建：`scripts/build.mjs` 打包新增的 Host 资源。
- 关联变更：`add-codebuddy-cli`、`add-workbuddy-cli`、`add-traecn-cli`、`add-new-cli-graphical-login` 的任务清单各记一条指向本变更的说明。
