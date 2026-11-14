# Design

## Context

本次只实现 Host 与模拟验收；协议沿用 `src/shared/custom-provider.ts`，前端另行实施。核实日期：2026-11-14。核实过程只读安装源码、公开上游源码和隔离 HOME 下的 `--help` / `--version`，没有读取真实凭据、登录、退出或调用模型。

## Goals / Non-Goals

- 提供按原生能力生成的表单、来源绑定、逐字段校验、原生文件事务与统一缓存失效。
- 不验证远端密钥有效性，不列模型联网，不改变默认模型，不把模拟结果当作实机验收。
- OMP、Kimi、TRAE CN 未核实安全完整写入契约，返回 null，继续原生终端。

## Decisions

### 1. 逐 CLI 证据与取舍

| CLI | 核实依据 | 格式、位置与结论 |
| --- | --- | --- |
| Pi 1.5.2 | 本机 `~/.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-coding-agent/`：`docs/models.md:17-21,43-68`、`docs/models-configuration.md:9-35`；`dist/config.js:510-527`；`dist/core/auth-storage.js:193-224,380-384`；`dist/core/resolve-config-value.js:120` | 支持。`~/.pi/agent/models.json` 的 `providers[id]` 包含 name/baseUrl/api/models；密钥独立存于 `auth.json[id]={type:api_key,key}`，按原生插值语义转义 `$` / `!`。只提供有文档的四种 API，不猜模型上下文或费用。`docs/cli.md:307-312` 的 auth login --api-key 需要交互终端，没有已核实的非交互配置命令，使用原生文件事务。非默认 agent 目录暂回退，以与现有账号扫描来源一致。 |
| OpenCode 1.19.5 | 本机 `/opt/homebrew/lib/node_modules/opencode-ai/package.json:1-10`，隔离 `opencode --version` 返回 1.19.5；[版本标签 config](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/core/src/v1/config/config.ts#L107)、[provider](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/core/src/v1/config/provider.ts#L95)、[auth](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/auth/index.ts#L10) | 支持 v1 原生格式。[Global.Path 源码](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/core/src/global.ts#L9) 确认 XDG 路径；全局 `~/.config/opencode/opencode.json`（已有 jsonc 时保留该文件），provider[id] 使用 npm/name/options.baseURL/models，密钥写入 XDG data 下 `opencode/auth.json[id]={type:api,key}`（0600）。提供 OpenAI compatible / OpenAI / Anthropic SDK 三项固定选择（[打包列表](https://github.com/anomalyco/opencode/blob/v1.19.5/packages/opencode/src/provider/provider.ts#L137)）。当前官网已展示 v2 providers/package/settings，不能套用。原生 auth login 是交互入口，无跨配置和凭据事务，使用原生文件事务；显式配置覆盖或 v2 文件回退/拒绝。 |
| Hermes | 本机源码 checkout `3b42157858`（只读 `git rev-parse --short HEAD`）的 `~/.hermes/hermes-agent/hermes_cli/config_providers.py:38-63,189-260,285-342`；`runtime_provider_custom.py:48-60`；`runtime_provider_missing_key.py:50-61`；`subcommands/config.py:30-40` | 支持已核实的 providers 配置。`config.yaml` 的 providers[id] 使用 api/key_env/api_mode/models；密钥只追加到同 HOME 的 `.env`，配置中仅引用独立变量名。API 为 chat_completions / codex_responses / anthropic_messages。原生 config set 一次只写一个值且 value 进入 argv，不能提供本任务的密钥保护和双文件回滚，采用文件事务。保持 YAML 注释与其他节点、.env 原文字节。尊重 Host hermesHome；未核实命名 profile 时回退。隔离 HOME 启动器 --version 因依赖环境未提交而退出 1，不据此声称运行验收通过。 |
| OMP 18.20.0 | 隔离 `/Users/leeyl/.local/bin/omp --version`、`--help`、`auth --help`、`auth import --help` 全部退出 0；[官方 models 文档](https://github.com/can1357/oh-my-pi/blob/main/docs/models.md#config-file-location-and-legacy-behavior)；现有 `src/host/pi-omp-native.ts:236,261-282` | models.yml / models.yaml 可定义 providers/baseUrl/api/models；凭据存储为 agent.db 的 auth_credentials。原生命令 `auth import <file或->` 是合并操作，无已核实的单项事务撤销接口。不能用 Pi auth.json 或整体替换活数据库冒充安全写入，因此本次返回 null。 |
| Kimi Code 2.6.1 | 隔离 `/Users/leeyl/.kimi-code/bin/kimi --version`、`--help`、`provider --help`、`provider add --help` 均退出 0 | 本机实际是新 Kimi Code，`provider add <url>` 导入远端 api.json registry，API Key 参数是 registry key；不是任意 endpoint 的模型密钥。旧 [kimi-cli config.py](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/config.py#L33) 的 providers/type/base_url/api_key 与 models/max_context_size 不可作为本机版本的写入证据。本次返回 null，未触发 registry 联网导入。 |
| TRAE CN 0.215.0 public | 隔离 `~/.local/share/traecli/current/traex --version`、`--help` 退出 0 | 原生入口显示 `~/.trae/traecli.toml`、`--oss`、`--local-provider lmstudio/ollama`，不能据此推断通用 API Key 服务商结构。返回 null，不把 OSS 能力宣称为任意服务商支持。 |

核实命令使用 Python subprocess argv 数组、临时 HOME / XDG / CLI 配置目录，保留宿主代理变量；未输出任何用户凭据文件。Hermes 版本以本次源码证据为边界，不推断发布版本。

### 表单字段

| 字段 ID | Pi | OpenCode | Hermes |
| --- | --- | --- | --- |
| providerId | 必填服务商 ID | 必填服务商 ID | 必填服务商 ID，同时作为名称 |
| providerLabel | 可选显示名称 | 可选显示名称 | 不提供此字段 |
| baseUrl | 必填，原样保留路径 | 必填，写入 options.baseURL | 必填，写入 providers[id].api |
| api | openai-completions / openai-responses / anthropic-messages / google-generative-ai | @ai-sdk/openai-compatible / @ai-sdk/openai / @ai-sdk/anthropic | chat_completions / codex_responses / anthropic_messages |
| apiKey | 必填 secret | 必填 secret | 必填 secret |
| models | 必填 ID list（1–100） | 必填 ID list（1–100） | 必填 ID list（1–100） |

ID 限定小写字母开头、数字/短横线/下划线，总长不超过 64；显示名称不超过 80。密钥禁止空白/控制字符。Hermes 复用现有账号读取器的有限 dotenv 子集，禁止目录重定向和变量插值；转义后无法被原生/Host 一致读取的密钥返回 apiKey issue，使用原生终端处理，不静默改变密钥。

### 2. 生命周期、授权与来源

Remote 校验 parent、CLI、启用状态、运行任务与清理暂停，写操作遵循宿主执行权限；持有维护读租约及 AccountManager 的同步账号 reservation，拒绝与账号终端、正在读取账号的请求交错。表单 token 仅存内存，绑定 parent、CLI、已记录入口和 revision、写入目标，10 分钟失效、有数量上限，成功消费、父会话关闭及 Host 关闭清理。没有已记录入口时不猜路径。

### 3. 写入与回滚

输入长度有界，检查服务商 ID、名称、http(s) URL（禁止 URL 凭据、query、fragment）、API 枚举、密钥、模型列表。冲突同时检查配置与原生凭据，返回固定逐字段文案，不回显提交值或解析异常。JSON/JSONC 按结构插入新节点，YAML 使用文档节点编辑，保留已有配置字段与注释。所有文件先校验、暂存并 fsync，再 rename；第二个文件失败时从同目录私有备份恢复已提交文件。提交前比较原文字节，外部变化拒绝覆盖；Pi 遵守 auth.json.lock。凭据文件 0600、新目录 0700、其他已有文件权限保留。备份、临时文件不进入插件状态目录或缓存。

成功统一调用 invalidateSettingsDisplay，令账号与模型目录重新读取。该方法先作废内存两槽和来源 revision，再保存展示缓存；若缓存磁盘失败，返回已保存成功及刷新提示，不能把原生文件已落盘误报为未写入。写入本身不启动子进程、不改代理环境、不发事件，不记录请求参数或原生异常。

## Risks / Trade-offs

跨两个原生文件的 rename 不能成为操作系统级单事务：正常异常路径回滚；进程崩溃、断电及回滚时磁盘再次不可写仍有恢复风险。回滚失败保留私有备份并返回固定失败文案，不谎称已恢复。插件 reservation 只约束本 Host；原生外部编辑采用提交前字节比较防止覆盖，无法承诺所有不遵循锁的外部编辑器没有最终竞态。没有后台模型探测，手填模型能力由原生默认处理。

## Migration Plan

无插件持久化迁移、无版本号变更。移除本功能仍可由 CLI 原生工具使用已保存配置。前端与 Desktop 验收保留 tasks 未勾选项，不归档未完成变更。
