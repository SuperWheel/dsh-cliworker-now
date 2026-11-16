## 1. 凭据变化确认 〔后端｜3h〕

- [x] 1.1 实现进程内凭据指纹与确认逻辑
  - 3317c9a：新增 `src/host/account-guide/credential-evidence.ts`（随机 32 字节密钥、HMAC-SHA256、WeakMap）；`engine.ts` 的 `proves` 在基线可读时比较同 ID 指纹，新增 `targetsLogin` 与带原因的 `unconfirmed`；`accounts.ts` 的确认循环在退出后继续读取，无法确认时显示原因与退出码。
  - OpenCode（`opencode-native.ts`）、Pi/OMP（`pi-omp-native.ts`）、Hermes（`hermes-accounts.ts`）读取账号时登记指纹。
  - 1e4cfa5：非指定服务商的流程退出后连续 3 次读不到状态即停止，修复全量回归中 TRAE 自动退出用例超时。
- [x] 1.2 模拟回归
  - 新增 `tests/account-credential-confirmation.test.ts`；`account-launch-exit`、`account-lifecycle-races`、`login-method-picker`、`windows-account-terminal` 补充用例（3317c9a 共 11 个文件 +300 行）。
  - 2026-11-16 main 1cf49d0：Mac 全量 vitest 354 个文件通过、4 个跳过，8265 项通过（`.test-data/release-v0.8.10/mac-full-vitest-8.log`）；Windows 远程回归 run `f3083a3d` 通过。

## 2. 实机验收 〔测试｜1h｜前置 1〕

- [x] 2.1 Windows OpenCode 替换 DeepSeek Key 实机复测
  - 2026-11-16 用户在 Windows Desktop（v0.9.0）自行完成 OpenCode 替换 DeepSeek Key 复测，并告知通过。本会话没有复核插件事件和日志，证据是用户的这次告知。
  - 测试前的情况：输入 API Key 只能由用户操作。Windows Desktop 已于 2026-11-16 装上含本修复的 1cf49d0 包，待用户在 OpenCode 账号窗口重试。
  - Windows 上出现「登录窗口已结束」的直接触发条件（退出码或读取时机）没有现场日志证实；修复依据是代码路径分析。
