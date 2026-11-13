## ADDED Requirements

### Requirement: Antigravity ACP 选型与会话有原生回读
Antigravity ACP SHALL 使用返回的模型目录及 thought_level 选项设置模型强度，并在输入前回读确认；恢复 SHALL 保持原会话 ID，加载不兼容时仅以同 ID 回退 stream，MUST NOT 静默创建新会话。既有账号绑定、互斥、时限和换号续接边界 SHALL 不变。

#### Scenario: 选型不匹配
- **WHEN** 模型不在目录、强度选项缺失或设置后回读不一致
- **THEN** 输入前停止，不猜模型与强度的映射，不自动重发

#### Scenario: 旧会话恢复
- **WHEN** 旧 stream conversation_id 在 ACP 中可见
- **THEN** 仍实际加载并核对身份；目录可见不等于恢复成功，不兼容时保留同 ID 后备

### Requirement: Antigravity 两种协议保留真实终态
ACP SHALL 结合 tool_call 状态、permission 决定和 stopReason 判定；stream SHALL 将非空 denied_actions 标为待核实，将存在 finished_reason 的部分结果标为失败。MUST NOT 将异常结束、未完成工具、非零退出、取消或清理失败判为成功。

#### Scenario: 用户拒绝后正常结束
- **WHEN** DSH 拒绝原生请求后 ACP 有正文且以 end_turn 完整结束
- **THEN** 按既有用户决定语义完成，保留被拒步骤；没有正文仍为待核实

#### Scenario: stream 假成功
- **WHEN** stream 返回 SUCCESS 但有 denied_actions 或 finished_reason
- **THEN** 分别展示未执行的待核实或部分结果失败，保留正文，不自动重试

### Requirement: Antigravity ACP 用量与附件按能力处理
ACP SHALL 将 prompt usage 映射为本轮遥测，不冒充 stream 会话累计；缺少指标 SHALL 留空。附件 SHALL 遵循 promptCapabilities，未声明图片能力时仅提供路径；fork SHALL 保持不支持。

#### Scenario: 未公开附件或分支能力
- **WHEN** initialize 没有 promptCapabilities 或 session fork
- **THEN** 不发送未经声明的图片块，不开启分支会话
