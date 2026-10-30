## ADDED Requirements

### Requirement: Antigravity 按能力选择 ACP 与规划后备
Antigravity SHALL 仅在安装版帮助确认 acp 的 stdio 入口时选用 ACP；探测失败或旧版 SHALL 保留 stream。没有已核实的原生 ACP 规划模式时，第一项和规划开关 SHALL 使用 stream --mode plan，MUST NOT 以普通 ACP 执行冒充规划。

#### Scenario: 旧版或探测失败
- **WHEN** 安装版不提供 acp --stdio，或能力探测失败
- **THEN** 本轮使用既有 stream 参数与权限检查，明确说明后备，不根据版本字符串猜测能力

#### Scenario: 仅规划
- **WHEN** Worker 开启规划或选择 Antigravity 第一档
- **THEN** 使用已确认的 stream plan；未确认的 --agent 名称不能充当规划模式

### Requirement: Antigravity ACP 权限保持原生边界
ACP 自动审批 SHALL 先以零输入的 stream 启动读取 agy 自己报告的主机终端沙箱状态（与 stream 降级同一依据，不发送输入、不触碰绑定会话）。确认主机有终端沙箱时 SHALL 以原生终端沙箱加跳过确认运行，与 stream 自动审批等价；报告没有沙箱或无法确认时 MUST NOT 跳过确认，原生请求 SHALL 逐条转交 DSH。完全权限 SHALL 关闭终端沙箱并使用原生跳过确认。授权只使用提供的 allow_once/reject_once，MUST NOT 提供会话授权。

#### Scenario: 无终端沙箱
- **WHEN** 在无终端沙箱的主机运行自动审批档
- **THEN** 命令与其他实际到达的权限请求逐条进入 DSH；时间线说明按原生请求逐条询问，不声称工作区编辑自动放行或一定询问

#### Scenario: 停止或超时
- **WHEN** 等待 DSH 审批时用户停止、运行超时或连接关闭
- **THEN** 不再发送允许，撤回等待并清理进程范围；仅确认退出后报告停止完成

#### Scenario: 主机有终端沙箱
- **WHEN** 零输入启动报告账号不支持 auto，或没有警告即发出 init
- **THEN** ACP 以终端沙箱加跳过确认运行，命令不再逐条确认；时间线说明依据

#### Scenario: 沙箱状态无法确认
- **WHEN** 零输入启动在时限内没有任何报告，或提前退出
- **THEN** 不跳过确认，不因平台名称推断沙箱，原生请求逐条转交 DSH；原生启动失败则停止且不重发 prompt
