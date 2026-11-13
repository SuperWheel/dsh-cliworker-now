## Why

CLI Worker 接入了 17 个 CLI，但插件不显示它们的版本，也没有更新和安装入口。用户只能逐个打开终端，自己判断每个 CLI 是用 npm、Homebrew、官方安装脚本还是桌面应用装的，再用对应命令更新。没装过的 CLI 只能照官方文档安装，再到「高级设置」里填路径。国内网络下载经常停滞，需要人工反复重试。

现状（main `b7949ec`）：只有 Grok（`src/host/grok-adapter.ts:235`）和 TRAE CN（`src/host/traecn-executable.ts:14`）在内部执行 `--version`，只用于识别可执行文件，结果不展示、也不比较。账号登录状态只缓存在设置弹窗的页面内存里（`src/client/settings-display-cache.ts`），重启 DSH 后每次打开设置都要重新读。

需求与决定见 PRD `doc/prd/2026-11-13-cli-update-PRD.md`（第九节 20 条已于 2026-11-13 全部定下），设计稿见 https://claude.ai/artifact/Drk2Ti7JmUhYEAWV5mG5Yk（15 张）。

## What Changes

- 设置窗口新增「更新 CLI」页：导航位于「智能体设置」之后、「CLI 连接」之前，按「检查失败、可更新、需要手动更新、已是最新、未安装、下载设置」分区列出 17 个 CLI 的当前版本、最新版本和安装来源。
- Host 新增 CLI 管理服务：
  - 按可执行文件真实路径识别安装来源；
  - 查询官方发布源，区分「最新版本」与「插件已适配的最新版本」；
  - 生成带指纹的更新或安装计划，全局一次只执行一个操作；
  - 执行更新与安装，完成后重新探测，版本确实到达目标才算成功。
- 下载停滞续传：插件掌控的下载每 10 秒检查一次进度，没有增长就中断并从断点续传，最多 200 次，总时长上限 2 小时；外部命令只在能读到下载字节时适用。
- 首次安装：纯 CLI 装到官方默认位置；ZCode、WorkBuddy CN、WorkBuddy 可以选安装位置，装好后写入机器级路径记录。官方安装脚本只用 Host 内置的官方地址，先下载到私有缓存，再以文件方式执行。
- 维护锁：更新或安装期间，目标 CLI 拒绝新派遣、续聊、账号窗口和模型查询；有任务在用该 CLI 时不能更新。
- 下载源设置：可选跟随 npm 设置（默认）、npm 官方源、npmmirror、自定义 https 地址，以 `--registry` 参数传入，不改用户的 npm 配置。
- 后台预加载与分层缓存：DSH 启动 60 秒后、系统空闲时，Host 低负载地读取 CLI 路径、当前版本、账号登录状态、最新版本和缺失的模型目录，写入私有缓存。打开设置时直接显示缓存，只加载缺失或过期的部分。「CLI Worker 设置」通用页新增开关「启动后在后台检查 CLI」，默认开。

## Out of Scope

- 卸载 CLI、切换发布通道、回退旧版本。
- 后台静默更新或安装；反复的定时检查（只在 DSH 启动后预加载一次）。
- 更新 DSH 本身或其他插件；在远端 Host 上更新或安装。
- 由主 Agent 或 Worker 调用更新或安装（不注册为工具）。
- 代装 Node.js、Bun 等运行时；为纯 CLI 选择安装位置。

## Capabilities

### New Capabilities

- `cli-update`：CLI 版本检查、安装来源识别、更新与首次安装、下载停滞续传、维护锁、下载源设置、后台预加载与缓存，以及「更新 CLI」设置页的展示规则。

### Modified Capabilities

无。路径记录（`harness-cli-path-settings`）、账号状态和模型目录缓存的现有规则保持不变，本变更只新增调用方。

## Impact

- **共享协议**：新增 `src/shared/cli-management.ts`（DTO、原因码、进度与操作快照，带运行时 schema）。
- **Host**：新增 CLI 管理服务及其子模块（安装来源、发布源、计划、执行、下载、维护锁、缓存与预加载）；`src/host/index.ts` 注册新的 `@Remote` 方法并接入生命周期清理；派遣、续聊、账号、目录和路径入口接入维护准入。
- **Client**：`src/client/settings-dialog.tsx` 导航新增入口，新增「更新 CLI」页组件；通用设置页新增预加载开关。
- **安装与发布**：不改插件安装协议；README 与 `doc/design.md` 同步新页面说明。
- **版本**：v0.8.10（2026-11-13 用户确认）。同版本还包含已完成并归档的 DSH 0.2.2-rc.2 适配（`openspec/archives/upgrade-host-022rc2/`，提交 `b7949ec`），其目标版本也已记为 0.8.10。
- **参考**：Codingns4DSH（GPL-3.0，commit 7ccef2a）只参考行为规则，不复制代码。
