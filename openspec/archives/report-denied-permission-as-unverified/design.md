# Design: 额外授权被拒绝后标为结果待核实

- 各 runner 增加独立的 `denied` 标记，与 `failure` 分开；结束时：`failure` → ERROR，否则 `denied` → UNCERTAIN（带说明），否则 SUCCESS。运行时已有 `nativeTransport && status === 'UNCERTAIN'` → `uncertain` 映射。
- 被拒绝工具的失败豁免需要工具身份：ZCode 取 `interaction/requestPermission.params.toolCallId` 与 `permission.resolved.payload.toolCallId`，批次 `errorCount` 只扣除批内被拒绝的工具；ACP 取 `session/request_permission.params.toolCall.toolCallId`；Codex 取审批请求的 `params.itemId`（被拒命令以 `declined` 完成）。实测 ZCode 帧顺序：permission.requested → requestPermission → permission.resolved(deny) → tool.updated batch(errorCount 1)。
- Hermes 与原生 HTTP 会话系的审批请求不带工具身份：有拒绝时工具失败不单独判失败，整体为结果待核实（不是成功，仍要求核查）；无拒绝的工具失败照旧失败（2026-10-28 起改由 `judge-run-outcome-by-native-terminal` 判定）。
- Claude Code 的拒绝响应带 `interrupt: true`，本轮立即终止，保留失败。Codex 的用户输入及未知反向请求、ZCode 的 `requestUserInput` 仍为失败。
- ZCode 被拒工具只有 `tool.updated kind=scheduled`，之后没有单独的 result/error 帧，只由批次 `errorCount` 收尾。首次真实复验（2026-10-25 13:05）因此在结束检查“工具未完成”而失败；现由批次关闭被拒工具（标记完成并在时间线显示失败）。夹具已补 `scheduled` 帧复现。
- 第二次真实复验（13:09）任务被停止，报“CLI 新响应先于当前响应的完成边界”。原始帧显示原因与拒绝无关：ZCode 对只读工具（Read，`canRunParallel`）先发 scheduled/started，再发该消息的 model_complete。插件把被动工具行直接写在未完成的响应之后，原生投影据此停止运行。现由 `ZcodeResponseTracker.tool()` 在响应未完成时暂存工具事件，完成边界写出后按序放出（原生 runner 与旧适配器共用）。
- 第三次复验任务卡已为「结果待核实」，但任务详情仍显示「处理失败 / 本轮运行失败 / CLI_RUN_FAILED」：这是 Harness 对 `error` 结束原因的固定渲染（Harness 结束原因只有 stop、tool-calls、max-tokens、aborted、error）。按用户要求，`HarnessConversationStream` 对 uncertain 与 completed 同样以 stop 收尾，不再补空步骤后报错；待核实说明由插件面板已有的警示提示（`cwn-notice cwn-warning`，内容为 Worker 的说明）显示。所有 uncertain 来源都是 CLI 已正常结束、仅结果汇总待核实，原生会话完整，因此这类轮次也可作为分支截点。
