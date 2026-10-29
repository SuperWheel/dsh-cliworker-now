## Why

所有原生 runner 只要本轮出现一次工具失败（非零退出、`failed` 状态、`is_error` 等），就用 `failure ??=` 把整轮锁定为 ERROR，即使 CLI 随后自行恢复、`turn/completed` 为 completed 且产物完整。2026-10-28 两份 Windows 用户反馈：

- 一轮 Codex 冒烟中 venv python 退出码 1，回答正确仍被判 failed（「原生工具失败或权限被拒绝」）。
- 另一用户 28 个 Worker 中 12 个 failed。其中 T0b 全面审查：一次写文件命令 `Exit code: 1`（78.5 秒）后 Codex 改用其他方式写成，`turn/completed = completed, error: null`，产物 12,769 B 完整，`lastResult` 完整，Worker 仍为 failed。主 Agent 据此误判、重跑，约 4.4M tokens 被浪费。

插件内存模拟已复现（工具退出码 1 → 再成功 → 回复 recovered → 轮次 completed → 进程退出 0，结果仍为 ERROR）。证据：`src/host/native-codex.mjs:123`、`native-claude.mjs:188`、`native-acp.mjs:193`、`native-zcode.mjs:216-218,380-390`、`native-session-http.mjs:197,497`、`native-hermes.mjs:382,453`、`native-agy.mjs:63,115`、`pi-omp-bridge.mjs:839,934`。

## What Changes

- 工具级失败只作为工具步骤的事实保留在时间线（步骤仍显示失败、输出与退出码保留），不再单独决定整轮终态。
- 整轮终态改由：原生轮次终态（completed / failed / interrupted）、协议完整性（会话身份、缺少终态、仍有未完成工具）、进程退出与清理、取消/超时决定。原生终态为成功且无其他失败证据时为 SUCCESS。
- 本轮最后一次工具调用失败且其后没有任何成功工具或回复时，不得宣称成功：结果为 UNCERTAIN（结果待核实），提示核查产物，不自动重试。
- 本轮出现过工具失败但最终成功时，结果说明附带「本轮有 N 个工具步骤失败，CLI 已自行处理」，供主 Agent 判断，不改为失败。
- 修订尚未归档的 `report-denied-permission-as-unverified` 中「其他工具失败 MUST 仍为失败」一句，与本变更一致；被拒绝授权的 UNCERTAIN 规则保持不变。
- 范围：Codex、Claude Code、ACP 系（Kimi、Grok、Qoder、Qoder CN）、ZCode、OpenCode、MiMo、Hermes、Antigravity、Pi、OMP。

范围外：不放宽任何权限；不根据模型「已完成」自述判定成功；不改变取消、超时、非零退出及清理失败的既有失败语义；输出超限另见 `bound-native-tool-output`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `worker-run-outcomes`：新增「可恢复的工具失败不决定整轮终态」规则。

## Impact

- Host：上述各 native runner 的终态判定；`runtime.ts` 中 UNCERTAIN/说明透传（已有映射，预计不改）。
- 测试：`tests/native-primary-runners.test.ts`、`native-acp.test.ts`、`native-zcode.test.ts`、`native-http.test.ts`、`pi-omp-adapter.test.ts` 中「工具失败即整轮失败」的既有断言需改写（如 `tests/native-http.test.ts:388,515`、`tests/pi-omp-adapter.test.ts:777-778`）。
- Client：无新增界面；任务卡状态分布会变化（failed 减少）。
- 协议/安装：无变化。
