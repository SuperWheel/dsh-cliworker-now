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
- [x] 3.4 真实模型验收（阻塞：用户的智谱 GLM Coding Plan 已到期）
  - 包括真实生成、工具执行、审批往返、续聊、在线账号范围、计费和实际请求上下文统计。
  - 2026-11-14 Mac Desktop 0.2.2-rc.3（main 合并 1.5.2 适配后正式构建）：设置页 Pi 由「执行入口身份不匹配」恢复为绿点，账号「智谱 GLM Coding（中国）· API 服务」，模型 GLM-5.3、强度 Low。用户要求修复后派遣 Pi 写 `pi-test/hello152.txt`：Worker `d4464291`（pi-1，zai-coding-cn/glm-5.3，Low）原生模型已确认后失败。Pi 原生会话中每次助手回复 `stopReason: error`，`errorMessage` 为 `429` 加 `code 1309`「GLM Coding Plan 套餐已到期，暂无法使用」，Pi 自动重试后放弃，文件未生成。属账号订阅状态，不是 1.5.2 接口问题；需用户续订或为 Pi 配置其他可用提供商后再验收
  - 2026-11-15 用户确认此项按现状验收并勾选；上面记录的未执行真实验证照旧保留，不当作已实测。
- [x] 3.5 Windows 原生执行复验
  - 2026-11-16 Windows Desktop 0.2.2-rc.3（1e4cfa5 候选包经原生安装器安装，含第 5 节修复；Codex Windows CU 操作）：Pi Worker `fe00e687`，deepseek/deepseek-flash、Low，项目 `C:\Users\admin\cw081f1\live-codex`。
    - 首轮写文件与续聊追加均完成；主会话经 SSH 回读 `rc0810/pi-win2.txt`，内容为 `pi win2 ok`+`followup ok`。说明 bash 已找到，没有再报 `No bash shell found`。
    - `Start-Sleep` 命令经「允许一次」运行后停止，约 10 秒显示「已停止」，工具卡为「Error: 用户已停止任务」。
    - 之后新派遣 MiMo `49b611a2` 正常完成，没有出现「已暂停派遣」；`~/.dsh/cliworker-now/cleanup-blocked.json` 不存在。说明正常结束后不再误判清理失败。
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

## 5. Windows 实机发现：收尾 EPIPE 与 bash 查找 〔后端｜4h｜前置 3〕
- [x] 5.1 修复正常完成后的重复终止，保留停止、超时和清理未确认隔离
  - 现场证据：`.test-data/windows-remote/desktop-audit/pi152-win-epipe/`，Worker `d67354ee`，run `0b5a610a-f897-4f24-bd4a-5f005ea27b8a`；2026-11-15 UTC 13:00:17.946 seq 141 SUCCESS，13:00:17.963 seq 143 `write EPIPE` 后 failed。独立回读 worker.json 确认为 failed/EPIPE；原始桥日志文件实际名为 `0b5a610a-f897-4f24-bd4a-5f005ea27b8a.raw.jsonl`，result 为 SUCCESS。
  - 已核对 runtime 正常完成仍无条件 terminate；Windows 隐藏窗口包装器的外层 done 可先于 Job runner 的 inner.done，解释了为什么 await done 后仍可能撞到 IPC 关闭窗口。本地 rc.3 WindowsJobOwner.signal 的 IPC 失败会拒绝范围退出；确切 IPC 回调时序没有现场追踪。进程无残留及全局 cleanup-blocked 文件来自上游实机报告，本次不访问真实运行目录。
  - 实现：正常管道结束等待 done 最多 3000ms；已完成进程等待范围退出最多 3000ms，逾期终止并继续确认。forkNative 同步；停止/超时/abort 立即终止，真实清理错误继续隔离。adapters/accounts 元数据路径原已有范围宽限，交互终端的强制范围清理保持。
- [x] 5.2 补充收尾模拟回归：自然退出、超时强制终止、立即停止及真实清理失败隔离
  - 修复前：runtime 的 4 项新增定向模拟为 3 failed / 1 passed（自然完成误判 failed、延迟完成仍被 terminate、不退出的进程超过 7000ms；停止测试通过）。日志 `/tmp/pi-win-before-final.log`；同次两项环境测试因夹具在运行后读取已删除 request.json 而失败，修正夹具后另测。
  - 修复后：首轮定向 3 files / 8 passed / 162 filtered；随后生命周期完整 3 files / 37 passed，exit 0（`/tmp/pi-win-focused-after.log`、`/tmp/pi-win-lifecycle-after.log`）。覆盖原生回执先于 runner、直接/范围宽限、等待中取消、停止完成前必须范围退出、真实 EPIPE 持久化隔离和下一次派遣拒绝。
- [x] 5.3 补全 Pi/OMP 原生 Windows 安装目录环境，增加模拟回归
  - seq 22（2026-11-15 UTC 13:00:12.719）bash 报 `No bash shell found`，候选目录为空；Pi 1.5.2 dist/utils/shell.js 使用 ProgramFiles 与 ProgramFiles(x86)，bridge allow-list 确实遗漏。Git 安装位置与 PATH 来自上游实机报告。
  - 实现：bridge、OMP help probe、Pi/OMP 登录与退出环境共享三个 Windows 程序目录键；不修改 Host 代理环境、其他白名单或原生配置。
  - 修复前环境专项：2 failed / 131 filtered，子进程回读为 `{}`；修复后 Pi/OMP bridge 和账号终端均回读三个原值。日志 `/tmp/pi-win-env-before.log`、`/tmp/pi-win-focused-after.log`。
- [x] 5.4 同步规格和文档，运行指定关联验证、类型检查及隔离构建

  - 所有 corepack 命令均设置 `pnpm_config_verify_deps_before_run=false`。`corepack pnpm typecheck`：Host/Client against DSH 0.2.2-rc.3 通过，exit 0；`/tmp/pi-win-typecheck.log`。
  - 关联完整命令（沙箱外）：`node_modules/.bin/vitest run --configLoader native tests/account-terminal.test.tsx tests/managed-agent-exit.test.ts tests/native-transport.test.ts tests/pi-omp-accounts.test.ts tests/pi-omp-adapter.test.ts tests/pi-omp-control.test.ts tests/pi-omp-identity.test.ts tests/pi-omp-native.test.ts tests/pi-omp-refresh.test.ts tests/pi-omp-windows-directories.test.ts tests/runtime-account-isolation.test.ts tests/runtime-metadata-cleanup.test.ts tests/runtime.test.ts tests/windows-account-owner.test.ts tests/windows-account-stdio.test.ts tests/windows-account-terminal.test.ts tests/windows-accounts.test.ts tests/windows-cli-account-status.test.ts tests/windows-cli-installation.test.ts tests/windows-cli-resolution.test.ts tests/windows-codex-background.test.ts tests/windows-codex-launch.test.ts tests/windows-console-manifest.test.ts tests/windows-console-source.test.ts tests/windows-desktop-cli-electron-fs.test.ts tests/windows-desktop-cli-installation.test.ts tests/windows-git-bash.test.ts tests/windows-hermes-home.test.ts tests/windows-hidden-process.test.ts tests/windows-process.test.ts tests/windows-remote.test.ts tests/windows-system-proxy.test.ts tests/windows-visible-installer.test.ts tests/worker-fork-runtime-native.test.ts tests/native-runtime.test.ts tests/accounts.test.ts`。
  - 首轮关联：36 files = 32 passed / 1 failed / 3 skipped；1020 tests = 1010 passed / 1 failed / 9 skipped，exit 1，`/tmp/pi-win-related.log`。唯一失败为既有 windows-visible-installer 测试的过期代理夹具 `{http}`，不满足 SystemProxy 的 `{url,bypass}`；独立复现 TypeError: proxy.bypass is not iterable。仅修正夹具形状，未改生产代理代码/Host 环境。
  - 失败文件复跑：`node_modules/.bin/vitest run --configLoader native tests/windows-visible-installer.test.ts`：1 file / 17 tests 全部通过，exit 0，`/tmp/pi-win-proxy-fixture-after.log`。合并此前其他文件结果，最终覆盖 36 files（33 passed / 3 skipped）、1020 tests（1011 passed / 9 skipped）；不是第二次全量重跑。
  - 首次沙箱内定向测试有 21 项 RPC 测试因 listen EPERM 失败，runtime 有 3 项预期失败、1 passed；初版不退出夹具还导致 teardown timeout。已修正夹具 abort 清理，并在沙箱外取得上述业务失败基线及通过结果；原始日志 `/tmp/pi-win-before.log`，不能当业务回归结果。
  - `corepack pnpm build:preview`：exit 0，`.cache/preview-package`，`/tmp/pi-win-preview.log`；保留既有打包依赖提示，没有正式 build 或更新 Desktop。
  - `corepack pnpm spec validate vnext-pi-1-5-adapt-leeyl --strict`：valid，exit 0；`/tmp/pi-win-spec.log`。`/Library/Developer/CommandLineTools/usr/bin/git diff --check`：exit 0。
  - README、doc/design.md、proposal/design/spec delta 已同步；3.5 保持未勾选，不归档。无真实 Windows/账号/模型执行，无凭据读取，无版本变更或 Git 提交/推送。

## 跟进
- 2026-11-14 主会话已合并入 main（f510f75），冲突按 main 的「更新页跟随 latest、Worker 用白名单」解决。
- 保留此活动变更，模型和平台验收缺口关闭后再决定归档，不虚勾或隐藏缺口。
