# Design

## Context

见 proposal.md。`confirmAccount` 对 `guide.targetsLogin`（指定服务商的登录）只用 `guide.proves(before, after, exitCode)` 判断：新 ID 出现或退出码为 0。OpenCode 的 `auth login` 在替换已存在的服务商 Key 时沿用同一 ID；Windows 终端包装层的退出码与读取时机都不稳定，可能导致 Key 已写入却显示未确认。

## Goals / Non-Goals

目标是用实际凭据变化作为确认依据，并且不暴露凭据。不改原生凭据文件、不读取或输出凭据值、不改终端启动方式。

## Decisions

### 决定 1：进程内 HMAC 指纹
- 最终决定：账号读取时用进程启动时生成的随机 32 字节密钥，对「方式 + 凭据字段」计算 HMAC-SHA256，挂在登录对象的 WeakMap 上；比较同一 ID 前后两次的指纹。
- 放弃的方案：比较文件修改时间——同一文件里其他服务商的变化也会改时间；把哈希写进回执——会把凭据的可比较派生值带出 Host。
- 影响：Host 重启后指纹失效，只影响正在进行的那次确认，不影响已保存的账号。

### 决定 2：读不到基线时不确认
- 最终决定：基线为 unavailable/unknown 时，现存登录不算新增；退出后继续轮询，非指定服务商流程连续 3 次读不到即停止。
- 影响：避免把旧凭据误判为新登录；无法确认时把原因和退出码显示给用户。
