## Context

agy 1.4.7（本机 `strings` 核对）使用 `zalando/go-keyring`：macOS 实现通过 `/usr/bin/security` 读写通用密码，取值时若带 `go-keyring-base64:` 或 `go-keyring-encoded:` 前缀则分别做 base64 / 十六进制解码。内置更新日志说明钥匙串为默认存储，「调用方要求」或「最近一小时记录过钥匙串超时」时改用文件；`/logout` 删除当前存储中的令牌。Windows 版插件已读取同名凭据 `gemini:antigravity`（`windows-agy-account.ps1`）。

## Decisions

### D1 读取方式

`readMacAgyCredential(backend, config, signal)` 以 `captureCatalogMetadata` 运行 `['/usr/bin/security', 'find-generic-password', '-s', 'gemini', '-a', 'antigravity', '-w']`（允许退出码 0、44，15 秒超时，进程范围清理），stderr 丢弃。输出去掉结尾换行后按前缀解码、`JSON.parse`，返回对象；空输出返回 `undefined`（条目不存在）。原文超过 64 KiB、解码或解析失败、其他退出码均抛出固定文本 `MacAgyKeychainError`，不携带输出。

替代方案「只查条目是否存在（不加 `-w`）」否决：能判断登录，但无法得到账号主体，换号时绑定仍会错。

### D2 状态与绑定共用一份解析

`account-identity.ts` 把现有「凭据对象 → 状态」逻辑抽成 `agyIdentityFromCredential(value)`，文件来源（Linux）与钥匙串来源（macOS）共用；`nativeAgyAccountIdentity` 在 `darwin` 上返回钥匙串来源。`cli-account-binding.ts` 在 `darwin` 上以钥匙串对象代替文件内容，`oauthPrincipal` 计算与 `sourceIds: [~/.gemini]` 不变。钥匙串条目只有 `id_token_email`，主体为邮箱，与遗留文件（`sub`）不同；升级后首轮的一次性绑定变化由静默改绑吸收。

### D3 不回退文件

钥匙串条目不存在即未登录。agy 在钥匙串超时后一小时内可能用文件存储，此时插件显示未登录、拒绝启动，属于偏严格的已知限制；反之回退文件会把退出后的遗留凭据当作当前账号，破坏账号隔离。

## Risks / Trade-offs

- [钥匙串访问提示] 条目 ACL 若不信任 `/usr/bin/security`，读取会触发系统提示；用户拒绝时报无法读取。真实验收核对是否弹出。
- [凭据进入 Host 内存] 与原文件读取相同，只在单次读取函数内存在；不写日志、不进入事件或快照。
