# Proposal

## Why
用户的 ZCode 订阅（BigModel／Z.AI）过期后，想改用自己的 API Key 继续通过 CLI Worker 使用 ZCode CLI 0.17.1，但目前有四处阻碍：

- 0.17.1 的 `session/requestRuntimePreferences` 结果 schema 是 `.strict()`，插件答复里的 `dynamicWorkflowEnabled`、`dynamicWorkflowMode` 会让每次派遣失败。
- 用户自有服务商的 `/models` 常返回 404/405，现有规则把它当作「无账号证据」，模型全部被隐藏。
- 配置了自定义请求头的服务商被整体排除。
- 模型标签显示服务商 UUID。

另外，插件没有不改 ZCode 桌面端配置就能添加自有密钥的入口。

## What Changes
- 启动前静态读取已安装 ZCode 入口，判定工作流字段该放在答复里、会话创建与恢复参数里，还是两处都不放；旧版本行为不变。
- 用户自有 `standard-personal` api-key 服务商：404/405 时列出配置中声明的模型，标注「本机配置，未核实」、费用未知；401/403 仍隐藏并计数。
- 可核对的自定义请求头按 ZCode 合并顺序附带到目录查询；不可核对的跳过并计数。
- 模型标签显示安全的 providerName，重名或不安全时回退为 ID。
- ZCode 账号窗口新增「其他服务商」表单（复用通用模板，支持内置模板预填），只写插件账号目录，原子写入、0600、失败回滚，名称在全局、插件和内置三处查重。
- 列出两处配置中的 API Key 服务商：插件创建的可删除，全局的只读；订阅过期但有自有密钥时状态显示「已配置 ZCode API」。

## Capabilities
### New Capabilities
无。
### Modified Capabilities
- `cli-model-discovery`：新增 ZCode 用户自有 API Key 服务商模型规则；「按账号与执行路由筛选」把 ZCode 自有服务商列为专门规则。
- `custom-provider-config`：新增 ZCode 表单、账号行与删除、表单内置模板预填。
- `cli-native-features`：新增 ZCode 运行偏好答复跟随已安装版本。

## Impact
- Host：`native-zcode.mjs`、`zcode-resume.mjs`、`cli-native-capabilities.mjs`、`zcode-adapter.ts`、`account-models.mjs`、`custom-provider.ts`、`accounts.ts`、`zcode-grok-accounts.ts`、`index.ts`；新增 `zcode-schema-probe.ts`、`zcode-custom-provider.ts`。
- 共享协议：`CustomProviderForm.presets`（可选字段，旧 Client 忽略）。
- Client：`provider-form.tsx`、`accounts-window.tsx`、`i18n-messages.ts`。
- 文档：README、`doc/design.md`、`doc/settings-ui-design.md`。

不改依赖和插件版本号。

## 成功指标（基线、目标）
- 基线：
  - 0.17.1 每次派遣因答复含未知字段而失败。
  - 订阅过期后自有服务商模型为空。
  - 带请求头的服务商被排除。
  - 标签显示 UUID。
  - 无图形入口。
- 目标：
  - 新旧 schema 的模拟派遣都通过。
  - 404/405 显示未核实候选，401/403 隐藏。
  - 请求头被附带。
  - 显示名称。
  - 表单只写插件目录，全局文件字节不变，冲突与回滚有模拟覆盖。

## 范围外
- 不修改用户全局 ZCode 配置、真实账号或会话。
- 不读取、打印密钥值。
- 不登录、不调用模型。真实订阅过期 + 自定义密钥的 Desktop 验收（headless 与 app-server 两条路径）需要另行获得模型调用授权，本次未执行。
- 不提交、不推送、不发布，不增加版本号。
