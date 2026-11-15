# Design

## Context
见 proposal.md。初始适配在 pi-1.5.2-adapt worktree 完成；2026-11-15 Windows 收尾与 bash 修复续在 main 实施，不提交。证据来自本机 1.0.4 和 1.5.2 的已安装 npm 包，不读真实认证与会话。pmspec 拒绝 topic 中的点号，实际变更名使用 vnext-pi-1-5-adapt-leeyl。

## Goals / Non-Goals
支持精确版本、共用原生协议和保守失败处理；不扩大账号、模型或外部执行授权，不调整 Client。

## Decisions

### 决定 1：显式版本数据作为唯一准入来源
- 最终决定：在安装元数据模块导出只读版本数据及判断函数，更新检查复用；允许 1.0.2、1.0.4、1.1.0、1.5.2。
- 放弃的方案：SemVer 范围或自动接受中间版本 —— 原因：未逐版验证。
- 影响：声明文件从版本数据推导类型，错误文案随数据生成；仍验证包名、入口和 SDK 文件。

### 决定 2：复用经源码核实的协议，识别新版中止终态
- 最终决定：保持 RPC、tool_call/confirm、模型和会话接口；识别 1.1.0 起增加的 agent_settled.aborted=true，避免误报成功。
- 放弃的方案：整套版本分叉 —— 原因：RPC 命令类型声明一致，原有字段保持兼容。旧版缺少 aborted 字段保持旧行为。
- 影响：既有进程清理、权限握手、会话映射、0700/0600 存储规则继续有效。

### 决定 3：真实验证只在隔离空 HOME 中执行
- 最终决定：单独无模型探测脚本，拒绝 prompt，使用空认证、空会话及离线配置；插件元数据桥与原生 RPC 分别验证，记录事件和退出码。
- 放弃的方案：沿用历史 probe-pi.mjs 的可选真实调用路径 —— 原因：该脚本含历史凭据读取和模型调用，不符合本次边界。
- 影响：模型目录仅验证本地结构与无凭据投影，不证明账号可用性；登录只查接口与文本。

### 决定 4：正常完成先等待自然退出，退出回执不替代范围清理
- 最终决定：协议管道正常结束后给 `handle.done` 最多 3000ms；仍未退出才 terminate。finally 中直接进程已完成且未取消时，给 `waitForExit` 最多 3000ms 证明整个范围退出；超时才 terminate，并继续等待范围退出。停止/超时/abort 不享受自然退出宽限；等待中取消也立即结束宽限。真实范围错误不按 EPIPE 文本豁免，继续持久化 quarantine。
- 根因：Windows `spawnManagedAgent` 走 backend.spawn；nativeProcessBackend 在 Electron 下可通过 `spawnWindowsHidden` 包装。该包装器的 done 使用私有 native exit 回执，可以先于 inner.done/Job runner 退出。故 runtime 已 await 外层 done，并不保证 WindowsJobOwner.directResultType 已设置；finally 的无条件 terminate 可能命中 runner IPC 关闭窗口。本地 rc.3 `windows-job.ts:95-109` 的 EPIPE 会拒绝范围清理；这与现场 SUCCESS 后 17ms 的 failed 相符，确切 IPC 回调时序没有现场追踪。
- 相同模式：forkNative 也重复终止，复用相同等待/清理。adapters.ts 的 captureCatalogMetadata 和 accounts.ts 状态查询已先等待范围自然退出，保持现有实现。账号交互终端的 terminate 是原生终端范围清理契约，不改为只等待 done；macOS managed terminal 的 waitForExit 仍执行必需的终端清理。
- 放弃的方案：忽略 EPIPE 或仅凭 done 放行 —— 原因：不能掩盖真实基础设施错误，也不能漏掉仍存活的 runner/后代。
- 生命周期：宽限定时器/abort listener 在结束时清理；不改变清理隔离文件、私有资源保留与停止成功条件。

### 决定 5：保留原生 Windows 程序安装目录
- 最终决定：共享三个环境键 ProgramFiles、ProgramFiles(x86)、ProgramW6432；Pi/OMP bridge allow-list 和 OMP approval help probe 保留它们，账号登录/退出 launch env 显式传递相同键。仅处理子进程环境，不写 Host process.env，不新增代理变量或修改代理规则。
- 根因：Pi 1.5.2 dist/utils/shell.js:85-103 先查 ProgramFiles 和 ProgramFiles(x86) 下的 Git/bin/bash.exe；bridge 的原白名单移除了它们，PATH 只有 Git/cmd 时无法发现 bash。ProgramW6432 一并保留原生 Windows 安装目录语义。
- 账号终端原先通常从 DSH scrubbedParentEnv 继承非敏感键，未发现相同的强制白名单丢失；显式传递这三个键使登录、退出和桥保持一致。未扩大凭据、profile 或其他环境白名单。
- 回退：回退本次 Host 源码即可，无持久化迁移、不自动解除已有 cleanup-blocked，也不更新 Desktop。

## 1.0.4 → 1.5.2 源码核对
证据根目录（本机只读包，不是用户认证目录）：
- `P104=/Users/leeyl/.pi/agent/install/releases/1.0.4/node_modules/@earendil-works/pi-coding-agent`
- `P152=/Users/leeyl/.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-coding-agent`
- `A104=/Users/leeyl/.pi/agent/install/releases/1.0.4/node_modules/@earendil-works/pi-ai`
- `A152=/Users/leeyl/.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-ai`
以下相对路径均拼接对应根目录；行号来自已安装的未压缩 dist、docs 和 CHANGELOG。未读取 `.pi/agent/auth.json`、用户 sessions 或真实环境凭据。

| 核对项 | 原生证据（1.0.4 → 1.5.2） | 插件影响与决定 |
| --- | --- | --- |
| 包身份、Node、入口 | `P104/package.json:2-10,106`；`P152/package.json:2-10,95`：包名不变、bin 均为 dist/bundle/cli.js、Node >=22.19.0；两包均有未打包 dist/cli.js 与 SDK | 继续将入口归一到同一包 dist/cli.js。新增精确 1.5.2，不允许 1.5.0/1.5.1/1.5.3 或预发布；这些版本未逐包核验 |
| 启动参数 | `P104/dist/cli/args.js:40-45,89-100,111-120,152-169,224-226`；`P152/dist/cli/args.js:41-46,90-101,114-128,160-177,232-234,320` | `--mode rpc`、`--session`、隔离参数和显式 `--extension` 保留。1.1.0 起支持 +tool/-tool 且拒绝与普通条目混用；插件仅发普通工具名数组，无需分叉 |
| RPC 命令与消息 | 两版 `dist/modes/rpc/rpc-types.d.ts` 逐字节相同，`42,53,97,112,471` 分别为 get_state/get_available_models/get_session_stats/clone/confirmed；`P104/docs/rpc.md:48,67-69`、`P152/docs/rpc.md:48,67-69` 保留响应、排队和 settled 语义 | 保留现有 NDJSON、模型与 session ID 回读、原生 clone、stop/steer/统计流程，不从 agent_end 推断本轮完成 |
| 新版中止终态 | `P152/CHANGELOG.md:416-434`：1.1.0 增加 aborted；`P104/dist/core/agent-session.js:687-688` 无字段，`P152/dist/core/agent-session.js:744-745` 有字段；类型分别 `770`、`821-824` | 新增 true→失败处理，即使助手消息正常且退出 0；缺字段保留旧逻辑。按字段能力处理，不引入无依据的版本比较；1.0.4/1.1.0/1.5.2 模拟验证 |
| 权限门、扩展 | `P104/dist/core/extensions/types.d.ts:1054-1058`、`P152/...:1109-1113` 都支持 block/reason；runner 分别 `957-974`、`965-982` 顺序等待并返回 block；RPC confirm 分别 `85-88`、`89-92`；新版 resource-loader.js:424-427 保留禁用发现时的显式路径加载 | 原有 tool_call→ctx.ui.confirm→RPC confirmed 不变；只更新核对注释。真实 probe 验证 gate 就绪，模拟验证允许/拒绝与未加载不得发送提示 |
| 其他扩展新增字段 | `P152/dist/core/extensions/types.d.ts:737-762,895-900`：before_agent_start 区分 user/custom、tool_execution_end 新增 durationMs；`P152/CHANGELOG.md:428-434` 记载 durationMs | 插件扩展使用 tool_call、context_with_system 和 registerTool 等既有接口，不读取 before_agent_start.prompt，不需要兼容分支；工具执行时长额外字段不破坏现有输出 |
| 进程与凭据写入收尾 | `P104/dist/modes/rpc/rpc-mode.js:579-609`、`P152/...:285-302,598-622,643-682`：新版 idle shutdown 与重复 signal 的收尾优化；`P152/dist/core/model-runtime.js:435-444` 新增 settleCredentialWrites；runtime-credentials.js:30-46 等待未完成写入 | 继续 EOF 后等待 close、超时再终止，不能看到终态就认定退出。元数据无 credential mutation；账号刷新仍在进程范围退出后 CAS 保存 |
| 认证文件与锁 | `P104/dist/core/auth-storage.js:15-39,85-90`、`P152/...:12-27,31-51,92-106`：仍为 provider→credential 的 auth.json、0600；新版锁使用 resolved path 并短重试 Windows EPERM | 插件刷新入口 `src/host/pi-omp-refresh.mjs:118-130` 已拒绝父目录和文件符号链接，并绑定 inode；其 canonical path 的 realpath:false 与新版锁同址，保留旧行为并解释注释。无需迁移认证格式 |
| 登录与退出 | `P152/CHANGELOG.md:22,41` 新增 shell auth login/logout；旧 UI 方法仍在 `P104/dist/modes/interactive/interactive-mode.js:4854-4922,4980`、`P152/...:5027-5095,5153`；认证选项文字仍是 Sign in with an API key 与 provider loginLabel | 保留原生 UI 及 ModelRuntime.logout，不切换新的 shell 登录协议。真实 probe 只检查导出方法与 provider 元数据，不调用登录。pi-flow.ts 和 account-links.ts 保留历史画面来源，未伪称新版实际登录画面 |
| 模型/提供商目录 | `P104/dist/core/model-runtime.js:78-105,278-280,327-329`、`P152/...:79-110,283-285,332-334`：API 一致，新增 OpenRouter personalized catalog；两版 core/models-store.js 内容相同；`P152/CHANGELOG.md:44-53` 列出新增提供商/默认模型变化 | 继续同包 SDK 动态目录与账号范围交集，绝不硬编码新默认模型；allowModelNetwork:false、PI_OFFLINE 和 inMemory 凭据保留。空认证 available=0 是正确结果，不把 1773 个本地模型当可用模型 |
| 会话格式与位置 | 两版 `dist/core/session-manager.js:11` 均 CURRENT_SESSION_VERSION=3；`P104/dist/config.js:476,491-499,527-532`、`P152/...:495,510-518,546-551` 保留 agent/sessions 与环境覆盖；新版 session-manager.js:443,778,814-833,1386-1442 修复路径比较、写失败回滚与 fork；`P152/CHANGELOG.md:5-15` 是原 cwd 不存在时交互恢复/fork 改进 | 不迁移 JSONL，不猜 ID；插件继续私有会话映射、确切路径与项目绑定。空隔离目录经 SessionManager.list/listAll 真实读取，非用户历史会话验证；双版本模拟续聊/统计验证 |
| 用量与成本 | `A104/dist/types.d.ts:291-312`、`A152/...:292-319`：input/output/cacheRead/cacheWrite/totalTokens、reasoning(已含于 output) 一致；新增 cost.totalFromProvider，total 可能为服务商账单而非分项估算和；两版 agent-session.js 的 getSessionStats 在 `3378-3431`、`3552-3605` 内容一致 | 保留 token 投影；不把账单成本加到 token，不二次加 reasoning/cacheWrite1h；现有插件未输出该 cost 字段，不假造明细，新模拟覆盖 total 与分项不相等 |
| 上下文分类 | `P104/dist/core/extensions/types.d.ts:669`、`P152/...:709` 均有 context_with_system；两版 core/compaction/compaction.js:201 的 estimateTokens、`A104`/`A152` 的 dist/utils/transcript.js:58 的 getCurrentSystemMessage 保留 | 继续独立 fd3 数字估计，真实 probe 包装实际 observer 只观察 hook 注册，未调用模型，未证明真实请求分类数值 |
| Settings 与缓存预热 | `P152/CHANGELOG.md:53`、`P152/dist/core/settings-defaults.js:60`：1.5.1 从 streaming 改为 idle；`P152/dist/core/cache-warmer.js:58-68,93-106,182-188`，`P152/dist/core/agent-session.js:1084-1087` dispose 取消预热 | Worker 只复制 defaultThinkingLevel，不导入用户扩展设置；保留原生任务行为及结束退出。无模型探测显式 cacheWarming:off、空认证、无历史、禁止网络，不靠 PI_OFFLINE 误当模型网络保护 |
| Windows managed launcher | `P104/dist/package-manager-cli.js:21-45,68-95,130-175`；`P152/...:23-45,71-96,155-203` 仍为 releases-v1、current-version、node_modules/.bin/pi.cmd，npm ci 后验证并原子切换。包内无 pi-launcher.js 模板，只有 managed updater | 能确认 updater 不改 launcher，不能据此声称“全新 1.5.2 Windows 安装器模板与旧版相同”。保留 1.1.0 已核验模板 SHA256 3d8b27bb3f5c07543303b0ee774ce215e4d6ae2b0ae43311c4acf51f517ffd13，模拟旧模板指向 1.5.2；未知模板仍拒绝，Windows 真机/新安装器模板待核实 |

本次还定位并核查 `pi-omp-adapter.ts`、`pi-omp-accounts.ts`、`pi-omp-logout.ts`、`pi-omp-control.mjs`、`pi-native-catalog.mjs`、`native-login-providers.mjs`、`native-harness-extension.mjs`、`http-rpc-response.mjs`、`telemetry.ts` 的 Pi 路径。原生会话列表真实探测使用 SDK；插件自己的 Worker 列表/历史来自插件存储，未导入原生用户会话。No prompt 真实探测不等于完整生产任务桥已完成模型验收。


## Risks / Trade-offs
- 无真实模型调用 → 模拟事件验证不能证明在线服务、费用和真实审批交互；保留待授权项。
- 包内没有 Windows 安装器的 launcher 模板 → 保留已核验模板哈希，不放宽未知启动器；Windows 本机未运行。
- 更新检查文件与主 worktree 并行变化 → 合并时保持共享版本判断，不覆盖其他更新逻辑。

## Migration Plan
无需数据迁移。先类型检查、回归、隔离构建与严格规格验证；主会话复核后决定提交。回退本次代码即可恢复原版本准入，不改变用户状态。真实模型验收缺口保留，不以归档隐藏。
