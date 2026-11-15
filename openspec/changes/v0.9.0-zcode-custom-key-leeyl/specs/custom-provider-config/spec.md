# Spec Delta

## ADDED Requirements

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
