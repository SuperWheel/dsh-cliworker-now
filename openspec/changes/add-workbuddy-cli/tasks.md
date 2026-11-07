## 1. 调研与本机核验

- [x] 1.1 只读检查 WorkBuddy.app 5.9.3 内置 CLI 的包、入口、product.json 与引导代码
  - 2026-11-07 macOS：`@genie/agent-cli` 2.165.0，入口 `dist/codebuddy-lite-wb.mjs`；product.json endpoint `https://www.workbuddy.cn`、dataFolderName `.workbuddy`；桌面端 buildPolicy `fields`。
  - 引导载荷键、key/keyId 派生、5 秒监听超时、pid 校验均读自安装版代码；第三方结论已在本机复核。
- [x] 1.2 元数据探测：引导 → initialize → session/new（未发 prompt）
  - 探测脚本在会话 scratchpad（`wbprobe/probe.mjs`、`helper.cjs`），未入库；结果见共享笔记 `workbuddy-probe-2026-11-07.md`。
  - 只用 stdio `--acp`：引导成功（`receiverOutcome: received`、`runtimeStatus: ready`）但 initialize 90 秒无响应；加 `--serve --host 127.0.0.1 --port 0 --auth password` 并回复 `session.ready` 后 initialize 约 0.7–1 秒返回。
  - initialize：protocolVersion 1、loadSession true、无 agentInfo、authMethods iOA/external/internal/selfhosted。
  - session/new：已登录，模型（无代理）auto、hy3、glm-5.2、glm-5.1、glm-5v-turbo、minimax-m3、kimi-k2.7、kimi-k2.6、deepseek-v4-flash、deepseek-v4-pro；modes 8 种；configOptions mode/model/thought_level/sandbox/multitask。
  - 带 `HTTPS_PROXY` 时报 `fetch config failed … setProxy`，模型退回 17 个内置旧条目；不设 `CODEBUDDY_CONFIG_DIR` 时网关横幅显示 `~/.codebuddy/settings.json`。
  - 每次探测后 `pgrep -fl "codebuddy-lite-wb.mjs --acp"` 无残留；读取密钥的私有绑定调用本次未被安全策略拦截。
  - 已知副作用：每次 session/new 在 `~/.workbuddy` 留下一条空会话记录（原生不提供删除）。

## 2. OpenSpec

- [x] 2.1 proposal、design、`workbuddy-cli` 规格增量与任务清单
- [ ] 2.2 `pnpm spec validate add-workbuddy-cli --strict` 与 `pnpm spec:check`

## 阻塞记录

- 2026-11-07：把密钥读取与投递的实现派给 Codex 子 Agent 时，本机自动模式的安全分类器拦截了协调会话的这一步。按约定没有绕过，也没有换个说法重试。之前记录“子 Agent 没有启动”有误：已发出的子 Agent 调用实际继续运行，并在工作区新建了 12 个未提交文件（第 3 节的核心模块与 3 个模拟测试文件）。协调会话未审阅、未提交、未修改这些文件，相关任务也未勾选，等用户在场确认后再决定保留还是删除。
  - 子 Agent 自报：91 项模拟测试通过；typecheck 的 Host 阶段通过，Client 阶段有 10 个范围外错误。这些结果未经协调会话复核。
  - 已发现缺陷：`workbuddy-bootstrap.mjs` 使用 `CODEBUDDY_SIDECAR_TOKEN` 与 `CODEBUDDY_SIDECAR_SESSION_ID`。安装版实际变量名是 `CODEBUDDY_SIDECAR_READY_TOKEN` 与 `CODEBUDDY_SIDECAR_READY_SESSION_ID`，原样运行会被判为 managed-invalid。原因是派遣说明在传递中被截断，子 Agent 自行推测了变量名。

## 3. 核心模块（新文件）

- [ ] 3.1 `workbuddy-variant.ts`、`workbuddy-installation.ts`：两版差异、候选路径、身份核对
- [ ] 3.2 `workbuddy-key-helper.cjs`：读取密钥、派生、投递、固定失败类别
- [ ] 3.3 `workbuddy-bootstrap.mjs`：子进程环境、私有目录、ready 监听与清理
- [ ] 3.4 `codebuddy-acp-outcome.mjs`：审批标题补全与拒绝审批结束识别
- [ ] 3.5 `native-workbuddy.mjs`：runner、横幅过滤、启动前身份重核、元数据探测

## 4. 注册与接线（共享文件只做追加）

- [ ] 4.1 `CLI_IDS`、`CLI_LABELS`、`CLI_SHORT_NAMES`、权限三档与规划、分支不支持理由
- [ ] 4.2 路由别名与泛称分流（两版都装时询问）
- [ ] 4.3 配置项、可执行解析、`workerArguments`、目录、账号状态与指引
- [ ] 4.4 `NATIVE_TRANSPORTS`、`native-bridge.mjs`、附件、能力类别、`scripts/build.mjs`
- [ ] 4.5 图标素材目录与运行图、连接页与 Worker 卡片的试验性标注、i18n

## 5. 自动化检查

- [ ] 5.1 模拟测试：引导成功与各失败类别、密钥不入输出、socket 与目录清理、ready 校验、横幅丢弃、环境变量清理
- [ ] 5.2 模拟测试：runner 握手、选型、三档与规划、拒绝审批结束、审批标题补全、恢复失败、取消
- [ ] 5.3 接入测试：注册、路由、发现与跨版拒绝、权限菜单
- [ ] 5.4 `pnpm typecheck`、关联 vitest、`pnpm build:preview`

## 6. 本机验收（不调用模型）

- [ ] 6.1 用插件代码（隔离构建产物）做元数据探测：目录、账号状态、进程与 socket 清理

## 7. 待授权或未验证

- [ ] 7.1 真实任务（读、改、审批允许与拒绝、续聊、停止且桌面端不受影响）——待用户批准模型，且需用户在场
- [ ] 7.2 询问档实际审批行为、`allow_always` 作用域、`thought_level` 是否随模型变化
- [ ] 7.3 国际版 WorkBuddy AI（本机未安装）
- [ ] 7.4 Windows 发现、命名管道引导与真实验收
- [ ] 7.5 Desktop 加载后连接页、图标明暗、Worker 卡片目视核对

## 8. 文档

- [ ] 8.1 README、README.en、AGENTS.md CLI 列表、usage-details、design.md、`doc/workbuddy-protocol.md`

## 共享改动

（实施时在此列出改动过的共享清单文件，供协调会话合并。）
