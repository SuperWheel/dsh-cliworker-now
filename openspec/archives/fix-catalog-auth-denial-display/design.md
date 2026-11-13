## Context

- `probeAccountModels` 返回 `{state, denialReason}`；`denied('authentication')` 只在服务商明确返回 401/403 或认证错误码时出现。
- Pi/OMP 的目录在桥接子进程的 account-scope 阶段计算（`accountSupportedChoices`），以 JSON 数组输出；Host 端 `confirmedCatalog` 解析后返回 `ModelChoice[]`，`catalogFor` 对空数组统一抛「暂无可用模型」。
- OMP 原生在凭据认证失败后会记录 `auth_credential_blocks`（block_scope `auth`），说明原生也会避开失效凭据；Windows 现场新旧两条凭据中旧的一条被封锁。

## Decisions

### D1 失效凭据不参与交集
同一服务商路由的各凭据范围中，`state=denied` 且 `denialReason=authentication` 的凭据剔除；剩余至少一条且全部为 `supported` 时，按剩余凭据求交集。任何一条为 `unknown`（网络、超时、无法解析）或其他拒绝原因时，仍不显示该服务商的模型。全部凭据都认证失败时不显示模型，并报告认证失败。

取舍：执行时 OMP 仍可能先选到失效凭据，这条请求会失败一次，之后原生会封锁该凭据。界面因此提示用户在账号窗口退出失效凭据，这是彻底消除风险的方式。插件不自动删除或封锁凭据。

### D2 原因通过统计数字传递，不传凭据信息
`accountSupportedChoices` 接收可选的 `report` 对象，累计 `authenticationDenied`（被拒绝的凭据数）和 `excluded`（被剔除、但仍有模型的凭据数）。桥接在 account-scope 阶段输出 `{phase:'account-scope', models, authenticationDenied, excluded}`；Host 的 `parseCatalog` 同时接受旧的数组格式。统计只含计数，不含服务商密钥、账号或邮箱。

### D3 提示文本
- 目录为空且有凭据认证失败：`<CLI> 账号认证失败，请在账号窗口重新登录或退出失效凭据后刷新`（Pi/OMP/OpenCode 通用，由 discover 函数直接抛出）。
- 有模型但剔除了凭据（Pi/OMP）或有服务商认证失败（OpenCode）：目录 notice 为 `当前账号可用模型；已跳过 <n> 条认证失败的凭据，可在账号窗口退出`。
- `extendedCatalog` 返回的模型数组通过模块内 WeakMap 附带 notice，`catalogFor` 读出后放入 `Catalog.notice`；设置页在 notice 含「认证失败」时显示在模型下方。

## Risks

- 见 D1：剔除失效凭据后，执行可能偶发一次 401。由提示引导用户退出失效凭据。
- account-scope 输出格式变化：Host 与桥接同包发布；`parseCatalog` 兼容数组，旧测试夹具不受影响。
