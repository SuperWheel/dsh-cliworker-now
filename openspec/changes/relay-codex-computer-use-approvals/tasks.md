# Tasks

## 1. Computer Use 应用授权转发

- [x] 1.1 实现收窄识别、原生回复、单次交付与生命周期防护；用 native-primary-runners 模拟用例核对允许一次、session、拒绝正常完成及真实失败、非法形状、跨线程、重复、停止与迟到回复。
  - 2026-10-30：新增 36 项明确标记「模拟」的测试；进程夹具不加载 CLI 账号或模型。覆盖原生回复内容、重复请求在审批前后到达、重复 Host 答复、消息长度限制、无会话能力、停止/超时/终态后的迟到决定，以及发送失败晚于 completed 时仍判失败。
  - 初次运行有一项新增测试误用时间线辅助函数；修正断言后完整两文件回归 227/227 通过，既有 user-input/unknown-request 用例保留并通过。
  - 审查补充（2026-10-30）：原实现在本轮已有失败时，对识别出的授权既不询问也不回复，Codex 的工具调用会一直等到超时。现改为立即回复 `decline`（不弹审批）；轮次已结束、已关闭或已停止时仍不回复。新增模拟用例「本轮已失败时立即拒绝」。撤回修复后该用例失败，恢复后通过。
- [x] 1.2 验证复用审批策略的规划拒绝、询问/工作区档询问、完全权限自动放行；运行 native-approval-relay 关联测试。
  - 2026-10-30：`pnpm exec vitest run tests/native-primary-runners.test.ts tests/native-approval-relay.test.ts` 中审批策略文件 72 项通过；runner 新增四种档位/规划映射模拟用例均通过。未修改 `decideApproval`，没有 Computer Use 例外。
- [x] 1.3 同步 README 和 doc/design.md，核对文字与分支和权限策略一致。
  - 已同步 README.md、README.en.md 与 doc/design.md 的本次条目；保留真实 Windows 审批未验证说明。

## 2. 集成检查与真实验收边界

- [x] 2.1 使用指定 PATH 运行关联 vitest、pnpm typecheck 和 pnpm spec validate relay-codex-computer-use-approvals --strict，记录实际结果。
  - 所有命令先设置 `export PATH=/private/tmp/claude-501/-Users-leeyl-AI-Project-DeepSeekHarness-cliworker-now/2f8fa750-5e53-440a-be75-3325ede92abb/scratchpad/bin:$PATH`。
  - `pnpm exec vitest run tests/native-primary-runners.test.ts tests/native-approval-relay.test.ts`：2 文件、227 项通过（155 + 72），最终运行耗时 50.55 秒。
  - `pnpm typecheck`：Host/Client 通过，当前依赖目标为 DSH 0.2.1-rc.5。
  - `pnpm spec validate relay-codex-computer-use-approvals --strict`：通过。
  - 未执行真实模型/CLI 会话、Windows/Desktop 验收、全量测试或构建部署；未修改版本号、未提交 Git，未读取凭据。共享目录的其他会话改动原样保留。
- [ ] 2.2 Windows 实机抓取真实请求帧并验证 DSH 审批。
  - 本次未授权真实 CLI/模型调用，保留未验证；静态重建请求与模拟用例不能代替现场证据。
  - 2026-10-30 23:14：新包 `preview-20261030-230544` 已装入（含本修复）。Windows Codex 升级到 0.166.0 后，经 DSH 在 Windows 派遣 GPT-5.6-Luna / Low，结果 SUCCESS。
    - 文件改动与 PowerShell 命令都正常完成，模型没有改用 Computer Use，所以没有产生授权请求。
    - 真实请求帧和 DSH 审批仍未验证。

## Workflow follow-up

- Windows 实机验收未完成，保留活动 change，不通过归档隐藏缺口。
