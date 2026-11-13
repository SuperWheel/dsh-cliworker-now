## ADDED Requirements

### Requirement: CLI Worker 设置入口
设置弹窗导航 SHALL 在「智能体设置」上方提供「CLI Worker 设置」页，用于所有 CLI 共用的插件级设置；打开弹窗时 MUST NOT 预先读取该页数据，切到该页后才读取。

#### Scenario: 打开 CLI Worker 设置
- **WHEN** 用户在设置弹窗中点击「CLI Worker 设置」
- **THEN** 该项处于选中状态，页面读取并显示当前通用设置

#### Scenario: 读取失败
- **WHEN** 通用设置读取失败
- **THEN** 页面显示失败原因与重试按钮，选择控件保持禁用

### Requirement: 总并发上限可调整
「最高同时对话数」SHALL 为所有 CLI 共用的运行上限，可选 1–8，保存到 Host 私有存储并在重启后保留；未保存时 MUST 使用部署配置值。调高后 Host MUST 立即重新调度排队任务；调低 MUST NOT 停止进行中的任务，只限制之后的放行。非法值 MUST 被拒绝且不改变已保存值。

#### Scenario: 调高后放行排队任务
- **WHEN** 已有任务因达到上限而排队，用户把上限调高
- **THEN** 排队任务立即开始，无需等待其他任务结束

#### Scenario: 恢复默认
- **WHEN** 保存的补丁把 `maxConcurrent` 设为 `null`
- **THEN** 已保存值被移除，上限回到部署配置值

#### Scenario: 非法值
- **WHEN** 补丁中的上限为 0、9、小数或包含未知字段
- **THEN** 保存失败，原值保持不变
