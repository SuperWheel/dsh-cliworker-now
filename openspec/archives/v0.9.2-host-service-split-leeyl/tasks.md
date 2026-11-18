## 1. 领域切分与基线 〔后端｜4h〕

- [x] 1.1 列出全部 80 个 Remote 方法与内部辅助方法各自使用的 `this` 字段，确定领域划分与上下文对象内容，写入 design.md
  - 设计与基线说明提交 `52e5edf`，基准源码 `086b865`。TypeScript AST 核得 80 个 Remote（74 个直接调用、6 个流）、48 个内部方法及构造函数。决定 5 逐方法列出依赖，机器清单在 `.test-data/baseline/methods.json`。
- [x] 1.2 记录拆分前基线：预览包的 `lib/typert.remote-client.d.ts`、`lib/` 文件清单与 SHA-256、全量测试通过数
  - `corepack pnpm build:preview` 成功。五份 Typert 原件、发布范围 1325 个文件（含包必带的 LICENSE）及整个预览目录 12244 个普通文件的 SHA-256，另有 845 个依赖链接的目标清单，均在 `.test-data/baseline/`。干净 worktree 尚无 `lib`，首次根目录类型检查报缺少自身的 Remote 声明。验收期间临时将 worktree 根的 `lib` 链接到本地预览产物以解析 Client 自引用，结束时移除临时链接。
  - `corepack pnpm typecheck` 通过。`corepack pnpm lint` 0 error、333 warning（no-explicit-any 252、no-floating-promises 1、import-x/no-cycle 31、no-empty 25、exhaustive-deps 24）。
  - `corepack pnpm exec vitest run --config .test-data/vitest-local.ts`：362 个文件通过、4 个跳过。8841 例通过、15 跳过、0 失败。临时配置合并原配置，仅为两组 Unix 套接字夹具设置可从子进程目录解析的短 TMPDIR，为使用仓库 cwd 的 Qoder 夹具选择空 HOME。其余共用 worktree 内临时目录与 HOME。保留代理。本机监听需要沙箱外运行。详见 `.test-data/baseline/verified.log`。

## 2. 按领域拆分 〔后端｜16h｜前置 1〕

- [x] 2.1 Harness 会话与 DSH 子 Agent
  - 本地提交 `a6e9cfa`。提交前 `corepack pnpm typecheck` 通过，全量 Vitest 8841 通过、15 跳过、0 失败。`corepack pnpm lint` 0 error、333 warning。31 条 import-x/no-cycle 的文件及依赖链与基线相同。日志在 `.test-data/step-1/`。
- [x] 2.2 历史、运行中消息设置与角色预设
  - 本地提交 `56d462f`。提交前 `corepack pnpm typecheck` 通过，全量 Vitest 8841 通过、15 跳过、0 失败。`corepack pnpm lint` 0 error、333 warning。31 条 import-x/no-cycle 的文件及依赖链与基线相同。日志在 `.test-data/step-2/`。
- [x] 2.3 Worker 管理（改名、目标、删除、恢复、分叉）
  - 本地提交 `7dba0f8`。提交前 `corepack pnpm typecheck` 通过，全量 Vitest 8841 通过、15 跳过、0 失败。`corepack pnpm lint` 0 error、333 warning。31 条 import-x/no-cycle 的文件及依赖链与基线相同。日志在 `.test-data/step-3/`。
  - 首次全量为 8840 通过、15 跳过、1 失败。Hermes 模拟桥等待夹具回调超时，原文件单跑 11/11 通过，完整重跑通过后提交。详见 `.test-data/step-3/vitest-first.log` 和 `hermes-focused.log`。
- [x] 2.4 通用设置与 CLI 启用
  - 本地提交 `f51bf98`。提交前 `corepack pnpm typecheck` 通过，全量 Vitest 8841 通过、15 跳过、0 失败。`corepack pnpm lint` 0 error、333 warning。31 条 import-x/no-cycle 的文件及依赖链与基线相同。日志在 `.test-data/step-4/`。
- [x] 2.5 CLI 管理与更新
  - 本地提交 `3cad4f5`。提交前 `corepack pnpm typecheck` 通过，全量 Vitest 8841 通过、15 跳过、0 失败。`corepack pnpm lint` 0 error、333 warning。31 条 import-x/no-cycle 的文件及依赖链与基线相同。日志在 `.test-data/step-5/`。
- [x] 2.6 连接与账号
  - 本地提交 `ce43b8f`。提交前 `corepack pnpm typecheck` 通过，全量 Vitest 8841 通过、15 跳过、0 失败。`corepack pnpm lint` 0 error、333 warning。31 条 import-x/no-cycle 的文件及依赖链与基线相同。日志在 `.test-data/step-6/`。
- [x] 2.7 模型目录、选型与权限
  - 本地提交 `f88b94f`。提交前 `corepack pnpm typecheck` 通过，全量 Vitest 8841 通过、15 跳过、0 失败。`corepack pnpm lint` 0 error、333 warning。31 条 import-x/no-cycle 的文件及依赖链与基线相同。日志在 `.test-data/step-7/`。
- [x] 2.8 消息发送与续聊队列
  - 本地提交 `31bfcc2`。提交前 `corepack pnpm typecheck` 通过，全量 Vitest 8841 通过、15 跳过、0 失败。`corepack pnpm lint` 0 error、333 warning。31 条 import-x/no-cycle 的文件及依赖链与基线相同。日志在 `.test-data/final/`。
- [x] 2.9 index.ts 少于 1000 行、每个领域模块不超过 1000 行。每个领域单独提交，提交前类型检查与全量测试通过
  - `wc -l src/host/index.ts src/host/service-*.ts`。入口 3768 → 771 行，新增 16 个模块，最大为 service-harness.ts 的 618 行。逐文件计数保存在 `.test-data/final/lines.txt`。
  - 去掉文件名前缀 `service-` 后，各模块行数为 accounts 543、cli-updates 215、connections 287、context 126、dispatch 445、errors 28、harness 618、history 230、launch 213、lifecycle 261、messages 376、models 327、permissions 411、settings 130、tools 302、workers 156。
  - TypeScript 语法树核对 80 个 Remote、48 个内部方法及构造回调，替换已搬迁的上下文引用后，128 个方法体及原构造注册、释放顺序均一致。两个独立 Cordis 调用作用域执行真实门面函数，分别取得自己的 ctx，并读写同一标量和 Map。
  - 测试新增共享夹具 `tests/fixtures/host-service.ts`，为合成门面装配每实例上下文。以下 29 个原测试仅调整内部访问路径或夹具导入。逐文件比较共 3261 条 `expect(...)` 调用链，还原访问路径后语法一致。
  - `tests/` 下的 `account-lifecycle-races.test.ts`、`account-settings-start.test.ts`、`agy-run-outcome.test.ts`、`busy-account-catalog.test.ts`、`cleanup-persistence.test.ts`。
  - `tests/` 下的 `cli-executable-management.test.ts`、`cli-management-admission.test.ts`、`cli-management-manual-takeover.test.ts`、`cli-management-remotes.test.ts`、`cli-settings.test.ts`。
  - `tests/` 下的 `custom-provider-remotes.test.ts`、`dispatch-flow.test.ts`、`followup-queue.test.ts`、`harness-model-guard.test.ts`、`harness-service-integration.test.ts`。
  - `tests/` 下的 `harness-turn-usage.test.ts`、`host-plan-state.test.ts`、`host-worker-snapshot.test.ts`、`native-approval-relay.test.ts`、`qoder-routing.test.ts`。
  - `tests/` 下的 `role-dispatch.test.ts`、`routing.test.ts`、`settings-connection-preload.test.ts`、`settings-dialog.test.tsx`、`sibling-dispatch.test.ts`。
  - `tests/` 下的 `workbuddy-registration.test.ts`、`worker-goals.test.ts`、`worker-management.test.ts`、`worker-permissions.test.ts`。

## 3. 契约与回归验证 〔测试｜4h｜前置 2〕

- [x] 3.1 拆分后预览包与基线对比：远程契约逐字节一致，`lib/` 只新增领域模块产物
  - `corepack pnpm build:preview` 成功。逐字节比较两份 Typert 声明，逐方法核对全部 80 份签名、装饰器和 JSDoc。JS 还原 80 处 sourceLocation 后逐字节相等，声明映射解码后仅原始源码坐标改变，生成坐标、方法名和源文件全等。以下 SHA-256 均针对原始文件。
  - `typert.host.d.ts`：前后均为 `5e2d26ee86d0fe170dac8cd3f5854e67bdea334c57f40a5766ace57b8304c17d`。
  - `typert.host.js`：`2253b59c9a5b0a0827ede1fee9ff22ac61c9d866ba5710bb49f71fe95418752f` → `3181981a60ea8605e5f7c74263d6af70ecbbafb49a009dd570b2f34daaea9e48`。
  - `typert.remote-client.d.ts`：前后均为 `ee2d2fc8383376a03d3f61100d2385a2711862ac53c2d8fdc31098d5e440cf6d`。
  - `typert.remote-client.d.ts.map`：`3880b173a5873a5959a347388d11e3a26977b0839c30d875ef34dbbaaae807e9` → `1cac397dc3046cfa81324bb6549471bc2a738852dfa209d36e00ec03d4198f72`。
  - `typert.remote-client.js`：`69672087a1887a7d52beee35a88bafb3e845fa2f375c74d5b8e50c47d835264f` → `f6c6b3397290024b996bf574ad96af4707c90725e31d48c496bd4904339ca7ea`。
  - 发布范围 1325 → 1373 个文件，新增的 48 个全部是 16 个模块各自的 .js、.d.ts、.js.map，删除 0 个，1315 个原文件哈希相同。已有产物的 10 项差异如下。
  - `lib/index.js` 内联 Host 领域实现，`lib/index.js.map` 记录新的源文件和映射。
  - `lib/types/host/index.js` 编译出门面委托，`lib/types/host/index.js.map` 对应缩短后的入口。`lib/types/host/index.d.ts` 的公开声明与导入相同，私有成员声明由 75 项变为 2 项。
  - `lib/typert.host.js` 与 `lib/typert.remote-client.js` 含新的方法源码坐标。`lib/typert.remote-client.d.ts.map` 将相同的声明位置指向新的原始位置。
  - `lib/client.js` 内联 Remote 描述符，除 80 个方法源码位置以外字节相同。`lib/client.js.map` 仅替换该内联源文件内容，238108 个映射段逐个对齐，240 个原始位置差异均由坐标数字长度解释。
  - 整个预览目录 12244 → 12372 个普通文件，新增 128、删除 0、原文件改变 15、原文件相同 12229。845 个依赖符号链接的路径和目标相同。除上述 10 项外，5 项是 `src/host/index.ts`，以及 Typert 暂存目录同一份源码、入口 .js、.d.ts、.js.map 的副本。每个新模块贡献 8 个暂存或发布文件。
  - 文件级原因、清单与原始哈希分别见 `.test-data/final/comparison.json`、`.test-data/{baseline,final}/preview.json`、`.test-data/{baseline,final}/package.json` 与 `.test-data/final/contracts.json`。
- [x] 3.2 `pnpm lint` 0 error，不新增 warning 与 import 循环。`pnpm spec:check` 通过
  - 最终编译、Vitest 与 lint 数量见 2.8。`corepack pnpm spec:check` 37 项通过、0 失败。`corepack pnpm spec validate v0.9.2-host-service-split-leeyl --strict` 通过。嵌套 pnpm 通过 `.test-data/bin/pnpm` 转发到 Corepack。
  - 按 `tsconfig.tests.json` 对基准和最终源码另外做完整诊断比对，947 项存量诊断的文件、错误码和消息多重集完全相同。
  - 2026-11-18 主会话复验：逐条核对测试改动，去掉 `['host']` 访问层与夹具构造后增删行一致，断言没有变化；`vitest.config.ts`、`scripts/build.mjs`、`cordis.patch.yml`、`package.json`、锁文件、`src/host/runtime.ts`、Client 与 Shared 均无改动。快进合并到 main（`720693b`）后，`pnpm typecheck` 通过；全量 Vitest 362 个文件通过、4 个跳过，8841 例通过、15 跳过、0 失败；`pnpm lint` 0 error、333 warning；`pnpm spec:check` 37 项通过；`pnpm build:preview` 的 `lib/typert.remote-client.d.ts` 与基线 `cmp` 一致（SHA-256 `ee2d2fc8…cf6d`）。日志在仓库外 `cliworker-now-test/test/2026-11-18-host-service-split-verify/`。
  - 拆分 worktree 已在合并后移除。上文 `.test-data/baseline/` 与 `.test-data/final/` 的文件已复制到同一目录的 `codex-baseline/`（不含源码与 `lib` 副本）和 `codex-final/`；各步骤的 `.test-data/step-N/` 日志没有保留，逐步数字以本文件记录为准。
  - 按提交运行 `corepack pnpm format:check`。本变更涉及的 29 个原测试中，27 个文件在基准源码上即有 Prettier 差异。最终仓库检查还包括有存量差异的 `doc/design.md`。保留这些文件的原文与断言，入口、新模块及新增夹具通过单独的 Prettier 检查。
- [x] 3.3 Windows 远程隔离运行 Windows CI 测试文件
  - 2026-11-18 `pnpm test:windows:remote --config .test-data/windows-remote/config-d.json`（远程根目录在 D 盘）。首次运行 `afe36491…` 在 Windows typecheck 失败：`2fbe8ab` 让构建脚本引用 `scripts/build-host-copy-manifest.mjs` 与 `scripts/host-targets.json`，远程快照白名单未同步，与本拆分无关。`2da7268` 补入白名单，并在 `tests/windows-remote.test.ts` 新增「上传的构建脚本引用的本地模块必须同在白名单」用例（修复前该用例失败，修复后本文件 29/29 通过）。
  - 重跑 `e4b8050d-efc4-4e74-ad51-d969daf562e2` 全部阶段通过：install、包清单与条目、解包、Mac 契约类型、Windows typecheck、Windows 测试 31 个文件全部通过（1025 例通过、8 跳过，与 2026-11-17 v0.9.1 发布验收 1025/8 相同）、Mac 打包产物在 win32 x64 上加载出 `CliWorkerService`。证据在仓库 `.test-data/windows-remote/runs/e4b8050d-…/`，运行日志在 `cliworker-now-test/test/2026-11-18-host-service-split-verify/windows-remote-2.log`。
- [x] 3.4 Mac Desktop 实测：设置页、派遣、续聊、停止与 CLI 更新页
  - 2026-11-18 确认 Desktop 无活动任务后退出，在 main（`881b09d`）执行 `pnpm build`；profile 以 `link:` 加载仓库，`lib/types/host/` 含新模块产物，`lib/typert.remote-client.d.ts` 与预览包 `cmp` 一致。以无障碍与防节流参数启动 DSH Desktop 0.2.2-rc.3，由 Codex Computer Use（gpt-6.2-sol high）操作真实窗口，未重载、未改设置。
  - 设置页：「CLI Worker 设置」正常渲染，「CLI 连接」列出 17 个 CLI；Codex 显示「已登录」、项目默认 GPT-6-Luna · Low。流程结束后再次打开仍正常。
  - 更新 CLI 页：从「正在检查」变为「检查完成：8 个可更新」（可更新 8、已是最新 8、未安装 1），各 CLI 版本行显示；未点击任何更新按钮。
  - 派遣：主对话调用 CLI Worker 派遣一个 Codex Worker（Codex 0.169.0、gpt-6-luna、Low，确认卡选「沿用」）。Worker `27ac8c44-75b2-4463-be3c-4fc081a2b9fc` 的 `events.jsonl`：run `99c63c8f…` 依次为 queued、「本轮权限：自动审批」、「CLI 已连接」（observedModel gpt-6-luna）、result SUCCESS、completed（06:34:20Z→06:34:33Z）。
  - 续聊：同一 Worker 子会话窗口发送，run `dd92b750…` 经续聊队列（queuedFollowupId → admittedRunId）进入，result SUCCESS、completed（06:35:23Z→06:35:36Z），两轮历史同时保留。
  - 停止：第三轮 run `746d5744…` 开始输出后点击「停止生成」，事件为 result ERROR（resultScope run，保留部分正文）后 status「已停止」（interrupted，06:37:02Z），与 2026-11-15 拆分前三个已停止 Worker 的事件顺序相同；界面无错误对话框，历史可查看；停止后 Desktop Host 进程下无残留子进程。
  - 三轮 stderr 均为用户 Codex 配置中 Cloudflare MCP 未授权（AuthRequired）的诊断，与本变更无关。截图未落盘（Codex 沙箱拒绝写入）；主对话派遣使用了一次主 Agent 模型调用。

## 4. 文档 〔产品｜1h｜前置 2〕

- [x] 4.1 `doc/design.md` 更新 Host 模块结构说明
  - `doc/design.md` 的“结构与接口”下新增 Host 服务模块一节，列明入口、上下文、生命周期及各模块职责。逐方法索引和字段读写见本变更 design.md 的决定 5。
