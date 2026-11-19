# Tasks

## 1. SDK 来源、差异与构建目标 〔后端｜4h〕

- [ ] 1.1 在指定独立 worktree 实施，记录升级前提交、锁文件非 DSH 包集合及同环境 macOS 全量 Vitest 基线，复核 npm 发布时间、tag commit、Desktop 版本和自带 `dsh` 版本。
  - 实施 worktree 为 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/worktrees/2026-11-19-dsh-rc5-adapt`。
  - 独立验收目录为 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-19-dsh-rc5-adapt`，用于干净安装对照、临时 `HOME`／`DSH_HOME`、验收工作区及产物。测试根和私有验收目录权限为 0700。
  - （未执行：当前为提案阶段，待创建实施环境和采集回归基线。）
- [ ] 1.2 对两套实际安装的 rc.3 与 rc.5 npm 产物逐包比较，核对 Gateway、Remote、Typert、扩展点、主题 token、共享组件、四包及 Cordis。将公开导出、生成类型、运行产物、资源的实际差异和「需适配」或「无需改动」的依据补入设计。若发现破坏性变化，完成最小兼容修正并通过关联测试。
  - （未执行：已安装 npm 包的逐包对比待实施。）
- [ ] 1.3 将 `package.json` 的 39 个 `@deepseek-ai/dsh*` 开发依赖同步为精确的 0.2.2-rc.5，更新 `pnpm-workspace.yaml` 发布期限例外和 `pnpm-lock.yaml`。以 `pnpm install --frozen-lockfile` 复核，并比较锁文件非 DSH 包集合与基线逐项一致。
  - （未执行：待升级并冻结依赖。）
- [ ] 1.4 在 `scripts/host-targets.json` 注册 rc.5 并将 `vendorDefault` 指向它，核对 `scripts/build-dependencies.mjs`、`scripts/build-host-extension.mjs`、`scripts/vendor-host-extensions.mjs` 对新旧目标的选择与校验。更新当前基线的 `build-dependencies`、`clean` 测试并跑定向回归，旧目标和不支持目标的断言均通过。
  - （未执行：待接入新目标。）

## 2. 四个原生界面包的补丁迁移与分发 〔后端｜5h｜前置 1〕

- [ ] 2.1 在官方 rc.5 commit 建干净与补丁工作树，三方迁移 rc.3 的 48 文件补丁，导出 `host-extensions/dsh-0.2.2-rc.5/source.patch`。对比旧补丁的文件清单和内容，记录任何差异和处理原因，验证补丁反向应用及 `git diff --check`。
  - 上游干净与补丁工作树分别放在 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/worktrees/2026-11-19-dsh-rc5-upstream-clean` 和 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/worktrees/2026-11-19-dsh-rc5-upstream-patched`。
  - （未执行：待创建上游对照工作树及迁移补丁。）
- [ ] 2.2 同步 rc.5 的独立构建依赖、锁文件和 workspace 清单，冻结安装复核。使用相同 Node、代理和依赖配置分别运行补丁前后的 `ui-session`、`ui-conversation`、`ui-subagent`、`ui-chat` 上游 Vitest。按包记录通过、失败、跳过数，逐项追溯并处理失败。
  - （未执行：待冻结独立依赖及运行补丁前后对照。）
- [ ] 2.3 准备依赖链接、通过四包类型检查，运行 `node scripts/build-host-extension.mjs --target 0.2.2-rc.5` 及同目标 `--verify`。用 `node scripts/vendor-host-extensions.mjs --from <经校验的产物目录>` 更新 `runtime-host/`，再以不带参数的 vendor 命令复核。核对四包 `package.json` 及 manifest 均指向 rc.5、继承的 Host 和声明文件及 ui-chat 图片与官方同版本包逐字节一致，并通过 `tests/host-runtime-package.test.ts`。
  - （未执行：待构建和校验随包资源。）
- [ ] 2.4 在独立夹具验证 rc.3 旧目标的 `build-host-extension --verify` 及显式 vendor 路径可用，复核 rc.5 随包清单和旧目标资产均未被夹具覆盖。
  - （未执行：待复用旧目标的已校验产物或按固定来源重建。）
- [ ] 2.5 同步 `README.md`、`README.en.md`、`doc/design.md`、`doc/protocols/native-conversation-host-extension.md` 和生成的 `runtime-host/README.md` 的当前宿主适配版本。核对新扩展目录 README 的来源和构建说明，检索所有当前适配版本文字均为 0.2.2-rc.5，旧版本历史及对应证据可查。
  - （未执行：待确认本次最终构建来源及验收范围。）

## 3. 插件回归与隔离 Web 宿主 〔测试｜4h｜前置 2〕

- [ ] 3.1 核对 `tests/host-plan-state.test.ts`、`tests/cli-update-layout.test.ts` 和 `src/host/host-plan-state.ts` 的 rc.3 注释或基线。当前宿主规则或窗口尺寸以 rc.5 实际依据为准，保留已有的历史调查记录和模拟标记。先跑相关回归，再运行 `pnpm typecheck`（输出 `Host/Client typecheck passed against DSH 0.2.2-rc.5`）、macOS 全量 Vitest（零失败且通过数不少于 1.1 基线）、`pnpm lint`（零 error、无新增 warning）和 `pnpm format:check`。
  - （未执行：待依赖和随包资源对齐后验证。）
- [ ] 3.2 执行 `pnpm build:preview` 生成隔离预览包，复核包内 Host、Client、Remote 与四个 rc.5 随包资源的清单、版本和摘要。
  - （未执行：待生成预览包。）
- [ ] 3.3 用 Mac Desktop rc.5 自带的 `dsh` 将预览包装入隔离 `DSH_HOME` 的 Web profile 并启动 `dsh web`。从有效配置与实际模块路径核对四包均解析到插件 `runtime-host/`，检查主界面、CLI Worker 面板、设置无白屏，检查控制台及 Host 日志无插件相关错误。
  - （未执行：待生成预览包并启动隔离宿主。）

## 4. Desktop 实机验收 〔测试｜3h｜前置 3〕

- [ ] 4.1 人工验收 Mac Desktop 加载。确认无活动 Worker 后执行正式构建，确认 Desktop 链接解析到本次构建，冷启动 0.2.2-rc.5，核对插件加载、原生会话视图、CLI Worker 面板与设置。记录应用和自带 `dsh` 的版本、可取得的应用构建标记及插件日志。
  - （未执行：待隔离验收通过及安排 Mac Desktop 实机操作。）
- [ ] 4.2 人工验收 Mac Desktop 真实派遣与续聊。确认主对话模型已有选型授权及可用额度、目标 CLI 已登录，在指定验收工作区由主 Agent 派遣一次并观察选型卡片。核对完成事件、退出状态、实际产物，续聊一次并核对沿用同一原生 CLI 会话。
  - （未执行：待 Mac Desktop 加载验收、真实模型及 CLI 条件就绪。）
- [ ] 4.3 人工验收 Mac Desktop 停止。经授权启动一项可观察的 Worker 任务，从面板停止，独立核对终态与进程范围已退出。本次遇到原生审批时同时记录审批转交的实际结果。
  - （未执行：待 Mac Desktop 加载验收和可停止的实机任务。）
- [ ] 4.4 Windows Desktop 由用户安排基础加载与派遣检查。确认实际宿主版本和插件来源，核对面板及设置可用，并记录获授权派遣的事件、退出状态和实际产物。Windows 实机本项只做基础检查；Windows CI 定向检查按发布规格执行。
  - （未执行：等待用户安排 Windows rc.5 环境和调用条件。）

## 跟进

- 达到实施验收要求后按项目流程合并并清理已合入的 worktree 和分支，并保留指定测试根内仍有用的证据。发布验收另按 `development-workflow` 执行，保留尚未验证的账号、模型与平台范围。
