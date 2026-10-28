## ADDED Requirements

### Requirement: Codex 自定义路由模型目录
Codex 使用自身自定义路由时，Host SHALL 直接采用 Codex 原生 `model/list` 返回的模型 ID 与强度作为候选，与 Codex `/model` 一致，费用 SHALL 标为未知；MUST 不向 OpenAI 官方或中转站查询账号范围，也不补入配置或推测的模型。该规则是「按账号与执行路由筛选」中自定义配置需账号证据的例外，与 Claude 自身网关的专门规则并列。查询前后路线版本不同 MUST 报错要求刷新，不返回混合结果。中转站不支持所选模型时，由 Codex 执行时的原生错误说明。

#### Scenario: 中转路线读取模型
- **WHEN** Codex 配置自定义中转且原生 `model/list` 返回模型
- **THEN** 设置与派遣选型显示这些模型及其原生强度，费用未知，不访问官方账号接口

#### Scenario: 原生目录含新模型推广提示
- **WHEN** 原生 `model/list` 中某模型未隐藏且有思考强度，但带有 `availabilityNux` 推广文案
- **THEN** 该模型照常显示为候选；只有 `hidden: true` 或缺少强度元数据的条目被排除

#### Scenario: 查询期间切换路线
- **WHEN** 读取模型目录期间 Codex 路由配置、密钥或 `auth.json` 发生变化
- **THEN** 本次查询失败并提示刷新，不保存这次目录

#### Scenario: 原生目录查询失败
- **WHEN** Codex `model/list` 失败、超时或格式无效
- **THEN** 返回原有的查询失败原因，不以其他 CLI 或官方目录代替
