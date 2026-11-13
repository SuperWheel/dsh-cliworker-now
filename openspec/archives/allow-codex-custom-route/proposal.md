## Why

用户反馈（2026-10-27）：Codex 通过第三方中转站使用（`~/.codex/config.toml` 设置 `model_provider` 与 `[model_providers.<name>]`，指向中转地址）。命令行直接运行 `codex exec` 正常，但通过插件 `cliworker_start(cli: "codex")` 派遣时立即报「Codex 无法确认当前自身账号，请检查该 CLI 的登录或 API 配置」。

既有实现（`src/host/cli-account-binding.ts`）：

- `requireDefaultCodexRoute` 只要在 Codex 配置中看到 `model_provider`、`model_providers`、`openai_base_url`、`chatgpt_base_url`、`profile`/`profiles`，或环境中有 `CODEX_API_KEY`、`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`CODEX_BASE_URL`、`CHATGPT_BASE_URL`、`CODEX_PROFILE`，就抛出 `CliAccountBindingError`，账号绑定与模型目录都失败。
- `readCodexOwnAccountSource` 只认官方 API Key（api.openai.com）与 ChatGPT 登录（chatgpt.com）两种来源；`discoverCodexModels` 以此向官方查询账号模型范围。
- 派遣参数（`src/host/adapters.ts`）不覆盖 provider，Codex 本身会读取用户的 config.toml，所以中转路由在执行时本来就生效；拦截只来自插件自己的两道检查。`doc/usage-details.md` 记载「keyring 或自定义路由缺少范围证据时不放行」。

本机核对（2026-10-27，Codex CLI 0.162.1，隔离 `CODEX_HOME` 与本机模拟中转）：`codex exec` 经模拟中转正常完成，请求为 `POST /v1/responses`，带 Bearer；同一配置下 `app-server` 的 `model/list` 仍返回 Codex 自带的 8 个模型及强度，不访问中转的 `/v1/models`。

## What Changes

- **账号绑定**：Codex 自身配置文件声明自定义路由时不再拒绝；只有宿主继承的路由环境变量（未在自身配置中声明）仍按继承凭据拒绝。账号来源版本改为「本条中转路线」的指纹：适用的 Codex 配置文件内容、上述路由环境变量及配置中 `env_key` 指向的环境变量的值、`auth.json` 内容，全部只取 SHA-256 摘要参与绑定，不保存、不返回原文。任一项变化视为换号，沿用「换号后自动续接」。
- **模型目录**：自定义路由时不向 OpenAI 官方查询账号范围，直接使用 Codex 自身 `model/list` 返回的模型与强度（与 Codex `/model` 一致），费用标为未知；中转站是否支持某模型由 Codex 执行时的原生报错说明。查询前后核对路线指纹，变化则报错要求刷新。
- **执行**：派遣参数不变，继续由 Codex 读取用户自己的配置。插件启动的进程使用净化后的环境，配置 `env_key` 指定的变量若在宿主进程中存在，则只把这些变量传给 Codex（本机模拟确认不传时 Codex 报 `Missing environment variable`）。
- 官方 API Key 与 ChatGPT 登录路径不变。

## 范围外

- 不解析中转地址、协议或服务商名称，不向中转站探测模型或额度，不给 Codex 追加 `-c model_provider` 等参数。
- 不修改用户 Codex 配置或凭据；不为中转站单独做登录界面。
- 不把配置中的 `model` 补进候选（Codex 自身目录不含时，用户仍可在原生配置中使用，但插件不猜测其强度）。

## 能力域与影响

- `cli-account-isolation`：新增「Codex 自身自定义路由」要求。
- `cli-model-discovery`：新增「Codex 自定义路由模型目录」要求。
- Host：`cli-account-binding.ts`、`codex-models.ts`。Client、协议、安装入口不变。
