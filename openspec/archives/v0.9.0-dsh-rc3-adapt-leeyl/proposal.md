# Proposal

## Why

本机 Mac 的 DeepSeek Harness Desktop 已是 0.2.2-rc.3（npm `@deepseek-ai/dsh@0.2.2-rc.3` 于 2026-11-13 发布，官方 tag `dsh-v0.2.2-rc.3` = `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`）。插件的开发 SDK 与随包四个原生界面包仍锁 0.2.2-rc.2，构建脚本也只接受到 rc.2 为止的目标，因此插件需要随宿主升级。

## What Changes

- 开发 SDK 的全部 `@deepseek-ai/dsh*` pin 升到 0.2.2-rc.3，workspace 发布期限例外同步；构建依赖选择加入 rc.3 目标。
- 从固定 tag `dsh-v0.2.2-rc.3` 重建四个随包界面包（沿用 rc.2 的 48 文件补丁），冻结独立构建依赖并重新 vendor `runtime-host/`；构建、vendor 脚本与测试加入新目标。
- 核对 rc.2 → rc.3 的公开 API、类型、Gateway、Remote、扩展点、主题 token 与组件差异，按结果适配（若无破坏性变化则不改插件业务代码）。
- 同步 README（中英）、`doc/design.md` 与 `doc/native-conversation-host-extension.md` 中的宿主版本说明。
- 插件版本号不变（下一版本由用户确认，2026-11-16 定为 v0.9.0）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `package-distribution`: 随包原生界面跟随 0.2.2-rc.3。

## Impact

涉及 package.json、锁文件与 workspace 例外、`scripts/`、`host-extensions/dsh-0.2.2-rc.3/`、`runtime-host/`、相关测试与文档。业务派遣协议不变。不调用模型、不派遣任务；不推送、不发布、不合并到 main。
