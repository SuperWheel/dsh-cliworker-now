# Proposal

## Why

需求 REQ-0136（快照 `doc/prd/2026-11-17-v0.9.1-REQ-0136.md`）。

- v0.9.0（2026-11-16）起，插件自动把各 CLI 更新到最新版。CLI 更新可能改变登录的存放位置或格式，插件按旧位置读取时，会把已登录判成未登录，账号绑定失败，模型列表为空。
- 已出现三例：Antigravity 1.5.x 改存令牌文件（GitHub issue #13，修复见变更 `v0.9.1-agy-token-file-fallback-leeyl`）；Claude Code 2.1.311 改用带后缀的钥匙串条目（v0.9.0 已修）；Hermes 0.23.1 续期接口签名变化（v0.9.0 已修）。
- 17 个 CLI 判断登录的方式各不相同（凭据文件、系统凭据库、原生状态命令、SDK 守护进程、桌面端元数据），此前没有系统核对过各 CLI 最新版的登录存放方式。
- 代码在 CLI 更新完成或版本指纹变化时已作废该 CLI 的账号与模型显示缓存（`src/host/cli-management/service.ts` 第 216、718 行，经 `index.ts` 的 `invalidateSettingsDisplay`），但 `cli-update` 规格只写了「登录、退出、切换账号后立即重读」，没有写更新后重读。

## What Changes

- 逐一排查 Antigravity 以外的 16 个 CLI：记录排查时的版本、插件读取登录状态与绑定的来源、新版的实际存放方式，在 Mac 与 Windows 上核对设置页、账号窗口、模型目录、派遣、续聊与退出。
- 有问题的 CLI 在本变更内修复：按 CLI 自己的读取顺序读取，同一账号的绑定不因存放位置变化而改变，补模拟测试；修复需要新的行为规格时追加到本变更。
- `cli-update` 规格补一条：CLI 更新或安装完成、或版本指纹变化后，作废该 CLI 的账号与模型显示缓存，下次显示时重读。
- 每个 CLI 的排查结论（无问题、已修复、阻塞及原因）写入 tasks.md。

## Capabilities

### Modified Capabilities

- `cli-update`：新增「CLI 版本变化后重读账号状态」。

## Impact

- 排查涉及 `src/host/accounts.ts` 及各 CLI 的账号读取模块；具体改动视排查结果而定。
- 真实验证需要各 CLI 的账号；没有账号或订阅的 CLI 写明阻塞。
- 不改变各 CLI 的登录流程，不迁移、写入或删除用户凭据。
