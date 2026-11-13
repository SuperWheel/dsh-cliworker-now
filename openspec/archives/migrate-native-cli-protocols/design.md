# Design

## Context

见 proposal.md。现有 WorkerRuntime 在外层禁用 stdin，逐轮托管进程并收集 JSONL；Pi/OMP 已采用内层 RPC Bridge。现有账号准备、Claude 路由和扩展 CLI 私有配置不能因更换通信方式绕过。

## Goals / Non-Goals

**Goals:** 全部新 Worker 接入已核实的原生协议；保留逐轮独占进程范围、既有队列互斥及原生会话身份；让原生轮次终态与桥退出分别可核查。

**Non-Goals:** 不升级系统 CLI、不替换模型或账号、不新增客户端直连端口，不在本次新增审批界面或将所有进程改成跨轮常驻服务。

## Decisions

- 新增受管 native bridge，私有 JSON 请求描述启动参数和任务，按 CLI 分发到独立 runner。外层继续使用宿主原有进程范围；内层负责双向 stdio 或 HTTP/SSE，输出有界统一 session/event/native/result 帧。原生 raw 仅用于公开遥测投影，不渲染未处理文本。
- Worker 新增可选 transport 字段。新任务选用明确的 native-v1 标识；缺少标识的旧 Worker 维持 legacy。Pi/OMP 继续其成熟 RPC，不为统一而替换已有隔离逻辑。未知绑定拒绝执行。
- 复用各 adapter 已完成的自身账号、项目和权限准备，在 private launcher 外壳之前包装 native runner，保留原生可执行入口及环境。不通过 shell 解析命令。
- 每轮独占服务，原生完成后关闭服务并等待退出；取消先发送原生 cancel/abort/stop，再由外层现有机制确认完整范围清理。服务长期存活与任务长期存活分离。
- OpenCode/MiMo 分别适配原生 OpenAPI/SSE；Hermes 使用独立 gateway home，仅 API 平台与所需工具，来源账号按现有准入重检，每轮刷新自身认证副本，不覆盖原始来源。HTTP session 状态保留在 Worker 私有目录。
- 额外权限/问题暂无客户端交互时明确拒绝；既有 plan/edit/acceptEdits 等原生模式保持。运行中引导只在已实现明确回执的通路开放，不能仅因协议名支持就启用。

## Risks / Trade-offs

- [官方 main 与已安装版本有差异] → 依据本机 schema/help/source 校验，保留明确不支持错误；不静默 fallback。
- [HTTP 会话不能接旧 CLI session] → transport 固定，旧任务保留旧实现。
- [旧测试模拟为 legacy wire] → 既有兼容回归保持 legacy 专项，新协议增加独立模拟进程与本地服务测试，测试数据明确标注模拟。
- [真实订阅或平台未验证] → 逐 CLI 记录离线、真实模型和平台证据；不把模拟通过写成账号成功，不隐藏待验收项。

## Migration Plan

先完成独立 runner 和共享桥回归，再统一接入新 Worker、类型检查及 preview 构建。Desktop 正式更新仅在无活动任务且 preview 验收后执行。回退可移除新任务默认路由但保留 transport 元数据，已有 native session 不得静默交给 legacy。
