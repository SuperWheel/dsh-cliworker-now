## 1. 实现

- [x] 1.1 ZCode：`denied` 标记、被拒工具与批次失败豁免、UNCERTAIN 结果。
- [x] 1.2 ACP（Kimi/Grok/Qoder/Qoder CN）：同上，按 `toolCall.toolCallId` 豁免。
- [x] 1.3 Codex：仅三类审批请求转为 `denied`，被拒条目 `declined` 完成不判失败；其他反向请求仍失败。（Codex 子代理 gpt-6.1-sol 实施，主会话补充被拒条目豁免）
- [x] 1.4 Hermes、原生 HTTP 会话系：有拒绝时为 UNCERTAIN，无拒绝的工具失败仍失败。（Codex 子代理 gpt-6.1-sol 实施）

- [x] 1.5 原生会话：uncertain 轮次以 stop 收尾，不产生 CLI_RUN_FAILED 与额外空步骤；说明由插件警示提示显示。

## 2. 测试

- [x] 2.1 `tests/native-zcode.test.ts`：按实测帧顺序拒绝后完成→UNCERTAIN；拒绝后轮次失败、批内其他工具失败→ERROR。
- [x] 2.2 `tests/native-acp.test.ts`、`tests/native-qoder.test.ts`：拒绝→UNCERTAIN；被拒工具失败不影响；其他工具失败→ERROR。
- [x] 2.3 `tests/native-primary-runners.test.ts`：三类审批→UNCERTAIN；用户输入/未知请求、拒绝后失败/中断/工具失败/非零退出→ERROR。
- [x] 2.4 `tests/native-http.test.ts`：OpenCode 系与 Hermes 拒绝→UNCERTAIN；无拒绝工具失败→ERROR。

- [x] 2.5 `tests/harness-conversation-stream.test.ts`：uncertain 结束为 completed、无 CLI_RUN_FAILED、单一步骤、无请求错误（撤掉修改时失败）。

## 3. 未执行

- [x] 3.1 真实 ZCode 复验：拒绝 shell 后改用编辑完成，任务卡显示结果待核实。
  - 2026-10-25 第三次（新 Host 13:19，提交 32752a8，GLM-5.3-Flash·Low）：任务卡「结果待核实」；Worker 状态 `uncertain`，结果帧 UNCERTAIN；Bash 步骤显示失败；Read/Edit 工具行均在对应响应完成边界之后；deny.txt 落盘为 alpha、beta、gamma。前两次失败原因见 design.md。
  - 同一任务详情仍显示「处理失败 / 本轮运行失败 / CLI_RUN_FAILED」，用户要求改掉，见 1.5。
- [x] 3.3 Desktop 实机确认任务详情不再显示「处理失败」（1.5）。
  - 2026-10-25 新 Host 15:05（b5f50f2）：任务卡「结果待核实」，详情顶部为待核实警示，逐段滚动未见「处理失败 / 本轮运行失败 / CLI_RUN_FAILED」；Bash 步骤失败，CLI 最终回复保留；Worker `uncertain`，deny.txt 为 alpha、beta、gamma。
- [x] 3.2 其他 CLI 真实拒绝场景（未调用真实模型）。
  - 2026-10-29 核对：除 ZCode（2026-10-25 Desktop）外，以下 CLI 已真实执行拒绝。OMP：原生 bash 被拒 → 结果待核实，文件未创建（`reenable-native-cli-features` 4.1）。Codex：拒绝 → 结果待核实，`deny.txt` 未创建（`relay-native-approvals-to-host` 4.1）。Pi：DSH 备选命令被拒 → 结果待核实，文件未生成（`close-approval-relay-gaps` 3.1）。Claude Code：按原生 deny+interrupt 以失败结束，文件未创建（`relay-native-approvals-to-host` 4.2）。之后用户 2026-10-28 决定：拒绝后正常结束的轮次改为「已完成」，由 `close-approval-relay-gaps` 修改。未真实复验：Kimi、Grok、Qoder/Qoder CN、OpenCode、MiMo、Hermes、Antigravity。

## 后续

- 2026-10-28 用户决定：授权被拒后 CLI 正常结束的轮次改为「已完成」，不再标结果待核实、不显示横幅。由 `close-approval-relay-gaps` 以 MODIFIED 修改本变更的「额外授权被拒绝后完成的轮次」等需求；本变更须先于该变更归档。
