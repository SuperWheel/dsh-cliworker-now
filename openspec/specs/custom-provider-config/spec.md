# custom-provider-config Specification

## Purpose
规定 Pi 与 OMP 账号窗口中「其他服务商」的图形化配置：表单新建、归属记录、原生配置文件中服务商的删除与备份回滚，以及环境变量来源保持只读。

## Requirements

### Requirement: 其他服务商图形化配置
对 Host 已核实原生自定义服务商格式的 CLI，账号窗口「其他服务商」SHALL 打开由 Host 表单描述驱动的图形化配置；字段、选项与写入位置 MUST 来自该 CLI 的原生能力，MUST NOT 套用其他 CLI 的格式或猜测字段。未核实的 CLI SHALL 继续只提供原生终端。

#### Scenario: 支持的 CLI 选择其他服务商
- **WHEN** 用户在 Pi 等已核实 CLI 的「添加账号」中选择「其他服务商」并继续
- **THEN** 界面 SHALL 显示与登录窗口一致的服务商表单，并保留「在原生终端中配置」备选入口

#### Scenario: 不支持的 CLI
- **WHEN** Host 对该 CLI 不返回表单描述
- **THEN** 「其他服务商」SHALL 保持现有原生终端行为

### Requirement: 自定义服务商写入与凭据保护
Host SHALL 在写入前校验名称唯一性、URL 协议与必填字段，并按原生格式写入；API Key MUST 只写入该 CLI 原生凭据位置，MUST NOT 回显、记录日志或进入设置缓存快照。写入失败 SHALL 保持原配置不变。写入成功后 SHALL 作废该 CLI 的账号与模型目录缓存。

#### Scenario: 写入成功
- **WHEN** 用户提交有效表单
- **THEN** Host SHALL 原子写入原生配置，返回不含密钥的结果，并让设置页重新读取账号与模型目录

#### Scenario: 名称冲突或校验失败
- **WHEN** 名称与已有服务商冲突，或 URL、必填项无效
- **THEN** Host SHALL 拒绝写入并给出逐字段原因，原配置 MUST 保持不变

### Requirement: Pi 表单使用插件生效账号来源
Pi 新增服务商 SHALL 写入与账号登录一致的 `<stateDirectory>/accounts/pi/agent` 持久目录，使用原生 models.json 和 auth.json 格式，MUST NOT 写入 Worker 临时快照或修改全局 `~/.pi/agent`。表单 target SHALL 展示实际写入路径；Host SHALL 将目标绑定到票据，并在保存时重新核对。全局与插件来源的已有 ID/名称冲突 SHALL 被拒绝，MUST NOT 通过新增条目遮蔽已有账号。

#### Scenario: 插件账号存在或首次添加
- **WHEN** 用户在 Pi 表单添加未冲突的服务商，无论插件账号文件是否已存在
- **THEN** Host SHALL 保存到插件持久账号目录，后续 Worker 账号快照 SHALL 能读取该服务商，全局原文 MUST 保持不变

#### Scenario: 来源变化或目录不安全
- **WHEN** 打开表单后目标来源改变，或写入目录/文件为不安全链接、账号锁被占用
- **THEN** Host SHALL 拒绝保存，MUST NOT 回落到全局目录写入；双文件失败回滚与凭据保护 SHALL 保持有效

### Requirement: Hermes 表单跟随 Worker 生效 HOME
Hermes 表单 SHALL 与 Worker 使用同一生效 HOME 选择器，target SHALL 显示实际 config.yaml 和 .env 路径。原生 HOME 与插件 HOME MUST 按来源 marker 单选，MUST NOT 合并或修改未生效来源。Host SHALL 在保存及提交阶段核对来源变化，保留同 HOME 的重名/变量冲突检查、dotenv 子集一致性、providers 新建、0600 和回滚约束；HERMES_PROFILE 非空时 SHALL 回退原生终端。

#### Scenario: 插件来源已选中
- **WHEN** marker 选择插件 HOME，包括其中原生账号文件尚不存在或已删除的情况
- **THEN** 表单 SHALL 写入该私有 HOME；Worker 运行准备 SHALL 读取该 HOME 中的配置和凭据，MUST NOT 回落全局目录

#### Scenario: 来源变更或不安全
- **WHEN** 表单打开后 marker 改变，或 marker/账号路径损坏或为不安全链接
- **THEN** Host SHALL 拒绝旧表单或回滚正在提交的写入，MUST NOT 自动修改新来源

### Requirement: OpenCode 表单写入优先账号来源
OpenCode 表单 SHALL 写入 Worker 最后合并的插件持久配置目录及账号登录共用的插件凭据目录，target SHALL 展示实际路径。Host SHALL 检查全局 XDG config.json、opencode.json、opencode.jsonc、auth.json 与插件目标中的已有服务商 ID/名称冲突，MUST NOT 遮蔽已有账号或修改全局文件。凭据 MUST NOT 出现在模型配置、票据或展示缓存中。

#### Scenario: 新服务商可被 Worker 读取
- **WHEN** 用户提交无冲突的 OpenCode 服务商
- **THEN** 插件持久配置与凭据 SHALL 进入 Worker 按原有合并顺序生成的配置/账号快照，全局原文 MUST 不变

#### Scenario: 来源或格式不确定
- **WHEN** 全局来源 XDG 路径改变、插件 json/jsonc 同时存在、配置为未核实版本或目标为不安全链接
- **THEN** Host SHALL 拒绝保存或回退原生终端，MUST NOT 猜测写入来源

### Requirement: 通用服务商表单模板
Client SHALL 以单一表单模板渲染 Host 表单描述，样式、间距与控件遵循 doc/settings-ui-design.md 和现有登录窗口；同类菜单 SHALL 复用该模板而不是各自实现。

#### Scenario: 复用模板
- **WHEN** 另一 CLI 提供表单描述
- **THEN** 界面 SHALL 使用同一模板渲染，不需要该 CLI 专用组件

### Requirement: ZCode 自有 API Key 服务商表单
ZCode 账号窗口「添加账号」SHALL 在 Host 返回表单描述时提供「其他服务商」，字段为名称、接口类型、Base URL、API Key、模型 ID 列表和可选上下文窗口。Host MUST 只写插件账号目录 `.zcode/v2/provider_config.json`，格式与 ZCode 桌面端自定义服务商一致，MUST NOT 修改全局 `~/.zcode/v2/provider_config.json`。写入 SHALL 原子替换、权限 0600、与归属记录一起提交，失败回滚。名称 MUST 在全局、插件与内置目录中不重复。

#### Scenario: 订阅过期后添加自有密钥
- **WHEN** 用户在 ZCode「添加账号」选择「其他服务商」并提交有效表单
- **THEN** Host 只写插件账号目录文件（0600），全局文件逐字节不变，结果不含密钥，设置页重新读取账号与模型目录

#### Scenario: 名称冲突
- **WHEN** 名称与 ZCode 桌面端全局配置、插件配置或内置目录中的服务商重名
- **THEN** 拒绝写入并在名称字段说明原因，两个文件均保持不变

#### Scenario: 无原生终端入口
- **WHEN** 用户打开 ZCode「其他服务商」表单，或使用不提供表单的旧 Host
- **THEN** 表单不显示「在原生终端中配置」；旧 Host 下「添加账号」只列 BigModel 与 Z.AI

#### Scenario: 写入中途失败
- **WHEN** 服务商文件或归属记录的替换失败，或表单票据过期、来源改变
- **THEN** 已替换的文件回滚为原内容，返回不含路径细节和密钥的失败原因

### Requirement: ZCode 服务商账号行
ZCode 账号窗口 SHALL 列出两个个人配置中已启用、可见且带 API Key 的服务商，只显示安全名称、API Key 方式与所在位置（ZCode 原生目录或插件目录），MUST NOT 返回密钥、Base URL 或请求头。插件创建且内容与归属记录一致的服务商 SHALL 提供「删除」，确认后原子删除该服务商、其模型规则、排序项与归属记录，失败回滚；全局文件中的服务商与内容已被改动的插件条目 SHALL 只读，标注「在 ZCode 桌面端管理」。BigModel／Z.AI 订阅登录 SHALL 保留原引导式退出。订阅已过期但存在自有 API Key 服务商时，账号状态 SHALL 显示为已配置 ZCode API，不显示为未登录。

#### Scenario: 删除插件创建的服务商
- **WHEN** 用户删除插件目录中由表单创建的服务商
- **THEN** 只删除该条目及其模型规则和归属记录，其余插件条目与全局文件不变，账号与模型目录刷新

#### Scenario: 全局或被改动的条目
- **WHEN** 条目来自全局文件，或插件条目内容与归属记录不一致
- **THEN** 不提供删除按钮，Host 也拒绝对应删除请求且不改动任何文件

### Requirement: 服务商表单内置模板预填
Host MAY 在表单描述中提供内置模板，只包含非秘密字段的值。Client SHALL 在模板存在时于表单顶部显示「从内置模板预填」选择；选择后只填入表单已有的非秘密字段，API Key MUST 保持用户自行填写，模板选择本身 MUST NOT 随表单提交。ZCode 的模板 SHALL 来自已安装 CLI 内置目录中 `api-key` 类型、接口类型受支持且不带自定义请求头的模板，停用的模板模型不预填。

#### Scenario: 选择模板
- **WHEN** 用户在 ZCode 表单中选择内置模板 DeepSeek
- **THEN** 名称、接口类型、Base URL 和模型 ID 被填入且可修改，API Key 为空，提交内容不含模板字段

#### Scenario: 没有模板
- **WHEN** Host 未提供模板或模板格式无效
- **THEN** 不显示模板选择或忽略无效模板，表单其余部分照常可用
