## ADDED Requirements

### Requirement: 逐轮积分与实际模型展示
原生回复功能条 SHALL 对按积分计费的 CLI 使用“积分用量”和积分单位，按该轮精确绑定的已结算运行去重汇总；积分缺失 MUST 显示未知，不显示 Token 或借用其他轮次积分。提供方／模型 SHALL 使用该轮原生已确认的 `CLI/提供方/模型` 身份；未公开的部分明确未知，不展示内部 Worker 路由，不猜测提供方或改写执行身份。

#### Scenario: Qoder 隐藏 Token
- **WHEN** 本轮具有可核验积分，但账单 Token 被隐藏
- **THEN** 回复入口及弹层展示本轮积分和“积分用量”，无 Token 提示；重复快照不重复相加。

#### Scenario: 后续轮次与断连
- **WHEN** 后续轮次积分更新、历史某运行缺少积分，或数据断连
- **THEN** 旧轮不借用当前值；未知数值显示 `—`，已知积分单位保留。

#### Scenario: 原生包装路由
- **WHEN** 已有精确原生回复计数及对应运行的已确认模型
- **THEN** 保留原生计数，提供方／模型行展示真实 CLI 身份，例如 `omp/zhipu-coding-plan/glm-5.3-flash`，不显示 `cliworker-native/worker/<uuid>`。

#### Scenario: 精简统计提示
- **WHEN** 查看任意 CLI 的用量或活动统计弹层
- **THEN** 保留统计标题、实际数值与未知标记，不附加重复解释段落，不因缺失信息显示多余留白。
