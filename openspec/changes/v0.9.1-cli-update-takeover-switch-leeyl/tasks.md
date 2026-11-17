## 1. 官方看门狗 10 秒与 Grok 进展信号 〔后端｜4h〕

- [x] 1.1 查明 Grok 近 4 分钟不切换的原因，并改用下载状态文字作为进展信号
  - `artifacts/grok.ts` 的描述是 `phaseOnly`，读不到字节；旧规则看不到字节就等满 10 分钟总预算。
  - Grok 1.0.77 是并行下载、预分配文件，文件长度不可信，所以改看输出的下载状态（设计决定 1）。
- [x] 1.2 官方下载阶段停滞阈值 30 秒改为 10 秒，只在下载阶段计时
  - `official-watch.ts`：停滞阈值与已确认过期锁等待都改为 10 秒。
  - `hermes-observation.ts`：拉取首字节 60 秒、后续停滞 30 秒都改为 10 秒。
  - `hermes-watch.ts`：工具下载停滞 30 秒改为 10 秒。
  - `npm-download.ts`：npm 官方工件停滞 30 秒改为 10 秒。
  - 解压、安装、签名、杀毒扫描阶段不计时。
- [x] 1.3 提供手动切换入口 `OfficialWatch.requestTakeover()`、`HermesWatch.requestTakeover()`，与自动判定走同一路径
  - `official-watch.ts:161`、`hermes-watch.ts:59`；新增 `tests/cli-management-official-switch.test.ts`。官方看门狗相关 5 个测试文件共 148 项通过。

## 2. 插件下载器 5 秒与 Qoder 续传 〔后端｜3h〕

- [x] 2.1 正文停滞检查与低速窗口由 10 秒改为 5 秒，阈值仍为 100 KB/s；低速窗口从首段正文开始计
  - `download.ts:16`（阈值）、`download.ts:187`（首段正文后开始计）、`download.ts:233`（「下载停滞 5 秒」与「下载响应等待超时」）。
  - `tests/cli-management-slow-download.test.ts` 新增 3 项：高延迟首字节、重定向、忽略 Range。下载器相关 6 个测试文件共 118 项通过。
- [x] 2.2 修复 Qoder 206 续传缺少 Content-MD5 被判为身份不一致
  - 只读探测（HEAD 与两次 4 KB Range）：HEAD 与 200 带 Content-MD5，206 不带；强 ETag 相同，总长都是 68148975。
  - 修复位置 `download-sources.ts`；`tests/cli-management-qoder-resume.test.ts` 10 项覆盖接受与拒绝两类情况。

## 3. 「切换插件下载」按钮与取消后核对 〔后端｜5h〕

- [x] 3.1 Gateway 动作 `requestCliTakeover`、service `requestTakeover`、更新行 `officialTakeover` 状态、更新页按钮与「正在切换…」状态
  - 涉及：`src/shared/cli-management.ts:214`（协议）、`src/host/index.ts:2453`（Gateway）、`service.ts:838`（service）、`service.ts:951`（看门狗入口）、`src/client/cli-update-page.tsx:1016`（按钮）。
- [x] 3.2 取消后只读核对原安装，分四种结果显示
  - `service.ts:764`、`service.ts:849`、`service.ts:881`；文案见 `cli-update-page.tsx:334`。
- [x] 3.3 模拟测试：协议校验、切换时序、重复点击、按钮显示条件、取消核对的四种结果
  - 新增 `tests/cli-management-manual-takeover.test.ts`，并补充 `tests/cli-update-page.test.tsx`、`tests/cli-update-data.test.ts`；这 3 个文件共 96 项通过。
- [x] 3.4 修复 Hermes 手动切换无效：旧日志的完成行让本次被判为已完成
  - 2026-11-17 Mac Desktop 实测：Hermes 0.23.1→0.23.2 拉取阶段点「切换插件下载」，按钮消失，官方更新继续，没有写入切换记忆。`~/.hermes/logs/update.log` 尾部有上一次的「✓ Update complete!」。
  - `artifacts/observations.ts` 的 `safeObservation` 支持只读追加部分；`hermes-watch.ts` 在开始时记下日志基线，并新增 `canTakeover`；`service.ts` 按 `canTakeover` 显示按钮；`cli-update-page.tsx` 在 `not-official`、`cleanup-unconfirmed` 时提示原因。
  - 新增测试：残留完成行不影响 10 秒停滞与手动切换，本次的完成行仍生效（`cli-management-hermes-takeover.test.ts`）；拒绝时显示原因的两项（`cli-update-page.test.tsx`）。
  - 同时修正页面里仍写「30 秒」的三处文案：官方 10 秒，插件下载 5 秒。

- [x] 3.5 修复 Hermes 预取把更新前提交当作目标提交
  - 2026-11-17 Mac Desktop 重测：10 秒规则已触发并开始预取，随后报「INTEGRITY_MISMATCH：Hermes 目标标签提交与计划、回执或发布记录不一致」。两份回执的 `plan.expected_sha` 都是 `3b42157…`、`plan.expected_version` 为 0.23.1，等于 `pre_update.sha`；origin 标签 v0.23.2 的提交是 `ae2a81c…`，GitHub 提交接口返回相同的值。
  - `hermes-watch.ts`：`plan.expected_sha` 只在计划版本等于目标版本时采用，并排除等于 `pre_update.sha` 的提交；否则由 `releaseSha` 查发布标签。
  - 新增 3 项测试（`cli-management-hermes-takeover.test.ts`），Hermes 相关 2 个文件共 107 项通过。失败后 Hermes 仍为 0.23.1，工作区干净，没有残留进程。

- [x] 3.6 修复 Hermes 预取后交回官方又被 10 秒看门狗停掉
  - 2026-11-17 Mac Desktop 再测：点「切换插件下载」后以「OFFICIAL_UNAVAILABLE：官方渠道不可用（OFFICIAL_STALLED），准备切换插件接管」结束，Hermes 仍为 0.23.1。回执显示官方更新被停两次（17:11:25、17:11:51 启动），日志都停在「→ Fetching updates...」。
  - 只读核对：目标提交 `ae2a81c…` 与标签 v0.23.2 已在本地（预取成功）；`.git/FETCH_HEAD` 于 17:11:55 写入目标提交，即第二次官方 fetch 约 4 秒完成；17:11:30 有一个 376 字节的包，对应第一次。安装是 `blob:none` 部分克隆，Hermes `update_cmd.py:1881` 只拉目标提交，随后 `update_cmd_commit.py:568-610` 用 `cat-file --batch` 惰性读取目标文件做语法预检，到 `update_cmd.py:1927` 才写下一行日志。
  - `hermes-watch.ts`：新增 `fetchSettled`，本次运行写出的 `FETCH_HEAD` 含提交、或预取校验通过后交回（`codeReady`）时，不再用 10 秒拉取时钟，`canTakeover` 为否；保留 5 分钟无活动与 20 分钟租约。预取后在 fetch 阶段再次失败的分支因此不会再走到，「准备切换插件接管」不会再作为预取后的最终错误出现。
  - 手动切换路径（`service.ts` 的 `registerOfficialOperation` / `requestTakeover`）核对无误：点击会中止官方进程并进入预取，本次失败发生在预取之后的重跑。
  - 新增 2 项模拟测试（`cli-management-hermes-takeover.test.ts`），在修复前的源码上两项均失败。`corepack pnpm typecheck` 通过；Hermes 相关 3 个文件 129 项通过；全量 360 个文件通过、4 个跳过，8780 项通过、15 项跳过。
  - 未做：真实 `hermes update` 重测（未获授权运行，Hermes 仍为 0.23.1）；17:11:55 之后具体停在哪一步预检没有日志可证，只能确定官方 fetch 已完成。

- [x] 3.7 修复主对话工作目录被删除后「更新 CLI」页整页加载失败
  - 2026-11-17 Windows Desktop 实测：当前会话是旧的 smoke 测试，工作目录 `C:\Users\admin\cw081f1` 已删除，更新页只显示「ENOENT: no such file or directory, lstat 'C:\Users\admin\cw081f1'」和「重试」。v0.9.0 起即有此问题。
  - 原因：`src/host/index.ts` 的 `cliUpdateSnapshot`、`checkCliUpdates`、`startCliOperation`、`checkInstallDirectory` 先用 `projectDirectory`（`realpathSync`）解析会话目录，目录不存在就抛错；更新页本身是整机范围的，不需要项目目录。
  - 修复：去掉这四处的强制解析；`parent()` 本来就在目录存在时登记预加载范围，失败时忽略。
  - 新增测试 1 项（`tests/cli-management-remotes.test.ts`）：会话目录不存在时快照与检查仍返回 17 行；相关 3 个文件 38 项通过，typecheck 通过。

- [x] 3.8 Windows Hermes 预取交回官方后页面仍像「没切换」：显示插件已下载，并识别按标签名写的 FETCH_HEAD
  - 2026-11-17 Windows Desktop（03f46dd 隔离包）用户反馈：Hermes 下载慢、没有变成插件下载、也没有「切换插件下载」按钮。
  - 只读核对：切换记忆有 11-14 的 `OFFICIAL_SLOW`，所以 19:18:11 的官方运行一进入取码就自动切换；插件预取 19:18:43 写入 `refs/tags/v0.23.2` 的 promisor 包（14.7 MB），目标提交 `ae2a81c…` 已在本地。19:18:53 交回官方：Hermes 查最新版本到 19:19:41 才打印「Fetching updates...」，自己的 fetch 到 19:20:39 才写 FETCH_HEAD，19:20:43、19:20:45 惰性补取两个小包；操作在 19:21:53 结束，回执停在 `running`（进程被结束，原因待用户确认）。这段时间 Windows 内存被远端扫描耗尽，19:31 在同一安装上重跑同样的 fetch 只要 1.2 秒，`ls-remote` 1.8 秒。
  - 结论：切换和插件下载都发生了；交回后页面只显示官方的「Fetching updates...」，按设计也不再提供按钮（代码已在本地），看起来像没有切换。另外 Windows 上 Hermes 按标签名拉取，FETCH_HEAD 写的是标签对象 `28f57ed8…\t\ttag 'v0.23.2' of …`，已知目标提交时旧规则认不出。
  - `hermes-watch.ts`：预取交回的重跑在取码阶段显示「插件已下载目标代码，官方更新正在核对并完成（…）」，进入依赖等后续步骤后恢复官方文字；FETCH_HEAD 含目标版本的 `tag 'v<版本>' of` 也算本次取码完成。
  - 新增 2 项模拟测试（`cli-management-hermes-takeover.test.ts`），修复前均失败；Hermes 相关 3 个文件 173 项通过，typecheck 通过。
  - 未做：Windows 实机重测（需要重新部署隔离包并重启 Desktop）。
  - 设计文档 `doc/design.md`「2026-11-17 更快切换插件下载与手动切换」已补充本条。

- [x] 3.9 设置页改为整机 CLI 管理：连接状态、账号、模型清单不再绑定任何目录
  - 2026-11-17 Windows Desktop 用户反馈「CLI 状态全部都报错」。Codex（gpt-6-astra）只读核对：DSH 当前会话 `session-3cd19f3c…` 的工作目录 `C:\Users\admin\cw081f1\live-codex` 及上级都不存在；`readAccountStatus` 等先用 `projectDirectory`（`realpathSync`）解析会话目录，抛 ENOENT，17 个 CLI 一起失败。同一时刻更新页缓存 19:25 检查 17 项全部成功。未取得 Windows 设置页截图。
  - 第一版（提交 a0205f0）用 `settingsProject()` 在目录无效时退到临时空目录，仍以目录为前提和缓存键。用户否定：「cli的连接状态不是只和cli有关吗，为什么一定要绑定一个目录」「这个设置页面只是cli的管理」。本条按最终方案改写，`settingsProject()` 已删除，没有两套并存。
  - 目录在连接链路里的实际作用（代码核对）：
    - 只是缓存键或预加载范围：`SettingsConnectionCache` 的键（项目、CLI、类别）；`cliManagement.context(project)` 每登记一个项目排一轮账号与目录预加载；更新页账号磁盘缓存 `accountKey(cli, project)`；`AccountManager.status` 的在途查询键。
    - 只是进程工作目录或入参校验：Codex app-server 账号读取、Kimi `provider list`、TRAE CN `login status`、WorkBuddy 探测的 cwd；`accounts.ts`、`hermes-accounts.ts`、`pi-omp-accounts.ts`、`pi-omp-logout.ts` 里的 `projectDirectory()` 只校验不取值；MiMo、Hermes、ZCode、Grok、OpenCode、Pi、OMP、Antigravity 的账号读取不使用目录。
    - 确实影响结果（项目级配置）：Claude Code 读 `<项目>/.claude/settings.json`、`settings.local.json` 的 env（`claude-own-route.ts` `readClaudeSettings`）；Codex 从项目向上读 `.codex/config.toml` 的自定义路由（`cli-account-binding.ts` `codexConfigPaths`）；TRAE CN 读 `.trae/traecli.toml`（`traecnStore`）；Qoder 两版读 `<项目>/.qoder*/settings.json`、`settings.local.json`、`.env`（`qoder-accounts.ts`）；CodeBuddy 读项目 `.codebuddy/settings*.json`（`codebuddy-account.ts`）。
  - 最终方案：
    - 整机层（设置页）：`cliSettings`、`settingsConnectionStatus`、`watchSettingsConnections`、`accountStatus`／`refreshAccountStatus`、设置页模型清单、账号登录／退出与图形账号窗口都不解析主对话目录。连接缓存键改为（CLI、类别），快照、回执、订阅协议去掉 `project` 字段，客户端同步去掉项目比对。后台连接预加载在 Host 启动时每个 CLI 排一次。更新页账号磁盘缓存按 CLI。`context(project)` 改名 `protectProject`，只保留「安装目录不得落在已知项目内」的保护。
    - 进程工作目录：`machineDirectory()` 返回 `<插件数据目录>/machine-scope`（0700，拒绝符号链接与他人所有，始终为空）。它不来自任何会话、不是缓存键、不含项目级 CLI 配置；不用系统临时目录，因为会被系统清理，Linux `/tmp` 的上级还可能被他人放入配置。账号模块的入参校验由 `projectDirectory` 改为 `processDirectory`（绝对路径、存在、非根非主目录）。
    - 项目层（主对话）：派遣、续聊、Worker 模型菜单、保存项目模型偏好仍走 `project()`，保留报错「此主对话没有工作目录，请先选择项目」「此主对话的工作目录已不存在（…），请切换到有效项目」。设置页模型清单按整机口径（只读用户级配置）；主对话没有可用项目时不带出偏好（`settingsCache.project` 为 `no-project`）。`configure` 保存偏好时仍按项目核验，绑定不同则按项目重新授权（既有行为）。`SettingsCatalogCache` 仍按来源目录存：设置页传整机目录，派遣与 Worker 菜单传项目。
  - 规格：本变更 `specs/cli-update/spec.md` 新增「设置页是整机 CLI 管理」，修改「分层缓存」「项目连接状态静默预加载与缓存消费」「连接快照、过期更新与来源作废」；新增 `specs/cli-model-discovery/spec.md` 修改「设置模型目录持久保存与启动刷新」。`corepack pnpm spec validate --all --strict --no-interactive`：40 项通过。
  - 测试（均为模拟，不登录、不调用模型）：
    - `tests/cli-management-remotes.test.ts` 新增 2 项：没有目录、目录已删、两个不同项目四种主对话得到同一份账号状态和同一检查时间，账号只探测 1 次，探测目录是空的 `machine-scope`，回执不含 `project`；没有可用项目时设置快照、订阅、模型清单照常返回且不带偏好，模型清单只查 1 次，有项目的主对话看到同一份清单并带出自己的偏好，项目操作仍报原文案。
    - 改写既有用例：连接缓存 14 项去掉项目参数；预加载「每个 CLI 各排一次、登记两个项目不增加连接项」；更新页账号缓存按 CLI；设置窗口「无论主对话项目如何都使用整机快照」；账号入口断言工作目录为整机目录。
    - 修复前失败的确认：把 `src` 退回 HEAD（a0205f0）后新增与改写用例 14 项失败（回执含 `project`、偏好被带出、无 `protectProject`）；退回 HEAD~1 后两项新增用例报「此主对话没有工作目录，请先选择项目」。
    - `corepack pnpm typecheck` 通过。
    - 全量 `corepack pnpm exec vitest run`：360 个文件通过、4 个跳过，8785 项通过、15 项跳过，0 项失败。
    - `corepack pnpm build:preview` 生成隔离包成功。
    - 测试不再在真实 `~/.dsh/cliworker-now` 下创建 `machine-scope`：5 个夹具补了 `stateDirectory`，全量运行后确认该目录不存在。
  - 兼容：旧客户端（热启用未刷新）收到不含 `project` 的快照会判为无效并退回逐个 CLI 的旧读取，不会报错。
  - 遗留：`CliPreloader.enqueue` 不再有生产调用方，本次未删（有两项独立用例）。
  - 未做：Windows 与 Mac Desktop 实机重测；真实 CLI 账号读取与登录窗口在整机目录下的实测（未登录、未退出、未切换任何真实账号）。

- [x] 3.10 ZCode 已配置自有 API 时设置页圆点显示绿色
  - 2026-11-17 Mac Desktop（c919720 正式构建）Codex CU 只读检查：17 个 CLI 中 15 个绿色；ZCode 灰色，文字「已配置 ZCode API」；WorkBuddy 灰色，因为未安装。用户要求：ZCode 配了 API 应显示绿色。
  - 原因：ZCode 自有 API 的 Host 状态是 `configured`（`zcode-grok-accounts.ts` 的 `withZCodeProviderRows` 与绑定分支、`zcode-adapter.ts`），客户端把 `configured` 一律画成中性；MiMo、Codex、Claude 的 API 登录是 `authenticated`，所以是绿色。
  - 不改 Host 状态：一开始改成 `authenticated` 后有 8 项 ZCode 测试失败。通用退出判定 `account-guide/engine.ts` 要求退出后状态不是 `authenticated`，自有密钥还在时，整账号退出会被判为失败。改为在 `settings-connection-view.ts` 的 `connectionState` 中，把 `cli === 'zcode'`、`state === 'configured'`、`authMethod === 'api'` 并有核验来源的状态视为已连接，回执过期时仍显示过期。`settings-dialog.tsx` 绿点文字沿用 Host 摘要（「已配置 ZCode API」「已配置 ZCode API；登录已过期」）。ZCode「账号绑定未确认」和其他 CLI 的「已配置」（如 Qoder PAT 待验证）仍为中性。
  - 新增 2 项模拟测试（`settings-connection-view.test.ts`、`settings-dialog.test.tsx`），修复前均失败；圆点、设置弹窗与 ZCode 相关 16 个文件共 641 项通过、1 项跳过；typecheck 通过。
  - 未做：Desktop 实机复看。

- [x] 3.11 Windows Hermes 更新后误报「版本仍为 0.23.1」，Node 依赖阶段慢且改名失败
  - 2026-11-17 Windows Desktop（c919720 隔离包）Codex CU 实测：20:47 点 Hermes「更新」，约 9.5 分钟后该行报 `VERSION_UNCHANGED`「命令已完成，但版本仍是 0.23.1」，侧栏圆点变红。用户同时反馈安装很慢。
  - 只读核对：
    - 回执 `latest.json` 为 `success`，`post_update` 为 0.23.2、`ae2a81cc…`。阶段时间：apply 20:48:30，即取码加切换 39 秒；deps 20:50:37，Python 依赖约 2 分钟，其间有一次 `IncompleteRead` 重试；build 20:57:10 失败，Node 依赖约 6.5 分钟；20:57:18 结束。
    - `update.log`：`node-deps.mjs` 的 `moveAside` 把 `hermes-agent\node_modules` 改名到 `.cache\node-deps-previous` 时报 `EPERM`；释放说明刷新 30 秒超时；最后一行是「✓ Update complete! (v0.23.1 → v0.23.2)」。11-14 两次更新的 Node 依赖都成功，今天是第一次出现改名失败。
    - `hermes --version` 为 v0.23.2，HEAD 是 `ae2a81cc…`，`git describe` 为 v0.23.2。
    - `install-stamp.json` 没有改写，仍是 0.23.1 和 `3b421578…`。`refs/tags/v0.23.2` 指向注释标签对象 `28f57ed8…`，该对象在包内，不是松散对象。
  - 版本误报原因：`hermes-version.ts` 只解码松散标签对象，读不出版本时回落到 install-stamp 的 0.23.1。修复：标签无法证明时，读 Hermes 自己的 `logs/update_receipts/latest.json`。只有 `outcome` 为 success、`post_update.source` 为 git、`post_update.sha` 等于当前 HEAD、版本为稳定三段号时才采用。
  - 慢与改名失败：Node 依赖由 Hermes 自己执行，插件不能加速。插件在依赖和构建阶段每秒递归遍历检出目录的三个 `node_modules`（每个最多 10 万项），还有 npm/pnpm 缓存。Windows 上目录内有打开的句柄时不能改名，这可能占住句柄、加重 I/O；当时实际持有句柄的进程已无法回放，所以只是可能原因，未证实。修复（`hermes-watch.ts`）：Windows 不再遍历检出目录的 `node_modules`；依赖树的遍历从每秒一次降为每 15 秒一次，只用于 5 分钟和 20 分钟活动窗口；Hermes 自己的缓存、输出、日志与回执照常计入。
  - 新增 2 项模拟测试（`cli-management-hermes-version.test.ts`、`cli-management-hermes-takeover.test.ts`），修复前均失败；Hermes 相关文件通过，typecheck 通过。
  - 全量 vitest（含 3.10、3.11）：360 个文件通过、4 个跳过，8789 项通过、15 项跳过、0 失败。
  - Windows 现状：Hermes 代码已是 0.23.2；TUI 和网页的 Node 依赖构建未完成，Hermes 提示下次启动或 `hermes update` 时重试。本次 Hermes 官方取码只用了 39 秒，没有触发切换，因此 3.8「插件已下载目标代码」的显示未在实机覆盖。
  - 同轮 Windows 设置页实测（会话目录 `C:\Users\admin\cw081f1\live-codex` 不存在，未切换会话）：17 个 CLI 圆点全部为绿色，没有出现「失败」「ENOENT」「工作目录」；Codex、Claude Code 的账号与模型下拉正常。Windows 隔离回归 7f7d0214（c919720）共 1032 项：1024 项通过、0 失败、8 项跳过。
  - 未做：新修复的 Windows 实机重测。

## 4. 验收 〔测试｜3h｜前置 1,2,3〕

- [x] 4.1 全量 vitest、类型检查、`build:preview` 与 Codex 审查
  - 2026-11-17 Mac：`pnpm typecheck` 通过；全量 vitest 360 个文件通过、4 个跳过，8772 项通过、15 项跳过；`build:preview` 通过。
  - 两轮 Codex 审查的发现均已修复：取消核对提前释放维护锁、缺失可执行文件未判为损坏、Grok「downloaded」行未识别、`captureReadOnly` 等待退出无上限、数字回退误续期。
- [ ] 4.2 Mac Desktop 实测：Grok、Qoder 更新的自动切换、手动切换、取消（使用 `~/.cache/cliworker-test-backups/2026-11-17/` 的备份回滚后重复测试）
  - 2026-11-17 Mac Desktop（aca5b85 正式构建）用户实测结果：
    - Grok：1.0.77 → 1.0.88（`~/.grok/bin/grok` 16:39 指向 1.0.88），切换记忆 16:39:17 记为 `OFFICIAL_STALLED`，即官方下载 10 秒无进展后自动切到插件下载并完成。
    - Qoder：1.1.89 → 1.1.90（`~/.qoder/bin/qodercli/version.txt` 16:39:54 写入），206 续传修复后完成。
    - Hermes：手动「切换插件下载」先后暴露 3 个问题（旧日志完成行、更新前提交当作目标、取码后静默预检被当成停滞），修复见 3.4–3.6；18:34 的一次官方更新顺利越过取码阶段，`Update complete! (v0.23.1 → v0.23.2) [detached @ ae2a81ccc0]`，`hermes --version` 为 0.23.2。
  - 未验证：新构建下 Grok、Qoder 的手动切换，以及取消后的四种核对结果（只有模拟测试）。
- [ ] 4.3 Windows 回归与实机（等 Windows 连上）
  - 2026-11-17 晚 Windows 隔离回归 37e3d6c3（aca5b85，config-d.json）：1032 项中 1024 项通过、0 失败、8 项跳过。
  - Windows Desktop 已部署同一源码的隔离包（1322 个文件与清单一致，Host `lib/index.js` 与 Mac 正式构建相同，SHA-256 `e1d5f40e…`），实机更新测试进行中。
- [x] 4.4 同步 README、`doc/usage-details.md` 与设计文档中的时限和按钮说明
  - README.md 下载续传段与双通道段、README.en.md 对应段落、`doc/design.md`「2026-11-17 更快切换插件下载与手动切换」。`doc/usage-details.md` 没有涉及这些时限的内容，未改。
