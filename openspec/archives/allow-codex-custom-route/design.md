## Context

`readCliAccountBinding` 以「CLI + 来源 ID + 不含秘密的主体」计算 `cli-account-v1:<sha256>`，供选型、启动、出队、续聊核对；变化时按 `continue-tasks-across-account-changes` 自动改绑续接。Codex 原先只在官方文件账号或 keyring ChatGPT 登录下给出主体，自定义路由一律拒绝（`requireDefaultCodexRoute`）。

Codex 执行与 `app-server` 都读取 `CODEX_HOME/config.toml` 及项目各级 `.codex/config.toml`，派遣 argv 不覆盖 provider（`adapters.ts`）。模拟中转核对见 proposal。

## Goals / Non-Goals

- 目标：中转用户无需改配置即可派遣；绑定仍能察觉路线或密钥改变。
- 非目标：识别中转站账号、额度或可用模型；解析 TOML 语义。

## Decisions

1. **路线检测沿用原有判定**：原 `requireDefaultCodexRoute` 的配置行匹配改为布尔判定 `codexCustomRoute`，不新增解析。只看配置文件：DSH Host 继承的 `OPENAI_API_KEY` 等变量按既有规则不是 Codex 自身凭据证据，单独出现时仍拒绝；配置声明路由后，这些变量只进入指纹。
2. **指纹而非身份**：中转没有可核验的账号主体，以配置、相关环境变量、`auth.json` 原文的摘要作为来源版本。`env_key = "NAME"` 只用正则取变量名并纳入其值摘要，未解析其他字段。代价是修改 config.toml 任何内容（如默认模型）也会被视为换号；由于换号自动续接，影响仅是一次静默改绑。
3. **目录用 Codex 自身清单**：自定义路由时跳过 `probeAccountModels`，返回 `readCodexNativeModels` 结果并把费用标为未知；前后两次读取路线指纹，不同则报错。
4. **env_key 透传**：DSH 子进程从净化环境启动，配置 `env_key` 指定的变量不会自动到达 Codex。派遣与分支启动时，只传自身配置声明且宿主进程中存在的这些变量。DSH Desktop 可能不继承终端环境，文档建议把中转密钥写进 Codex 的 `auth.json`。
5. **keyring 存储**：自定义路由下不读 keyring，来源 ID 附 `native-store:<store>`；keyring 中密钥变化不会改变指纹，属已知边界。

## Risks / Trade-offs

- Codex 自带清单可能含中转不支持的模型：选中后由 Codex 原生错误说明，不由插件预判。
- 放宽了「自定义配置需账号证据」的规则，仅限 Codex 自身配置；其他 CLI 与通用环境凭据规则不变。
- 回退：恢复 `requireDefaultCodexRoute` 拒绝分支即可，不涉及存储迁移。
