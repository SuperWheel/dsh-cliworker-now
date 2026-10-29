## 1. 实现

- [x] 1.1 `ownPoolSource` 放行未被选择的环境 Copilot 记录；新增 `selectsProvider` 保守判定。
- [x] 1.2 `assertHermesOwnAccounts` 拒绝改为 `HermesAccountSourceError`；账号终端、状态、续期、绑定分别传出固定原因。
- [x] 1.3 Client 账号终端启动白名单与英文词典补充固定文案。

## 2. 自动检查

- [x] 2.1 `tests/hermes-renewal.test.ts` 新增 5 项：含环境记录时续期并显示已登录；账号终端登录/管理可打开；model、auxiliary、fallback 选择 Copilot 时仍拒绝且原因正确。撤掉修复时 5 项全部失败。
- [x] 2.2 Hermes/账号/绑定/i18n 相关 31 个测试文件通过；`build:preview` 通过。

## 3. 真实验收（未执行）

- [x] 3.1 DSH Desktop 打开 Hermes 登录设置，账号终端出现原生菜单（需正式构建与 Desktop 重启，由主会话执行）。
  - 2026-10-25 合并后新 Host 15:27：账号终端显示 Select provider 菜单，未出现“无法启动账号终端”。续期仍失败，另一原因见 `fix-hermes-bracketed-ipv6-no-proxy`。
- [ ] 3.2 真实 Nous 续期：状态查询触发原生刷新并显示已登录；若服务端拒绝刷新令牌，应显示需重新登录并能打开登录终端（会消耗真实一次性刷新令牌，需用户在 Desktop 操作）。
  - 2026-10-29 核对：2026-10-25 已确认状态显示 Nous 账号登录，选 Nous Portal 后无报错（`doc/tasks.md` 10-25 Hermes 续期小节）。插件自身触发的过期续期要等令牌再次过期，未执行。
