# Tasks

## 1. 版本接口核对 〔后端｜3h〕
- [x] 1.1 核对本机两版本包、CHANGELOG、RPC/扩展/模型/认证/会话/统计/安装代码，design.md 记录路径行号
  - 证据：design.md 的 15 项差异表；1.0.4 和 1.5.2 包均存在，RPC 类型声明和模型存储实现相同。1.1.0 新增 aborted、1.5.1 默认 idle 预热、1.5.2 会话恢复修改分别定位到 CHANGELOG 和 dist。
  - Windows 范围：包内 managed updater 不重写 launcher；全新 Windows 安装器模板未获取，继续旧已核验模板的哈希限制。真机验收列入 3.5。
- [x] 1.2 交付 proposal、增量规格、design、两级任务并严格校验
  - 原指定命令 topic=pi-1.5-adapt 返回“主题和创建人必须为英文 kebab”（exit 1）；改用 `corepack pnpm spec new change --version next --topic pi-1-5-adapt --creator leeyl --creator-name Leeyl --title '适配 Pi Coding Agent 1.5.2'` 成功创建（exit 0）。
  - `corepack pnpm spec validate vnext-pi-1-5-adapt-leeyl --strict`：valid，exit 0。

## 2. Pi Host 兼容 〔后端｜3h｜前置 1〕
- [x] 2.1 统一版本数据与更新检查，补旧版/新版及未知版本模拟回归
  - `PI_SUPPORTED_VERSIONS` 为冻结数组，安装、错误文案、更新兼容检查共用；支持 1.0.2、1.0.4、1.1.0、1.5.2。未知/中间/预发布不放行，旧 Windows launcher 指向 1.5.2 的结构模拟通过。
  - 测试：pi-omp-identity、cli-management、pi-omp-adapter，最终关联结果见 3.1。
- [x] 2.2 按源码差异适配桥接和终态，验证权限、登录、会话、模型与统计相关回归
  - bridge 识别 aborted=true，即使 message_end 正常且 exit 0 也失败；省略字段保持旧行为。模拟覆盖 1.0.4/1.1.0/1.5.2。
  - 双版本覆盖目录/RPC、权限允许与拒绝、门未就绪不发提示、原生 session ID 续聊及 usage/context、provider cost 与 token 分离。现有账号、刷新、控制与上下文相关回归一并通过。
  - 登录/刷新源码只需说明已核验接口和锁路径兼容性，没有替换原生登录流程或认证格式。
- [x] 2.3 同步 README 与架构设计，核查不改 Client 和主 worktree
  - README.md、doc/design.md 链接本变更；git diff --check 通过，修改范围仅当前 worktree 的 Host/测试/脚本/文档。
  - 未操作主 worktree、未修改 src/client、依赖和插件版本，未执行 Git 提交或推送。

## 3. 隔离验收 〔测试｜2h｜前置 2〕
- [x] 3.1 执行 typecheck、关联测试、沙箱外全量 vitest，记录确切数字
  - `corepack pnpm typecheck`：Host/Client against DSH 0.2.2-rc.2 通过，exit 0；日志 `/tmp/pi-1.5-typecheck.log`。
  - 首次沙箱内关联测试：12 files 中 11 passed、1 failed；241 passed、124 failed、1 skipped。失败均为测试所需本地监听 `listen EPERM: operation not permitted 127.0.0.1`，记录 `/tmp/pi-1.5-related.log`；随后以 require_escalated 在沙箱外重跑。
  - 最终关联命令（沙箱外）：`corepack pnpm vitest run tests/pi-omp-identity.test.ts tests/pi-omp-adapter.test.ts tests/pi-permission-gate.test.ts tests/pi-context-observer.test.ts tests/pi-omp-native.test.ts tests/pi-omp-refresh.test.ts tests/pi-account-window.test.ts tests/pi-account-availability.test.ts tests/pi-omp-accounts.test.ts tests/pi-omp-control.test.ts tests/pi-omp-windows-directories.test.ts tests/cli-management.test.ts tests/http-rpc-response-audit.test.ts`。
  - 最终关联结果：13 files passed；384 passed、1 skipped（385 total），exit 0；日志 `/tmp/pi-1.5-related-final.log`。
  - 最终全量命令（沙箱外）：`corepack pnpm vitest run`；299 files passed、4 skipped（303 total）；6558 passed、14 skipped（6572 total），exit 0；日志 `/tmp/pi-1.5-full-final.log`。
- [x] 3.2 执行 build:preview 和本变更严格校验，核对退出码
  - `corepack pnpm build:preview`：exit 0，隔离包 `.cache/preview-package`，日志 `/tmp/pi-1.5-build-final.log`。保留构建器已有 CJS/依赖提示，无编译错误。
  - 将无模型脚本复制到隔离包 scripts 后执行 `node .cache/preview-package/scripts/probe-pi-offline.mjs /Users/leeyl/.local/bin/pi`：exit 0，5 阶段全部通过（详见 3.3）。
  - 独立读取隔离包与源码的 pi-installation、pi-omp-bridge、pi-permission-gate、pi-context-observer：字节一致。
  - `corepack pnpm spec validate vnext-pi-1-5-adapt-leeyl --strict`：valid，exit 0；未正式 build、未更新 Desktop 链接。
- [x] 3.3 对真实 Pi 1.5.2 做无模型版本、RPC/桥、扩展、模型目录及会话列表探测，记录命令事件与退出码
  - 脚本：`scripts/probe-pi-offline.mjs`。所有子进程使用空临时 HOME、空 auth.json、空会话、PI_OFFLINE=1、PI_TELEMETRY=0、cacheWarming=off；预加载禁网 guard，命令发送白名单没有 prompt。未读取真实凭据，未调用 login/logout，未改用户认证与会话。
  - 源码命令：`node scripts/probe-pi-offline.mjs /Users/leeyl/.local/bin/pi`（exit 0）；静态解析 managed link/pointer 后实际启动 `node /Users/leeyl/.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-coding-agent/dist/cli.js --version`，回读 1.5.2。
  - RPC argv：上述 node/cli.js 加 `--mode rpc --no-session --no-tools --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files --no-approve --extension <生产权限门> --extension <观察生产上下文扩展注册的临时 wrapper>`。
  - RPC 请求：get_state、get_available_models、get_session_stats、get_messages、get_commands、abort；6 个 response 全部 success=true。stdout 仅 response，fd3 收到 cliworker.pi_permission_gate ready=true 和 probe.context_loaded；无 agent_start/message_start/tool_execution_start/extension_error。
  - 另外运行生产 pi-omp-bridge.mjs 的 native-candidates 阶段、native-login-providers.mjs 和 SDK；5 阶段 code=0、signal=null、timedOut=false、processGroupExited=true。可用目录为 0（无凭据）；SDK 本地全目录 1773 models / 43 providers；SessionManager.list/listAll 均 0（隔离空目录）；登录 SDK 导出方法存在。promptCount=0、modelCalls=0。
  - 源码 1.5.2 报告：`/private/var/folders/5n/q6g32bkn2vd22k0012gfzjxw0000gn/T/cliworker-pi-offline-CbXgXb/report.json`；命令日志 `/tmp/pi-1.5-offline-final.log`。
  - 隔离包 1.5.2 报告：`/private/var/folders/5n/q6g32bkn2vd22k0012gfzjxw0000gn/T/cliworker-pi-offline-ziz4rI/report.json`；日志 `/tmp/pi-1.5-preview-probe.log`；同样 5 阶段 code=0、6 个 RPC success、1773 models/43 providers、prompt/model calls=0。
  - 额外旧版对照：`node scripts/probe-pi-offline.mjs /Users/leeyl/.pi/agent/install/releases/1.0.4/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`（exit 0），同样 5 阶段和 6 个 RPC 成功；1620 models / 42 providers，可用目录和隔离会话为 0。报告 `/private/var/folders/5n/q6g32bkn2vd22k0012gfzjxw0000gn/T/cliworker-pi-offline-T7oAtv/report.json`，日志 `/tmp/pi-1.0.4-offline.log`。
  - 三份报告均独立回读核对；临时根目录 0700、报告文件 0600。报告含完整 argv、事件类型及逐阶段退出状态，不入 Git。真实探测是原生 RPC+生产扩展+插件元数据桥，不是完整模型任务桥或用户历史会话验收。
- [ ] 3.4 真实模型验收（阻塞：用户的智谱 GLM Coding Plan 已到期）
  - 包括真实生成、工具执行、审批往返、续聊、在线账号范围、计费和实际请求上下文统计。
  - 2026-11-14 Mac Desktop 0.2.2-rc.3（main 合并 1.5.2 适配后正式构建）：设置页 Pi 由「执行入口身份不匹配」恢复为绿点，账号「智谱 GLM Coding（中国）· API 服务」，模型 GLM-5.3、强度 Low。用户要求修复后派遣 Pi 写 `pi-test/hello152.txt`：Worker `d4464291`（pi-1，zai-coding-cn/glm-5.3，Low）原生模型已确认后失败。Pi 原生会话中每次助手回复 `stopReason: error`，`errorMessage` 为 `429` 加 `code 1309`「GLM Coding Plan 套餐已到期，暂无法使用」，Pi 自动重试后放弃，文件未生成。属账号订阅状态，不是 1.5.2 接口问题；需用户续订或为 Pi 配置其他可用提供商后再验收
- [ ] 3.5 Windows 原生执行验收（未执行：本次仅 macOS 环境；Windows 仅模拟结构验证）
  - 1.5.2 包中无全新 Windows 安装器 launcher 模板，该模板是否变化待核实；已验证的旧模板升级指针路径保持支持，未知模板拒绝。

## 4. 实机发现：模型失败原因透传 〔后端｜2h｜前置 3〕
- [x] 4.1 Pi 桥把助手 `errorMessage`（及 `auto_retry_end.finalError`）提炼为「模型请求失败：<状态码>：<服务商消息>」，限 300 字、去控制字符；`aborted` 记为「模型请求被中止」
  - 证据：`src/host/http-rpc-response.mjs` 的 `modelRequestFailure`；`src/host/pi-omp-bridge.mjs` message_end 与 auto_retry_end 分支
- [x] 4.2 Pi 自动重试成功（`auto_retry_end.success=true`）时撤销前一次助手错误造成的失败，最终以重试结果为准；修复前一次可恢复的 429 也会让整轮判失败
  - 证据：同上 `retryableFailure` 只记录由助手错误产生的失败，其他失败不被清除
- [x] 4.3 runner：CLI 非零退出且桥已给出 `ERROR` 结果时，优先使用桥的错误原因，不再显示「CLI exited with 1: no diagnostic」
  - 证据：`src/host/runtime.ts` 退出码分支
- [x] 4.4 模拟测试：`tests/pi-omp-adapter.test.ts` 新增「服务商失败原因」「自动重试恢复」两项（与 aborted 三项一起 5 项通过）；`corepack pnpm typecheck` 通过
  - 证据：`corepack pnpm vitest run tests/pi-omp-adapter.test.ts -t "provider reason|auto-retry|aborted terminal"`：5 passed

## 跟进
- 2026-11-14 主会话已合并入 main（f510f75），冲突按 main 的「更新页跟随 latest、Worker 用白名单」解决。
- 保留此活动变更，模型和平台验收缺口关闭后再决定归档，不虚勾或隐藏缺口。
