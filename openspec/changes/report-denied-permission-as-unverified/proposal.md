## Why

插件对 CLI 的额外权限/授权请求一律拒绝（无交互授权）。此前任一拒绝都会把整轮判为失败。2026-10-25 实测：ZCode 想用 shell 追加文件被拒后改用编辑工具完成了任务，任务卡却显示「失败」，主 Agent 只能自己判断改动是否落盘。用户决定：拒绝后 CLI 仍正常完成的轮次标为「结果待核实」，不当作成功也不当作失败。

## What Changes

- 继续拒绝所有额外权限/授权请求，不改变权限边界，不放宽原生保护。
- 拒绝后，若 CLI 本轮自身正常结束、无其他失败，原生结果为 `UNCERTAIN`，Worker 状态为 `uncertain`（结果待核实），说明写明授权被拒、请先核查实际产物、不要自动重试。
- 被拒绝的那个工具因拒绝而报告的失败不再单独判为工具失败；轮次失败、中断、非零退出、缺少终态仍为失败；其他工具失败的整轮判定见 `judge-run-outcome-by-native-terminal`（2026-10-28 修订，原为「其他工具失败仍为失败」）。
- 适用：ZCode、ACP 系（Kimi、Grok、Qoder、Qoder CN 等）、Codex、Hermes、原生 HTTP 会话系（OpenCode 等）。
- 不适用：Claude Code（拒绝时带 `interrupt: true`，本轮随之终止，仍为失败）；需要额外交互输入（非授权）的请求仍为失败。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `worker-run-outcomes`：新增“额外授权被拒绝后完成的轮次”终态规则。
- `qoder-cli`：额外权限被拒绝后不再必然失败，改为结果待核实。

## Impact

- `src/host/native-zcode.mjs`、`native-acp.mjs`、`native-codex.mjs`、`native-hermes.mjs`、`native-session-http.mjs` 与对应测试。
- 运行时已有 `UNCERTAIN` → `uncertain` 映射，无需改动；宿主 job 仍按既有规则把 uncertain 保守映射为 failed 并附核查提示。
