## ADDED Requirements

### Requirement: DeepSeek 原生候选的账号范围查询
Pi/OMP 的 DeepSeek API 登录 SHALL 仅展示原生候选与当前账号模型列表的交集。OMP 原生摘要缺失 API 路由时 SHALL 使用经核实的 DeepSeek 默认地址完成元数据查询；原生 SDK 和自定义配置提供的实际路由 MUST 优先于默认地址。强度 MUST 来自对应 CLI 原生能力，不得按远端列表创造模型或强度。

#### Scenario: OMP 仅有 DeepSeek API 登录
- **WHEN** OMP 仅保存 provider 为 deepseek 的 API 登录且没有自定义模型配置，原生摘要有 DeepSeek 候选但无 baseUrl
- **THEN** 使用核实的默认路由读取当前账号 `/models` 并保留交集及原生强度，不因缺少自定义配置返回空目录

#### Scenario: 远端包含原生不支持的模型
- **WHEN** DeepSeek `/models` 还返回当前 CLI 原生候选中不存在的 ID
- **THEN** 不展示该额外 ID；原生候选中账号不支持的 ID 同样不展示

#### Scenario: 账号范围未知或被拒绝
- **WHEN** DeepSeek 查询超时、网络失败、响应无效或全部凭据被拒绝
- **THEN** 不退回完整原生目录或编造模型；沿用账号范围和认证失败提示规则

#### Scenario: Pi 已提供原生路由
- **WHEN** Pi SDK 返回 DeepSeek 候选的实际 API 地址和强度
- **THEN** 使用该路由查询并保留其原生强度，不能以默认地址替换自定义路由
