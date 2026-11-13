## 1. 实现

- [x] 1.1 `invocationResolution` 在识别插件自身调用和 CLI 名之前去掉紧跟调用动词的次数/数量词（排除「一次性」）。

## 2. 自动检查

- [x] 2.1 `tests/routing.test.ts`：新增 4 个解析用例（含原失败消息→grok、「调用一次…使用 Grok」→grok、「调用 2 次 codex cli」→codex、「使用两个 agy cli」→antigravity）与 3 个无提示用例（「请调用 1 次 CLI Worker 派遣工具」等）；撤掉修复时其中 5 个失败。
- [x] 2.2 离线：对 Desktop 中失败的原消息运行 `invocationResolution`，修复前 unknown（候选为空），修复后无提示；改写后的「用 Grok CLI 派遣 1 个只读任务…」仍解析为 grok。
- [x] 2.3 全量 225 文件 4417 通过、13 跳过；类型检查、OpenSpec 严格校验通过。

## 3. 真实验收

- [x] 3.1 Desktop 中发送「请调用 1 次 CLI Worker 派遣工具，使用 Grok…」能正常派遣（用户本次只要求单元测试与离线验证，未执行）。
  - 2026-11-09：用户决定按已完成关闭；本项没有补做上文所列的真实验收，原记录保留。
