## 背景

见 proposal。核心是原生 Hermes 的行为与插件守卫不一致：原生在 `gh` 已登录时会把环境 Copilot 记录写进任何 HERMES_HOME（包括插件自身账号目录），插件把这条无令牌、未被选择的记录当成外部账号，导致账号终端与续期同时失效。

## 方案

1. 放行条件严格对应原生 `_seed_copilot_singleton` 写入的形态：provider `copilot`、source `gh_cli`、auth_type `api_key`。
2. 是否“被选择”采取保守判定：`auth.active_provider` 或 `config.yaml` 中任意字符串值（含嵌套对象与数组）等于 `copilot`（忽略大小写和首尾空白）即视为已选择，仍然拒绝。这覆盖原生 `_config_selects_provider` 的 model、auxiliary、MoA 槽位，也覆盖 `fallback_providers`；无法确认的结构按已选择处理。
3. 守卫错误使用固定文案的 `HermesAccountSourceError`：
   - 账号终端启动：原样抛出；Client 白名单显示该文案（Client 只显示插件自有固定文案）。
   - 状态：`unavailable` + 原因 + 账号操作入口。
   - 续期：不再改写成 `unavailable`（“稍后刷新”），原样传出。
   - 账号绑定：转为 `CliAccountBindingError(cli, 原因)`，保留 `CLI_OWN_ACCOUNT_REQUIRED` 合约。

## 取舍

- 不选择“允许账号终端在外部来源存在时打开”：会扩大原有边界，且原生登录菜单每次运行都会再次写入该记录，治标不治本。
- 不选择“在插件进程中隐藏 `gh`”：需要改写 PATH 或拦截原生命令，属于附加隔离，与“使用原生保护”约定不符，且影响用户在终端中的其他操作。

## 风险与回退

- 风险：用户日后在插件账号中选择 Copilot 时，记录仍会被拒；这是既有的外部账号规则，提示会说明原因。
- 回退：删除 `ownPoolSource` 中的 Copilot 分支即可恢复原有拒绝行为；错误类型改动向后兼容。
