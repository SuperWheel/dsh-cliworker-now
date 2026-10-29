## 1. 实现

- [x] 1.1 新增 `src/host/agy-macos-account.ts`：`/usr/bin/security` 参数数组读取、`go-keyring` 前缀解码、固定错误文本。
- [x] 1.2 `src/host/account-identity.ts` 抽出 `agyIdentityFromCredential`；`nativeAgyAccountIdentity` 在 macOS 上读钥匙串。
- [x] 1.3 `src/host/cli-account-binding.ts`：macOS 绑定改读钥匙串，主体计算与来源标识不变。

## 2. 自动检查

- [x] 2.1 `tests/agy-macos-account.test.ts`：参数数组；条目不存在为未登录（遗留文件存在也不回退）；base64/十六进制/明文解码；同一钥匙串账号绑定稳定、不同账号不同（按实测的仅邮箱格式）；其他退出码、超大输出、无法解析报无法读取且不含凭据。
- [x] 2.2 原以文件夹具模拟 macOS 登录的测试改为模拟钥匙串（`tests/cli-account-binding.test.ts` mock 读取函数、`tests/authorized-catalog-windows-agy.test.ts` 合成 `/usr/bin/security` 进程）；换回旧接入代码时 6 个新用例失败。全量 228 文件 4493 通过、13 跳过；类型检查、OpenSpec 严格校验、`build-preview.mjs` 通过。

## 3. 真实验收

- [x] 3.1 macOS 本机：`/logout` 后设置页显示未登录，续聊提示登录且不启动进程。
  - 2026-10-29 核对：2026-10-26 Desktop 复测（`doc/tasks.md`「Desktop 复测：Antigravity 退出期间的状态」）。`/logout` 后钥匙串条目不存在（查询退出码 44），设置页显示「未登录」。续聊被拒，未启动进程；Worker 状态、最近 run 与绑定不变，无新增事件。当时的拒绝文案没说去哪里登录，已由 `guide-agy-account-terminal` 3.2 改为明确登录说明并另行复测。
- [x] 3.2 重新登录原账号后：钥匙串条目存在、未弹出钥匙串访问提示（或记录实际情况）；设置页显示已登录；`agy-11` 原生续接同一会话并答出暗号、无换号说明。2026-10-26 实测：前四项通过；因格式迁移绑定变化一次并显示了旧版改绑说明（已改为静默）。21:46 再次重登（钥匙串条目 21:46:58 新建）后复测：未弹钥匙串提示、设置页「已登录」、静默续接同一会话，钥匙串→钥匙串绑定不变。
