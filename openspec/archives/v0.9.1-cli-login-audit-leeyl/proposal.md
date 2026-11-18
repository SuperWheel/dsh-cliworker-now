# Proposal

## Why

需求 REQ-0136（快照 `doc/prd/2026-11-17-v0.9.1-REQ-0136.md`）。

- v0.9.0（2026-11-16）起，插件自动把各 CLI 更新到最新版。CLI 更新可能改变登录的存放位置或格式，插件按旧位置读取时，会把已登录判成未登录，账号绑定失败，模型列表为空。
- 已出现三例：Antigravity 1.5.x 改存令牌文件（GitHub issue #13，修复见变更 `v0.9.1-agy-token-file-fallback-leeyl`）；Claude Code 2.1.311 改用带后缀的钥匙串条目（v0.9.0 已修）；Hermes 0.23.1 续期接口签名变化（v0.9.0 已修）。
- 17 个 CLI 判断登录的方式各不相同（凭据文件、系统凭据库、原生状态命令、SDK 守护进程、桌面端元数据），此前没有系统核对过各 CLI 最新版的登录存放方式。
- 插件在 CLI 更新结束或版本指纹变化时，会作废该 CLI 的账号与模型显示缓存（`src/host/cli-management/service.ts` 原第 216、718 行，经 `index.ts` 的 `invalidateSettingsDisplay`），对应 `cli-update` 规格「连接快照、过期更新与来源作废」的维护期场景。用户 2026-11-17 决定：插件的定位是自动读取 CLI 的账号，CLI 更新后怎么处理登录，插件就怎么处理；CLI 更新不会让用户掉登录，插件也不应因版本变化清掉账号与模型。

## What Changes

- 逐一排查 Antigravity 以外的 16 个 CLI：记录排查时的版本、插件读取登录状态与绑定的来源、新版的实际存放方式，在 Mac 与 Windows 上核对设置页、账号窗口、模型目录、派遣、续聊与退出。
- 有问题的 CLI 在本变更内修复：按 CLI 自己的读取顺序读取，同一账号的绑定不因存放位置变化而改变，补模拟测试；修复需要新的行为规格时追加到本变更。
- CLI 更新结束（成功、失败、取消）或版本指纹变化时，不再作废该 CLI 的账号与模型显示缓存；账号与模型照常按 CLI 自身的登录规则和 10 分钟有效期重读。首次安装结束后仍作废一次，替换缓存中的「未安装」。
- 每个 CLI 的排查结论（无问题、已修复、阻塞及原因）写入 tasks.md。

## Capabilities

### Modified Capabilities

- `cli-update`：修改「连接快照、过期更新与来源作废」，更新与版本变化不作废账号与模型缓存，只在安装结束后作废。

## Impact

- 已改：`src/host/cli-management/service.ts`；测试 `tests/cli-management-admission.test.ts`、`tests/cli-management-phase-b.test.ts`、`tests/cli-management-local-artifacts-windows.test.ts`、`tests/cli-management-install.test.ts`。
- 排查涉及 `src/host/accounts.ts` 及各 CLI 的账号读取模块；具体改动视排查结果而定。
- 真实验证需要各 CLI 的账号；没有账号或订阅的 CLI 写明阻塞。
- 不改变各 CLI 的登录流程，不迁移、写入或删除用户凭据。
