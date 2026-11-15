# Proposal

## Why

用户 2026-11-15 报告：在 Windows 上 OpenCode 的账号窗口里重新输入 DeepSeek API Key，登录有时显示「登录窗口已结束」，连试三次前两次失败，第三次成功。插件对指定服务商登录的确认只认「出现新的登录 ID」或「退出码为 0」。替换同一服务商的 Key 时登录 ID 不变，所以只要终端退出码不是 0，或退出后状态还没读到，Key 实际已经保存也会判为未确认。

## What Changes

- Host 读取 OpenCode、Pi、OMP、Hermes 账号时，为每条登录在进程内记录一个凭据 HMAC 指纹（随机密钥只在内存中，指纹不落盘、不出现在回执里）。指定服务商的登录在同一 ID 的指纹变化时也算确认。
- 基线读不到（unavailable/unknown）时不把现存凭据当作新增登录。进程退出后在确认时限内继续读取；非指定服务商的流程在退出后连续 3 次读不到时停止重试。
- 无法确认时，结果提示写明原因与退出码，不再只显示「登录窗口已结束」。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cli-account-isolation`：新增「替换同服务商凭据后按凭据变化确认登录」。

## Impact

Host 的账号引导引擎、accounts.ts 的确认循环，以及 OpenCode、Pi/OMP、Hermes 的账号读取；Client 只多显示一段原因文本。凭据格式、存储位置与 Host 回执协议不变。

## 成功指标（基线、目标）

基线：替换同服务商 Key 后，确认依赖退出码 0；Windows 上三次中失败两次（用户报告）。目标：Key 变化即可确认，与退出码无关；读不到状态时不误判为成功。
