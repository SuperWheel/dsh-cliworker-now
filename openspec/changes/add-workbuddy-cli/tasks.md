## 1. 调研与本机核验

- [x] 1.1 只读检查 WorkBuddy.app 5.9.3 内置 CLI 的包、入口、product.json 与引导代码
  - 2026-11-07 macOS：`@genie/agent-cli` 2.165.0，入口 `dist/codebuddy-lite-wb.mjs`；product.json endpoint `https://www.workbuddy.cn`、dataFolderName `.workbuddy`；桌面端 buildPolicy `fields`。
  - 引导载荷键、key/keyId 派生、5 秒监听超时、pid 校验均读自安装版代码；第三方结论已在本机复核。
- [x] 1.2 元数据探测：引导 → initialize → session/new（未发 prompt）
  - 探测脚本在会话 scratchpad（`wbprobe/probe.mjs`、`helper.cjs`），未入库；结果见共享笔记 `workbuddy-probe-2026-11-07.md`。
  - 只用 stdio `--acp`：引导成功（`receiverOutcome: received`、`runtimeStatus: ready`）但 initialize 90 秒无响应；加 `--serve --host 127.0.0.1 --port 0 --auth password` 并回复 `session.ready` 后 initialize 约 0.7–1 秒返回。
  - initialize：protocolVersion 1、loadSession true、无 agentInfo、authMethods iOA/external/internal/selfhosted。
  - session/new：已登录，模型 17 个（auto、hy4free、hy4std、hy3、hy3-x、deepseek-v4.1-flash、glm-5.3、glm-5.3-flash、glm-5.2、space-bunny、minimax-m3.1-flash、kimi-k3.1-pro、kimi-k3-1、kimi-k2.8-preview、deepseek-v4-pro、step-5-preview、mimo-v2.6-pro）；modes 8 种；configOptions mode/model/thought_level/sandbox/multitask。
  - 带 `HTTPS_PROXY` 时报 `fetch config failed … setProxy`（据此清除代理变量）。更正：早先记录的“无代理时只有 10 个模型、带代理退回 17 个旧条目”无法复现——同日用插件代码探测 3 次（含无代理变量）及原脚本按原设置复跑 2 次，均返回同一 17 个模型；10 个模型那次视为一次性结果，不作为结论。不设 `CODEBUDDY_CONFIG_DIR` 时网关横幅显示 `~/.codebuddy/settings.json`。
  - 每次探测后 `pgrep -fl "codebuddy-lite-wb.mjs --acp"` 无残留；读取密钥的私有绑定调用本次未被安全策略拦截。
  - 已知副作用：每次 session/new 在 `~/.workbuddy` 留下一条空会话记录（原生不提供删除）。

## 2. OpenSpec

- [x] 2.1 proposal、design、`workbuddy-cli` 规格增量与任务清单
- [x] 2.2 `pnpm spec validate add-workbuddy-cli --strict` 与 `pnpm spec:check`
  - 2026-11-07：`pnpm spec validate add-workbuddy-cli --strict --no-interactive` 通过；`pnpm spec:check` 为 57/57 通过。

## 历史阻塞记录

- 2026-11-07：把密钥读取与投递的实现派给 Codex 子 Agent 时，本机自动模式的安全分类器拦截了协调会话的这一步。按约定没有绕过，也没有换个说法重试。之前记录“子 Agent 没有启动”有误：已发出的子 Agent 调用实际继续运行，并在工作区新建了 12 个未提交文件（第 3 节的核心模块与 3 个模拟测试文件）。协调会话未审阅、未提交、未修改这些文件，相关任务也未勾选，等用户在场确认后再决定保留还是删除。
  - 子 Agent 自报：91 项模拟测试通过；typecheck 的 Host 阶段通过，Client 阶段有 10 个范围外错误。这些结果未经协调会话复核。
  - 已发现缺陷：`workbuddy-bootstrap.mjs` 使用 `CODEBUDDY_SIDECAR_TOKEN` 与 `CODEBUDDY_SIDECAR_SESSION_ID`。安装版实际变量名是 `CODEBUDDY_SIDECAR_READY_TOKEN` 与 `CODEBUDDY_SIDECAR_READY_SESSION_ID`，原样运行会被判为 managed-invalid。原因是派遣说明在传递中被截断，子 Agent 自行推测了变量名。

2026-11-07 注册接线续接：本轮用户明确说明核心模块已提交，要求直接复用；本轮没有改动第 3 节核心模块。当前源码已使用 `CODEBUDDY_SIDECAR_READY_TOKEN`／`CODEBUDDY_SIDECAR_READY_SESSION_ID`。上方为历史状态，本轮未再次触发该动作；第 3 节的实施勾选留给协调会话核对。

## 3. 核心模块（新文件）

- [x] 3.1 `workbuddy-variant.ts`、`workbuddy-installation.ts`：两版差异、候选路径、身份核对
- [x] 3.2 `workbuddy-key-helper.cjs`：读取密钥、派生、投递、固定失败类别
- [x] 3.3 `workbuddy-bootstrap.mjs`：子进程环境、私有目录、ready 监听与清理
- [x] 3.4 `codebuddy-acp-outcome.mjs`：审批标题补全与拒绝审批结束识别
- [x] 3.5 `native-workbuddy.mjs`：runner、横幅过滤、启动前身份重核、元数据探测
  - 2026-11-07：用户在场确认后，协调会话逐文件审阅子 Agent 产物，修正 ready 变量名为 `CODEBUDDY_SIDECAR_READY_TOKEN`／`CODEBUDDY_SIDECAR_READY_SESSION_ID` 后提交 4619a03。

## 4. 注册与接线（共享文件只做追加）

- [x] 4.1 `CLI_IDS`、`CLI_LABELS`、`CLI_SHORT_NAMES`、权限三档与规划、分支不支持理由
  - 两 ID 按 workbuddycn、workbuddy 顺序追加；三档、原生规划、view-only、禁用分支及两 transport 由模拟注册用例核对。
- [x] 4.2 路由别名与泛称分流（两版都装时询问）
  - 别名与泛称分流、探测未知不回退、宿主原生选版及取消均由模拟测试核对；国际版调用提示用显式 WorkBuddy AI 避免泛称歧义。
- [x] 4.3 配置项、可执行解析、`workerArguments`、目录、账号状态与指引
  - 应用包发现绕过 PATH；桥请求使用 [runtime, entry]。新增 workbuddy-metadata.ts 合并一次授权内的目录／登录握手；每次准入重新探测。只提供桌面端账号指引，不提供插件登录、退出或账号终端。来源绑定只表明安装／站点，不能识别未公开的同站点账号主体。
- [x] 4.4 `NATIVE_TRANSPORTS`、`native-bridge.mjs`、附件、能力类别、`scripts/build.mjs`
  - 桥、附件、原生类别与运行资源已接线；DSH 工具桥保持关闭。隔离包的 8 份 WorkBuddy 运行资源与源码字节一致，lib 及 lib/types/host 两处 runner 可直接导入（没有执行 CLI）。
- [x] 4.5 图标素材目录与运行图、连接页与 Worker 卡片的试验性标注、i18n
  - 原图来自 WorkBuddy.app 5.9.3 的 icon.icns，用 sips 转 PNG，来源与 SHA-256 见 doc/assets/cli-icons/v5-workbuddy/manifest.json；运行副本字节一致。模拟 React 渲染验证两版连接页无登录／退出按钮、试验性标注、路径说明与 Worker 卡片；新增 i18n 回归。Desktop 明暗目视仍未做，国际版暂复用国内版标识。

## 5. 自动化检查

- [x] 5.1 模拟测试：引导成功与各失败类别、密钥不入输出、socket 与目录清理、ready 校验、横幅丢弃、环境变量清理
- [x] 5.2 模拟测试：runner 握手、选型、三档与规划、拒绝审批结束、审批标题补全、恢复失败、取消
  - `tests/workbuddy-installation.test.ts`、`workbuddy-bootstrap.test.ts`、`native-workbuddy.test.ts` 共 91 项模拟测试通过（模拟密钥、模拟 CLI）。
- [x] 5.3 接入测试：注册、路由、发现与跨版拒绝、权限菜单
  - tests/workbuddy-registration.test.ts 的 29 项模拟测试通过；覆盖注册、权限、规划、附件、工具桥关闭、应用发现、跨版拒绝、原生桥 argv、元数据去重／刷新、登录错误与清理失败、显式别名、泛称单／双版分流及取消。
- [x] 5.4 `pnpm typecheck`、关联 vitest、`pnpm build:preview`
  - 最终 29 个关联测试文件、1421 项通过（本机模拟，非真实账号／模型）；命令清单见 registration-verification.md。初次端口与 socket 用例在沙箱内因 listen EPERM／ready-listen-failed 失败，获准后原样在沙箱外通过；已有核心模块的三组模拟回归为 91/91，未修改这些模块。
  - `pnpm build:preview` 通过；首轮根目录 typecheck 缺少尚未生成的 remote 声明，未改无关 Client 实现。从隔离构建仅复制生成的 lib/typert.remote-client.d.ts 后，根目录 `pnpm typecheck` 及隔离包 `pnpm --dir .cache/preview-package typecheck` 均通过（DSH 0.2.2-rc.1）；未执行正式 build 或更新 Desktop 链接。
  - 当前 shell 没有 pnpm 可执行文件，命令实际通过 corepack pnpm 使用锁定 11.25.0；spec:check 的嵌套 pnpm 通过工作树 .cache/tool-bin/pnpm 包装器解析，不修改系统安装或设置。

## 6. 本机验收（不调用模型）

- [x] 6.1 用插件代码（隔离构建产物）做元数据探测：目录、账号状态、进程与 socket 清理
  - 2026-11-07 macOS、WorkBuddy 5.9.3、已登录：直接调用 `.cache/preview-package/lib/native-workbuddy.mjs` 的 `probeWorkBuddyMetadata`（只发 initialize 与 session/new，不发 prompt），3 次均成功，每次约 1.5–2.1 秒。
  - 结果：endpoint `https://www.workbuddy.cn`；17 个模型（与 1.2 更正后的列表一致）；effortOptions default/minimal/low/medium/high/xhigh/max；8 种 mode；agentInfo 为空。
  - 清理：每次结束后 `pgrep` 无 `codebuddy-lite-wb.mjs` 残留，系统临时目录无 `dshwb-*` 残留；探测输出不含密钥或网关密码。
  - 未做：经 Desktop 加载后的连接页查询（见 7.5）；未登录分支只有模拟测试。

## 7. 待授权或未验证

- [ ] 7.1 真实任务（读、改、审批允许与拒绝、续聊、停止且桌面端不受影响）——待用户批准模型，且需用户在场
- [ ] 7.2 询问档实际审批行为、`allow_always` 作用域、`thought_level` 是否随模型变化
- [ ] 7.3 国际版 WorkBuddy AI（本机未安装）
- [ ] 7.4 Windows 发现、命名管道引导与真实验收
- [ ] 7.5 Desktop 加载后连接页、图标明暗、Worker 卡片目视核对

## 8. 文档

- [x] 8.1 README、README.en、AGENTS.md CLI 列表、usage-details、design.md、`doc/workbuddy-protocol.md`
  - 更新 README.md、README.en.md、AGENTS.md、doc/usage-details.md、doc/design.md、doc/settings-ui-design.md，并新增 doc/workbuddy-protocol.md；所有真实验收边界保留。Qoder CN 的 211 个命中逐项归属见 registration-checklist.md。

## 共享改动

- `scripts/build.mjs`
- `src/client/cli-executable-settings.tsx`
- `src/client/i18n-messages.ts`
- `src/client/icons.tsx`
- `src/client/management-styles.ts`
- `src/client/operation-error.ts`
- `src/client/settings-dialog.tsx`
- `src/client/worker-card.tsx`
- `src/host/accounts.ts`
- `src/host/adapters.ts`
- `src/host/authorized-catalog.ts`
- `src/host/cli-account-binding.ts`
- `src/host/cli-native-capabilities.mjs`
- `src/host/index.ts`
- `src/host/native-attachments.mjs`
- `src/host/native-bridge.mjs`
- `src/host/native-harness-injection.mjs`
- `src/host/native-worker.ts`
- `src/host/process.ts`
- `src/host/routing.ts`
- `src/host/settings-catalog-cache.ts`
- `src/shared/account-links.ts`
- `src/shared/conversation-features.ts`
- `src/shared/types.ts`
- `src/shared/worker-permissions.ts`

新增接线文件：`src/host/workbuddy-metadata.ts`、`src/shared/workbuddy.ts`、`src/client/assets/workbuddy.png`；新增模拟测试：`tests/workbuddy-registration.test.ts`。文档、图标来源和受影响测试的完整改动文件清单见 registration-verification.md。

2026-11-07 协调会话复核：审阅接线改动后，把已登录状态下账号区文案改为“请在 WorkBuddy 桌面端管理账号；插件不提供登录或退出操作”（原先已登录也显示登录重试提示），并更新 settings-dialog 用例。复核命令：20 个关联测试文件 1082 项通过；`corepack pnpm typecheck` 通过（DSH 0.2.2-rc.1）；`corepack pnpm build:preview` 通过。

未执行：推送、发布、正式构建、Desktop 链接更新、真实模型调用、凭据文件读取（只按方案读取 at-rest 密钥并投递给本次 CLI）。第 7 节保持未完成。
