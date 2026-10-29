## MODIFIED Requirements

### Requirement: 能力判定与禁用提示
插件 SHALL 按 Worker 的 CLI 与原生 transport 判定 goal、plan、feedback、fork、forkEarlier 是否支持，并写入子会话绑定。不支持的功能入口 MUST 保持可见、禁用，并在悬停或聚焦时显示“当前 CLI 不支持…”的原因；点击或键盘触发 MUST NOT 调用 Host 或产生错误提示。同一控件 MUST 只显示一个提示：插件显示原因时，该原生控件自带的提示与浏览器 `title` MUST NOT 同时出现；原因提示 SHALL 显示在该控件原生提示的同一侧，分支入口（消息操作栏与侧栏菜单）统一在下方。

#### Scenario: 不支持规划的 CLI
- **WHEN** 用户在 Qoder CLI 子会话中把鼠标移到规划入口
- **THEN** 入口显示为禁用并提示“当前 CLI 不支持规划模式”，点击不发起请求、不弹出错误

#### Scenario: 旧绑定
- **WHEN** Client 收到不含 goal/feedback/forkEarlier 能力键的旧 Host 绑定
- **THEN** 绑定仍被接受，三项按不支持处理

#### Scenario: 较早轮次的分支按钮
- **WHEN** 用户在只支持从最新一轮分支的 CLI 子会话中，把鼠标移到较早轮次的分支按钮
- **THEN** 只在按钮下方显示“当前 CLI 只支持从最新一轮分支”，不再同时显示“在新对话中分支”

#### Scenario: 可用的分支按钮
- **WHEN** 用户把鼠标移到最新轮次可用的分支按钮
- **THEN** 只显示原生的“在新对话中分支”
