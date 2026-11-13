## 1. 契约
- [x] 1.1 共享能力表 `src/shared/conversation-features.ts`、绑定能力键扩展与向后兼容（Host 存储默认值、Client 旧绑定兼容）

## 2. Host
- [x] 2.1 Worker.goal 存储与 Remote：读取、设置/编辑、暂停、恢复、清除（校验父会话、Worker 归属、revision）
- [x] 2.2 runtime 每轮输入注入活动目标；暂停/清除不注入；不自动续轮
- [x] 2.3 子会话 `/goal`、`/plan` 命令改为桥接或按能力禁用；保留其余命令屏蔽
- [x] 2.4 `forkWorker` Remote 与 `src/host/worker-fork.ts`：校验、原生分支、同父 Worker 与子会话、历史复制、失败清理
- [x] 2.5 各 CLI 原生分支方法与截点；无法确认的 CLI 在能力表降级

## 3. Client
- [x] 3.1 “+”菜单加入目标、反馈、规划、分支入口，按能力禁用并显示原因
- [x] 3.2 GoalBar 子会话替换：显示与编辑 Worker.goal
- [x] 3.3 PermissionSelect/PlanChip 按 `capabilities.plan` 禁用提示
- [x] 3.4 消息分支按钮、工作区会话菜单与快捷键改道 `forkWorker`；较早截点按 `forkEarlier` 禁用提示

## 4. 检查
- [x] 4.1 单元/模拟测试：能力表、旧绑定兼容、目标注入/暂停/不续轮、分支校验与失败清理、禁用提示不触发请求
- [x] 4.2 typecheck、全量测试、build:preview
- [x] 4.3 真实低成本模型验收：各已登录 CLI 目标注入与最新轮分支，支持较早截点的 CLI 验较早分支；记录事件、退出状态与新旧会话 ID（2026-10-20：11/12 个 CLI 已通过；Kimi 凭据过期，用户确认不再验收 Kimi，保持未验证；Desktop 界面目测并入当晚 Windows 验收）
- [x] 4.4 无活动任务时正式构建；doc/tasks.md、README 与 design.md 同步
- [x] 4.5 修复真实烟测发现的 OpenCode 状态目录隔离及 ZCode 无检查点分支，补模拟回归、typecheck 与隔离构建；真实模型复验由主会话执行
- [x] 4.6 修复 MiMo 续聊消息 ID 排序与 Qoder CN 首次模型缓存初始化导致的账号绑定误变，补含目标/无目标及真实账号切换的模拟回归、typecheck；真实模型复验由主会话执行
