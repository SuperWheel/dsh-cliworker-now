# Spec Delta

## MODIFIED Requirements

### Requirement: 随包界面升级保留目标宿主原生行为

随包原生 UI SHALL 基于可核验的目标官方源码与补丁构建，并保留目标版本的原生视图动作、草稿初始化、提交快照、推理显示语义与随包资源。随包 UI MUST NOT 引用目标宿主共享包已移除的导出。发布源码身份 MUST 与实际应用构建标记分别记录；兼容声明须区分隔离验证、正式客户端和真实模型验证。当前开发 SDK、默认 vendor 目标、随包四包与面向用户的当前适配版本说明 SHALL 对齐 0.2.2-rc.5。

#### Scenario: rc.3 原生行为
- **WHEN** 在 Harness 0.2.1-rc.3 启用插件
- **THEN** 保留 header views.actions、视图 pin、whenDraftExists 的 append/replace/keep 优先语义，以及 newSession/agentPreset 提交快照字段

#### Scenario: rc.5 推理显示文本
- **WHEN** 在 Harness 0.2.1-rc.5 启用插件，模型推理以 `<signature>…</signature>` 开头
- **THEN** 摘要、展开正文与实时过程摘要只显示签名之后的文本，全为签名时不显示推理行；`conversation.chat.reasoning.body` 同时收到 `rawText` 与显示用 `text`

#### Scenario: 0.2.2-rc.1 随包资源
- **WHEN** 在 Harness 0.2.2-rc.1 启用插件，ui-chat 显示运行中状态
- **THEN** 随包 ui-chat 通过 `./assets/*` 导出提供与官方逐字节相同的图片，宿主资源路由可读取，运行状态动画正常显示

#### Scenario: 0.2.2-rc.1 官方新行为与插件扩展并存
- **WHEN** 在 Harness 0.2.2-rc.1 启用插件
- **THEN** 官方的消息待接收时独立 Stop、断线暂停计时、`holding` 占位与统计药丸文本保持不变；插件的主会话呈现、外部请求状态、未知用量与积分统计仍生效

#### Scenario: 0.2.2-rc.2 共享包导出变化
- **WHEN** 在 Harness 0.2.2-rc.2 启用插件并打开含用量统计的会话
- **THEN** 输入栏上下文用量与轮次统计面板正常渲染，`conversation.composer.bar` 与 `conversation.chat.node` 不因调用 ui-primitives 已移除的 `useAnchoredPosition` 崩溃

#### Scenario: 0.2.2-rc.3 随包四包对齐
- **WHEN** 在 Harness 0.2.2-rc.3 启用相应的 rc.3 构建
- **THEN** 随包四包版本为 0.2.2-rc.3，继承的 Host 与声明文件与官方 npm 包逐字节一致，插件页面、CLI Worker 面板与设置弹窗正常加载，控制台无插件相关报错

#### Scenario: 0.2.2-rc.5 随包四包对齐
- **WHEN** 在官方 0.2.2-rc.5 的隔离 `DSH_HOME` 装载预览包并启动宿主 Web
- **THEN** `ui-session`、`ui-conversation`、`ui-subagent`、`ui-chat` 的唯一活跃来源均为插件 `runtime-host/`，版本及 manifest 的官方来源均对应 0.2.2-rc.5。继承的 Host 与声明文件与官方同版本 npm 包逐字节一致，主界面、CLI Worker 面板和设置正常打开，浏览器控制台与 Host 日志无插件相关错误

#### Scenario: 0.2.2-rc.5 Desktop 调用与续聊
- **WHEN** 在 Mac Desktop 0.2.2-rc.5 上加载正式构建，按默认选型流程由主 Agent 派遣一个已登录且已获选型授权的 CLI，任务完成后续聊一次
- **THEN** 选型卡片可提交，Worker 抵达完成终态，事件、退出状态及实际产物可核对，续聊复用同一原生 CLI 会话

#### Scenario: 0.2.2-rc.5 Desktop 停止 Worker
- **WHEN** 用户停止正在运行的 Worker
- **THEN** 插件确认进程范围已退出后才显示停止成功，记录可核对的终态

#### Scenario: 当前适配版本可核对
- **WHEN** 查看当前版本的中英文 README、设计说明、原生会话宿主扩展协议或随包资源说明
- **THEN** 当前适配版本均为 0.2.2-rc.5，历史版本记录仍对应当时的宿主版本

#### Scenario: 宿主兼容与重复来源
- **WHEN** 在声明支持的宿主启用或禁用插件
- **THEN** 页面可启动，每个四包身份只有一个活跃来源，启用后原生设置仍可写回 canonical stock 行；不符合接口或来源约束时保留预检错误

#### Scenario: 来源可复核
- **WHEN** 重建或核对随包资源
- **THEN** 固定 tag、真实 Git commit、源码补丁、依赖清单和文件摘要可对应，不把应用短构建标记冒充 tag commit
