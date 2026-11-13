## ADDED Requirements

### Requirement: Antigravity ACP 在项目内注入 MCP
Antigravity ACP SHALL 将进程 cwd 与会话 cwd 设置为项目，通过会话 mcpServers 提供当轮工具桥，MUST NOT 添加插件私有工作区或命令审批 Hook。项目明确要求的额外工作区 SHALL 保留，且其原生命令目录限制 SHALL 如实说明。

#### Scenario: 新建与恢复
- **WHEN** 新建或加载 Antigravity ACP 会话
- **THEN** mcpServers 包含当前轮的 stdio 载体，使用现有 Host 工具准入与审批；旧轮连接不能复用

#### Scenario: MCP 实际验证
- **WHEN** 验收工具桥
- **THEN** 以载体启动和实际 tools/call 到达为证据，不能以参数存在或 initialize 成功宣称工具已加载

#### Scenario: 旧 stream 后备
- **WHEN** 旧安装版必须使用 stream
- **THEN** 保留原有工具桥隔离与生命周期，移除无效命令 relay；提示私有工作区仍可能影响默认命令目录
