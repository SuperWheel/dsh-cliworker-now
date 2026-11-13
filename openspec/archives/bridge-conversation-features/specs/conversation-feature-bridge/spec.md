## ADDED Requirements

### Requirement: 能力判定与禁用提示
插件 SHALL 按 Worker 的 CLI 与原生 transport 判定 goal、plan、feedback、fork、forkEarlier 是否支持，并写入子会话绑定。不支持的功能入口 MUST 保持可见、禁用，并在悬停或聚焦时显示“当前 CLI 不支持…”的原因；点击或键盘触发 MUST NOT 调用 Host 或产生错误提示。

#### Scenario: 不支持规划的 CLI
- **WHEN** 用户在 Qoder CLI 子会话中把鼠标移到规划入口
- **THEN** 入口显示为禁用并提示“当前 CLI 不支持规划模式”，点击不发起请求、不弹出错误

#### Scenario: 旧绑定
- **WHEN** Client 收到不含 goal/feedback/forkEarlier 能力键的旧 Host 绑定
- **THEN** 绑定仍被接受，三项按不支持处理

### Requirement: 持久目标
用户 SHALL 能在 CLI 子会话中设置、编辑、暂停、恢复和清除目标。活动目标 MUST 在之后每一轮发送给 CLI 的输入中注入；暂停或清除后 MUST NOT 注入。插件 MUST NOT 因目标存在而自动发起新一轮。

#### Scenario: 设置目标后下一轮
- **WHEN** 用户设置目标后发送一条消息
- **THEN** CLI 收到的本轮输入包含该目标与用户消息，且没有额外自动发起的轮次

#### Scenario: 暂停目标
- **WHEN** 目标被暂停后用户发送消息
- **THEN** CLI 输入不包含目标，GoalBar 显示已暂停

#### Scenario: MiMo 续聊与目标文本无关
- **WHEN** MiMo 已有完成轮，用户在有活动目标或没有目标时继续同一原生会话
- **THEN** 插件 SHALL 遵循原生消息排序，使本轮正常生成新的助手回复，MUST NOT 把上一轮回复当成本轮成功；确实缺少本轮助手终态时仍报告失败

#### Scenario: Qoder CN 首次模型缓存初始化
- **WHEN** 同一 Qoder CN 账号首轮创建模型目录缓存但未增加自定义路由，之后用户继续发送消息
- **THEN** 账号绑定 SHALL 保持不变，允许同会话续聊；真实账号、PAT 或自定义路由变化时 MUST 继续拒绝旧绑定

### Requirement: 反馈仅记录在 Harness
CLI 子会话中的赞踩与反馈 SHALL 通过 Harness 消息评价和会话反馈服务记录；插件 MUST NOT 把反馈发送给 CLI 或厂商，也 MUST NOT 把反馈写入模型上下文。

#### Scenario: 从“+”菜单提交反馈
- **WHEN** 用户在 CLI 子会话中通过“+”菜单打开反馈并提交
- **THEN** 反馈记录在该子会话，CLI 未收到任何新输入

### Requirement: 会话分支
对支持分支的 CLI，用户 SHALL 能从最新完成轮创建分支；对支持较早截点的 CLI，SHALL 能从较早完成轮创建分支。分支 MUST 使用 CLI 原生分支生成新的原生会话 ID，新建同父 Worker 与 Harness 子会话并包含截点前历史；原会话 MUST 保持可继续。Worker 运行中或有排队消息时 MUST 拒绝分支；分支任一步失败 MUST 清理已创建资源、报告错误且不重发原任务。

#### Scenario: 从最新轮分支
- **WHEN** 用户在空闲的 Claude Code 子会话中点击最新一轮的分支按钮
- **THEN** 出现新的 Worker 子会话，含此前历史，其 CLI 会话 ID 与原会话不同，原会话仍可继续发送

#### Scenario: 不支持较早截点
- **WHEN** 用户在 Claude Code 子会话中把鼠标移到较早一轮的分支按钮
- **THEN** 按钮禁用并提示“当前 CLI 只支持从最新一轮分支”

#### Scenario: 运行中拒绝
- **WHEN** Worker 正在运行时调用分支
- **THEN** 请求被拒绝并说明需等待当前运行结束，不创建任何新 Worker

#### Scenario: 原生会话存储沿用
- **WHEN** Pi、OpenCode 或 ZCode 从最新完成轮创建分支，之后重启 Host 或再次分支
- **THEN** 新 Worker MUST 沿用源会话的原生状态目录，新旧会话 ID 保持独立，新分支的后续输入能找到已创建的原生会话

#### Scenario: ZCode 纯对话分支
- **WHEN** ZCode 已有完成轮但没有工作区检查点
- **THEN** 插件 SHALL 从原生消息列表取得最新助手消息 ID，以 `session/fork` 的 message 目标创建包含该轮的分支，MUST NOT 伪造检查点或发送模型任务
