## ADDED Requirements

### Requirement: 绑定不随 CLI 更新与存放位置变化
账号绑定 SHALL 只由账号主体（不提供主体的 CLI 用站点）和路由生成。CLI 版本、安装路径、配置目录、凭据文件的绝对路径及凭据存放方式（文件、钥匙串、自动）MUST NOT 参与绑定。WorkBuddy CN 与 WorkBuddy SHALL 以 CLI ID 加规范站点生成绑定；TRAE CN SHALL 以固定逻辑来源代替授权文件路径；Codex 的钥匙串与自动模式 MUST NOT 把存储方式算入绑定。未改变的既有来源（Codex 文件模式、Kimi 默认槽位、MiMo `xiaomi`、ZCode v1、Pi 带 Key 的凭据）绑定 MUST 与修改前逐字节一致。插件私有账号与 CLI 自身账号之间的来源区分 SHALL 保持不变。

#### Scenario: 桌面端内置 CLI 更新
- **WHEN** WorkBuddy 内置 CLI 版本或应用安装路径变化，站点不变
- **THEN** 绑定不变，执行前重检不报账号变化

#### Scenario: TRAE 登录目录改到 TRAECLI_HOME
- **WHEN** 同一份 TRAE 授权内容从 `~/.trae/cli` 移到 `TRAECLI_HOME` 指定目录
- **THEN** 插件从 `TRAECLI_HOME` 读取，绑定不变

#### Scenario: Codex 钥匙串与自动模式互换
- **WHEN** 同一账号的 `cli_auth_credentials_store` 在 keyring 与 auto 之间切换
- **THEN** 绑定不变；文件模式既有绑定不变

### Requirement: 按 CLI 原生顺序读取登录来源
插件 SHALL 按各 CLI 安装包中的读取顺序判断登录，只检查来源是否存在并读取身份字段，MUST NOT 执行凭据脚本、自行调用 OAuth 刷新接口，或写入、迁移 CLI 的凭据文件。读不懂的凭据格式 MUST NOT 当作明文。

#### Scenario: CodeBuddy 只配置环境令牌或 API Key
- **WHEN** 存在 `CODEBUDDY_AUTH_TOKEN`、settings 中的 `apiKeyHelper` 或 `CODEBUDDY_API_KEY`，且对应的 `*_DISABLED` 开关未打开，没有登录文件
- **THEN** 设置页显示已登录；settings 按用户、项目、项目本地合并，项目级站点覆盖用户级

#### Scenario: TRAE 设置了 TRAECLI_HOME
- **WHEN** `TRAECLI_HOME` 非空
- **THEN** 从其中的 `auth.json` 读取，否则用 `${TRAE_HOME:-~/.trae}/cli/auth.json`

#### Scenario: ZCode 凭据迁移到 v2
- **WHEN** 同一账号的凭据由 `enc:v1:` 迁移为 `enc:v2:env:` 且密钥可得
- **THEN** 登录状态与绑定都不变；无法解密时显示不可用

#### Scenario: ZCode OAuth 登录没有旧绑定 Key
- **WHEN** `auth-source` 为 oauth（或按原生规则推断为 oauth）
- **THEN** 不需要旧绑定 Key 即确认身份；同一身份已有绑定 Key 时继续用于模型目录与执行，没有时提示项目访问令牌查询尚未支持

#### Scenario: Hermes 共享文件含嵌套 renewal
- **WHEN** 顶层状态属于其他身份、嵌套 `renewal` 属于当前账号
- **THEN** 采用嵌套状态，并按 JWT `iat`、`obtained_at`、到期时间判断轮换先后

#### Scenario: 只登录 MiMo Token Plan
- **WHEN** auth.json 只有 `xiaomi-token-plan-sgp`
- **THEN** 显示已登录，模型目录使用新加坡集群地址

#### Scenario: Kimi 使用自定义槽位或令牌可续期
- **WHEN** Kimi 登录存放在非默认槽位，或访问令牌过期但有刷新令牌
- **THEN** 状态、凭据、文件指纹与绑定使用同一槽位；可续期时提示在原生终端执行 `/usage` 后重试，不显示未登录；撤销标记仍为未登录

#### Scenario: Codex 钥匙串模式的 API Key 登录
- **WHEN** 顶层 `cli_auth_credentials_store` 为 keyring 或 auto（含带引号键），账号以 API Key 登录
- **THEN** 经原生只读状态接口取得 Key 并立即摘要后绑定

#### Scenario: Pi 只带 env 的凭据
- **WHEN** Pi 1.5.2 的 API 凭据省略 `key` 只带 `env`，或 `key` 为 `${VAR}` 模板
- **THEN** 视为已配置，模板按凭据私有 env、进程 env 的顺序解析；引用变量缺失时显示未配置并说明原因
