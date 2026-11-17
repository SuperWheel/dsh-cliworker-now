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

## 4. 验收 〔测试｜3h｜前置 1,2,3〕

- [x] 4.1 全量 vitest、类型检查、`build:preview` 与 Codex 审查
  - 2026-11-17 Mac：`pnpm typecheck` 通过；全量 vitest 360 个文件通过、4 个跳过，8772 项通过、15 项跳过；`build:preview` 通过。
  - 两轮 Codex 审查的发现均已修复：取消核对提前释放维护锁、缺失可执行文件未判为损坏、Grok「downloaded」行未识别、`captureReadOnly` 等待退出无上限、数字回退误续期。
- [ ] 4.2 Mac Desktop 实测：Grok、Qoder 更新的自动切换、手动切换、取消（使用 `~/.cache/cliworker-test-backups/2026-11-17/` 的备份回滚后重复测试）
- [ ] 4.3 Windows 回归与实机（等 Windows 连上）
- [x] 4.4 同步 README、`doc/usage-details.md` 与设计文档中的时限和按钮说明
  - README.md 下载续传段与双通道段、README.en.md 对应段落、`doc/design.md`「2026-11-17 更快切换插件下载与手动切换」。`doc/usage-details.md` 没有涉及这些时限的内容，未改。
