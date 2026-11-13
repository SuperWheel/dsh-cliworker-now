# Proposal

## Why

用户反馈 macOS 和 Windows 的 Qoder 上下文与用量缺失。目前 `native-qoder.mjs` 仅取 ACP 主回执，`qoder-durable-context.mjs` 只补上下文比例，积分未进入原生用量弹层；原生文件实际已有比例和 Credits，隐藏的全零 token 仍不可视为真实消耗。

## What Changes

- 参考 Codingns4DSH 的 ACP、原生 JSONL 和同会话日志补充读取思路，独立实现并保留现有身份、私有文件和读取预算校验。
- 同时核对 ACP 主用量和扩展 quota；有一致非零计数才显示 token，隐藏计数标明未公开。
- 精确关联本轮原生请求，采集积分与比例；窗口有同轮原生证据时展示容量和明确标记的占用估算，否则只展示比例。
- 在现有原生用量弹层展示本轮积分，积分与 token、上下文分别处理，支持历史只读恢复。
- 对 macOS、Windows 路径和异步 ACL 分支做关联回归；不新增模型请求，不更改账户、会话或版本。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `qoder-cli`: 扩充原生统计及明确未知，增加积分、可证实窗口及跨平台读取场景。

## Impact

影响 Host Qoder 适配、数字遥测、共享投影、现有四包原生 UI 扩展中的用量组件和关联测试。无新增依赖；保持 v0.8.1。仅做最小验收，真实付费调用、Windows 账户/模型和全量发布验收保留未验证边界。
