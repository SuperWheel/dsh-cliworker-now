# Design

## Context

本变更对应 REQ-0138 和 PRD 的背景第 8 条、方案第 8 条、需求明细第 10 条及风险第 8 条。[需求快照](../../../doc/prd/2026-11-19-v0.9.2-REQ-0138.md) · [PRD](../../../doc/prd/2026-11-19-v0.9.2-dsh-rc5-names-omp-PRD.md)

- `src/host/custom-provider.ts:18` 的 `Supported` 仅有 `pi`、`opencode`、`hermes`、`zcode`，`form()` 从协议表筛选，其他 CLI 返回 `null`。`src/host/service-accounts.ts` 的表单与保存入口也分别维护这四种 CLI 的名单。`accounts-window.tsx` 已根据表单描述切换卡片文案和继续后的界面，`provider-form.tsx` 负责通用字段渲染。[Host 表单](../../../src/host/custom-provider.ts) · [账号 Remote](../../../src/host/service-accounts.ts) · [账号窗口](../../../src/client/account-login/accounts-window.tsx) · [通用表单](../../../src/client/account-login/provider-form.tsx)
- 原归档在 OMP 18.20.0 上确认凭据存于 `agent.db` 的 `auth_credentials` 表，`auth import` 是合并操作，当时未核实可撤销的单项写入，因此返回 `null`。[原表单方案](../../archives/vnext-custom-provider-form-leeyl/design.md#L11) · [ZCode 自有密钥方案](../../archives/v0.9.0-zcode-custom-key-leeyl/design.md)
- `pi-omp-native.ts:266` 读取 OMP 的 `models.yml`，约 390–401 行以 `provider.apiKey` 等字段判断本地配置并读取 OMP 配置根的 `.env`，约 510–542 行合并全局与插件来源及鉴别凭据，约 750 行将合并后的 `providers` 写入 Worker 快照的 `models.yml`。配置存在的信号与 Worker 实际能够解析的凭据是两项不同证据。[OMP 来源读取](../../../src/host/pi-omp-native.ts)

## Goals / Non-Goals

- 账号窗口、Gateway 和 Host 沿用通用表单及提交链路。持久源是账号终端使用的插件 OMP 目录，Worker 依照现有快照链路消费。
- 图形表单只负责显式输入的 API Key 与模型 ID。原生终端继续承接 OAuth、命名 profile、远端服务商发现及其他未核实的配置方式。

## Decisions

### 决定 1：按 OMP 入口与版本核实启用条件

- 最终决定：仅当已记录的 OMP 入口、实际版本、读取来源与下文的生成格式均通过核实，`form()` 才发出表单和票据。打开表单只读，返回 `null` 时用脱敏原因区分入口不明、版本未核实、来源或文件不安全。任务 1 保留实证门槛，未通过则延续原生终端；后续升级或替换入口时按有效能力重新判定。
- 放弃的方案：仅凭版本号或插件能读取 API Key 就启用。插件的识别逻辑无法证明原生模型目录加载、密钥解析与文件写入的完整契约。
- 影响：现有「其他服务商」卡片可直接消费 `null`；服务商专用组件或新 Gateway 协议均无必要。启用分支同时接入 Host 表单与保存入口，沿用原生终端备选。

| OMP 18.22.0 契约 | 本次核实结果 |
| --- | --- |
| 本机版本 | 用空的 `/var/empty` 作为隔离 `HOME`、XDG 目录和 `PI_CODING_AGENT_DIR`，清空继承环境后执行 `/Users/leeyl/.local/bin/omp --version`，输出 `omp/18.22.0`，退出 0。 |
| 文件、字段及可用 API | 版本标签文档确认默认依次读取 `models.yml`、`models.yaml`，两者均缺失时才迁移 `models.json`；自定义配置使用 `providers.<id>` 下的 `baseUrl`、`api`、`models`、`apiKey`。文档列出下表的四个 API 值；校验源码要求自定义模型拥有 `id` 和有效 API，服务商提供 `baseUrl` 与相应凭据。文档确认 `auth: apiKey` 使 Anthropic 请求采用普通 API Key 形式。 |
| 密钥表示及凭据优先级 | 版本标签文档确认普通 `apiKey` 先作为环境变量名查找，缺失或为空时以原字符串作为密钥；`!` 前缀另有命令解析语义。优先级为运行时覆盖 → YAML 显式配置 → 已存 OAuth → 登录写入的 API Key → 扩展配置回退 → 环境映射 → 其他已存 API Key。版本标签的注册表将 YAML 密钥注册为配置覆盖，`AuthStorage` 的源码注释也确认它在存储层之前。该顺序意味着同 ID 会遮蔽 `agent.db` 中的既有登录，新增必须查重。 |
| 实施前待核实 | 当前构建对表单生成 YAML 的本地原生读回、所提协议在最小模型条目下的可见性、字面密钥与最终生效环境同名时的处理，以及空库／同 ID 合成凭据的实际选择，均未做实证。`cascade.ts` 和 schema bundle 未取得可用版本标签正文。命名 profile、显式目录和 broker 等覆盖来源也未核实。 |

证据以版本标签为准。[OMP v18.22.0 模型文档](https://github.com/can1357/oh-my-pi/blob/v18.22.0/docs/models.md) · [配置校验](https://github.com/can1357/oh-my-pi/blob/v18.22.0/packages/coding-agent/src/config/models-config.ts#L115-L190) · [密钥注册](https://github.com/can1357/oh-my-pi/blob/v18.22.0/packages/coding-agent/src/config/model-registry.ts#L2189-L2195) · [AuthStorage](https://github.com/can1357/oh-my-pi/blob/v18.22.0/packages/ai/src/auth-storage.ts#L1-L19)

### 决定 2：使用 OMP 原生字段映射通用表单

- 最终决定：按下表生成 `models.yml`，API 选项由 Host 对 OMP 独立声明，最终只发出通过任务 1 的选项。标签作为插件展示数据保存在现有归属回执的可选非秘密字段中，读取仅对归属匹配的插件条目生效，旧回执可继续读取。
- 放弃的方案：套用 Pi 的 `auth.json`、把服务商名称当作 OMP 原生 `providers.<id>.name`，或把密钥写为 `.env` 变量引用。Pi 凭据格式与 OMP 不同，服务商层 `name` 的原生支持未核实，环境变量缺失又会触发原生字面回退。
- 影响：账号窗口可显示用户填写的名称，空名称使用服务商 ID。模型选择仍按原生精确的 `provider/modelId`；既有归属校验与删除入口沿用现有逻辑，删除时随同回执清理对应标签。

| 表单字段 | 目标及校验 |
| --- | --- |
| 服务商 ID `providerId` | 必填，写作 `providers.<id>` 的键。沿用 `^[a-z][a-z0-9_-]{0,63}$`，拒绝保留键，按决定 3 检查冲突。 |
| 名称 `providerLabel` | 可选，最长 80 字符，拒绝控制字符。写入插件归属回执作为显示名称，用于查重及展示。 |
| Base URL `baseUrl` | 必填，写入 `providers.<id>.baseUrl`。仅接受通用表单可校验的绝对 HTTP(S) URL，拒绝内嵌用户凭据，保留服务商指定路径，避免自动拼接 `/v1`。 |
| API 协议 `api` | 必填，写入 `providers.<id>.api`。拟提供 OpenAI Chat Completions（`openai-completions`）、OpenAI Responses（`openai-responses`）、Anthropic Messages（`anthropic-messages`）、Google Generative AI（`google-generative-ai`）。显式设置 `auth: apiKey`，尤其适用于 Anthropic。 |
| API Key `apiKey` | 必填，使用 secret 控件，原值作为 YAML 字符串写到 `providers.<id>.apiKey`。拒绝空白、控制字符、占位符、命令前缀 `!`、变量引用形式及会被插件当成环境名的全大写标识符。任务 1 须证实所接受格式在最终 OMP 环境中按原值生效，并能防止环境变量同名替换；无法保证的值逐字段拒绝，契约整体无法确认时表单保持 `null`。 |
| 模型 ID `models` | 一行一个精确 ID，1–100 项，拒绝空值、重复和控制字符。写为 `providers.<id>.models[]` 的对象 `{id, name: id}`，继承服务商 API，并沿用原生的现有元数据处理。 |

### 决定 3：限定插件持久目标并在事务内防止覆盖

- 最终决定：目标使用 `piOmpAccountDirectory('omp', stateDirectory)`，即 `<stateDirectory>/accounts/omp/agent`。原生配置改动限定为该目录的 `models.yml` 中新增一个 `providers.<id>` 节点，归属回执 `cliworker-created-providers.json` 一并提交。全局目录仅用于查重和来源核对；表单事务不碰任何 `agent.db`、`.env`、登录命令或 Worker 临时快照。对会受 `models.yaml`、旧 `models.json`、profile、重定向、broker 或其他覆盖影响且无法可靠判定的目标，返回 `null` 并记录原因。
- 放弃的方案：调用 `auth import`、直接写 SQLite、迁移旧文件或使用全局目录作备选。它们需要额外的写入和恢复契约，也可能影响已有登录。
- 影响：复用 Host 的权限、维护读租约、账号活动检查和账号保存 reservation。表单票据绑定父会话、CLI、入口及 revision、已核实契约和目标，沿用十分钟有效期、成功即消费及父会话／Host 关闭清理。保存前和提交前重检权限、票据、来源与文件状态，拒绝不安全链接、不可安全编辑的 YAML 和不满足私有权限的目标。

查重在写入前通过同一生效来源完成，覆盖插件与全局的服务商及凭据所属 ID、已核实的内置目录和插件保留 ID。显示名称按去首尾空白、大小写不敏感的口径核对已有有效标签，名称缺省时以 ID 计。仅使用查重所需的 ID 与显示数据，拒绝无法可靠建立冲突集合的来源；该步骤不会查询用户密钥的远端有效性。发现冲突时返回对应的 `providerId` 或 `providerLabel` 字段错误，绝不通过合并优先级替换原服务商。

YAML 结构化编辑保留其他节点与注释，拒绝重复键、别名或无法安全往返的结构。复用 `commitNativeFiles` 以同目录受保护临时文件和私有备份暂存、同步，再原子替换并独立回读内容与权限。POSIX 下新建私有目录为 `0700`，包含凭据的 `models.yml`、回执、临时文件与备份为 `0600`。发生中途失败时恢复提交前内容与权限，原先缺失的文件在回滚时移除。若外部写入已替换本次结果，则保留外部内容及可用的私有备份，向用户返回脱敏冲突原因。密钥只经现有提交接口到达 Host 和受保护的原生文件，原值不得进入回执、表单描述、提交结果、日志、票据或账号／模型展示缓存。[事务实现](../../../src/host/custom-provider-files.ts) · [归属回执](../../../src/host/custom-provider-managed.ts)

### 决定 4：从实际账号来源刷新账号与模型目录

- 最终决定：保存和回读成功后走现有 Host 展示缓存失效和 Client `onSaved` 重新读取路径，恢复读取到本地配置的服务商、账号状态及声明模型；刷新失败时区分已保存和未刷新，允许重新读取。刷新使用现有本地目录能力，不触发模型调用。
- 放弃的方案：将表单提交内容直接作为界面上的账号/模型证据，或同时写入运行快照。真实来源可能和输入不同，快照由 Worker 运行准备创建并按现有生命周期管理。
- 影响：新快照沿用 `withSources`、`mergeSources` 和 `snapshotPiOmpNative`，先读全局、后读插件，插件同 ID 覆盖全局的服务商定义，其余全局条目仍可用。快照中的 `models.yml` 继承该有序合并结果。原生密钥选择顺序与 Host 文件来源的合并顺序分别核实，刷新和快照证据均只证明本地配置可读。

## Risks / Trade-offs

- OMP 更新、配置重定向或密钥解析变化 → 新入口及未知来源回退原生终端，按第一个主任务补齐证据后再启用。
- YAML 的显式密钥可能覆盖已有登录，或把输入当作命令或环境变量 → 保存前查重并限制可安全表示的字面值，合成样本比对两端解析。选择原生终端处理超出表单契约的输入。
- 多文件提交与外部编辑交错 → 使用已有事务核对写入前内容，回读失败时只回滚本事务仍占有的文件。写入和读回均保留脱敏证据。
- 账号摘要已显示配置而模型目录未收录 → 分别核对账号、模型和 Worker 快照，刷新错误单独反馈。实机验收用虚构服务商，无远端有效性结论。

## Migration Plan

- 安装沿用现有插件流程。通过安全门槛后才提供新表单；现有 OMP 配置不做批量迁移。需要回退时撤回该版本的表单能力，账号窗口继续原生终端。已保存的插件目录文件沿用现有读取和归属管理。
- Mac Desktop 验收采用隔离来源、写前备份、独立回读和验后恢复，记录私有路径及实际证据。所有实施检查以 [tasks.md](tasks.md) 为准。
