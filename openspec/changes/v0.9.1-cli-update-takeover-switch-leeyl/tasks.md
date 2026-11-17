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
