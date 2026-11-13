# Spec Delta

## Purpose

使全部活跃 CLI Worker 通过各自当前原生服务或双向协议执行任务，保持明确选型、同会话续聊、原生权限及可核查的终态，并在协议升级后保留历史会话与账号来源，防止通信中断造成重复执行或虚报完成。

## ADDED Requirements

### Requirement: 各 CLI 原生任务协议

新 Worker SHALL 使用其独立原生通路：Codex app-server；Claude 和 Antigravity 双向 stream-json；Kimi 和 Grok ACP；ZCode app-server；OpenCode、MiMo HTTP/SSE；Hermes Runs API；Pi 和 OMP 自有 RPC。协议不支持、选型不符或原生握手失败 MUST 明确失败，不静默退回其他协议或 CLI。

#### Scenario: 新任务与能力拒绝

- **WHEN** 用户完成任一活跃 CLI 的选型并派遣新 Worker
- **THEN** 使用对应原生协议；在发送任务前核对可观察的模型、强度和会话能力，不满足时拒绝且不采用原生默认替代

### Requirement: 会话协议绑定兼容

Worker SHALL 持久绑定创建时的通信协议；缺少绑定的历史任务 MUST 保留旧执行通路。已有会话不允许因升级自动迁成另一通信界面拥有的会话，原生恢复返回不同身份时 MUST 拒绝。

#### Scenario: 历史 Hermes 续聊

- **WHEN** 旧 Hermes CLI Worker 在升级后继续对话
- **THEN** 使用原 stream-json 恢复，不向 HTTP API 绑定该旧会话；新 HTTP Worker 独立创建并恢复其自身会话

#### Scenario: Host 重启恢复

- **WHEN** 新协议 Worker 持久化后 Host 重启
- **THEN** 保持原生会话身份与协议，不重放已提交任务，不因缺少活动连接自动重发

### Requirement: 受管双向通信生命周期

Host SHALL 通过参数数组管理原生子进程和回环服务，限定消息大小、握手/请求时间及订阅生命周期；所有服务实例、进程、流和临时文件均须可清理。停止响应仅表示请求受理，MUST 在执行范围退出确认后才报告停止成功；断连和未知回执不得自动重试写任务。

#### Scenario: 取消与服务退出

- **WHEN** 用户停止正在运行的 RPC/HTTP 任务
- **THEN** 尝试原生取消后清理本轮受管进程范围，未确认退出时保持阻塞，不将 cancel 回执或 HTTP 200 直接标为停止完成

#### Scenario: 断流或超限

- **WHEN** 原生流提前结束、消息损坏、超过限制或超时
- **THEN** 保留本轮公开输出并报告错误，清理通信及进程，不自动创建替代任务

### Requirement: 原生权限与执行结果

新通路 SHALL 保留当前项目、账号、模型、强度与原生权限选择；无人响应的额外权限请求 MUST 拒绝并保留证据。任务成功须结合原生轮次终态、工具/权限错误和受管退出，不能以请求接受或最终自述代替。

#### Scenario: 权限请求与失败

- **WHEN** CLI 请求插件尚未提供交互处理的额外权限或报告工具失败
- **THEN** 不自动允许，不伪造成功；公开工具和拒绝记录继续可见

#### Scenario: 其他会话事件

- **WHEN** 服务推送其他会话、历史轮次或重复消息
- **THEN** 仅投影当前绑定会话和轮次，保留实际本轮正文，统计不重复相加

### Requirement: 私有服务与凭据边界

HTTP 服务 SHALL 仅绑定受管回环地址并使用本轮认证；只使用所选 CLI 的既有自身账号，私有文件目录与文件在 POSIX 分别为 0700 和 0600。Hermes 网关 MUST 隔离其他消息平台及自动任务，不改原生全局配置和登录文件；Client 继续仅通过 Harness Gateway。

#### Scenario: 独立 HTTP 网关

- **WHEN** 为 Hermes、MiMo 或 OpenCode 启动服务
- **THEN** 不接管未知现有端口或启动不相关消息平台，结束后清理所拥有的实例，原生账号和历史保持
