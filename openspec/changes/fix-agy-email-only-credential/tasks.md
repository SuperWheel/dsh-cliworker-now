## 1. 实现

- [x] 1.1 `src/host/windows-agy-account.ps1`：`id_token` 未提供邮箱时输出经校验的 `id_token_email`，不输出凭据内容。
- [x] 1.2 `src/host/cli-account-binding.ts`：Windows 无 `principalHash` 时以已登录的安全邮箱标签为 `oauth` 邮箱主体；POSIX 把经 `accountEmail` 校验的 `id_token_email` 交给 `oauthPrincipal`（`sub` 仍优先）。
- [x] 1.3 `src/host/account-identity.ts`：账号标签在 `id_token` 无邮箱时回退到 `id_token_email`。

## 2. 自动检查

- [x] 2.1 `tests/cli-account-binding.test.ts`：POSIX 仅邮箱凭据绑定、大小写与续期稳定、换号变化、5 种缺失/不安全邮箱拒绝；Windows（模拟 `win32`）仅邮箱投影绑定、与 `subjectHash` 主体不同、无邮箱及未登录拒绝。
- [x] 2.2 `tests/account-identity.test.ts`：仅 `id_token_email` 时显示邮箱、`id_token` 优先、不安全值不显示且不泄漏；`tests/agy-windows-account.test.ts`：仅邮箱投影保留标签、无 `principalHash`。
- [x] 2.3 撤掉 1.2/1.3 后 2.1、2.2 中 3 个新用例失败；恢复后相关 6 个测试文件通过，类型检查通过。

## 3. 真实验收

- [ ] 3.1 Windows 实机（agy 1.4.x 凭据只有 `id_token_email`）执行帮助脚本，输出 `authenticated` 与邮箱，不含令牌；CLI Worker 连接 Antigravity 成功。macOS 无 PowerShell 与凭据管理器，未执行；需用户提供 Windows 远程环境并授权。
  - 2026-10-29 Windows：只读帮助脚本输出 authenticated、emailPresent=true，不含令牌；未读取凭据结构，`id_token_email` 单字段条件未核实。Antigravity 模型目录在磁盘清理前后各超时一次，CLI Worker 连接未验证。证据在 `.test-data/windows-remote/full-20261029/`（不入 Git）。
- [ ] 3.2 macOS 本机 agy 1.4.7 的凭据文件目前仍含 `id_token`（10-23 写入），未观察到仅邮箱格式；POSIX 回退只有模拟测试覆盖。
