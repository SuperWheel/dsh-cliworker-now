# Tasks

## 1. 证据与方案

- [x] 1.1 用隔离 HOME/合成凭据核对 Mac Pi/OMP 退出，Windows 只读核对安装接口与登录选项；记录错误原文、来源和未复现项。
  - 2026-11-09：用户决定按已完成关闭；本项没有补做上文所列的真实验收，原记录保留。
- [x] 1.2 对照全部 CLI 登录入口，记录缺失项与原生能力边界。

## 2. 实施与关联回归

- [x] 2.1 修复 Pi/OMP 指定凭据退出及确认，补充隔离原生、模拟 Windows 菜单和替换回归。
- [x] 2.2 按安装发现 Pi/OMP 登录选项，补齐智谱地区文案与 i18n，测试平台/版本、别名、失败与取消。
- [x] 2.3 同步 README、README.en.md、doc/design.md；记录认证失败提示建议，不修改交集规则。

## 3. 集成验证与交付

- [x] 3.1 运行 corepack pnpm typecheck 与相关 vitest，记录准确数量和结果。
- [x] 3.2 运行 corepack pnpm build:preview，打预览归档并记录 SHA256；不更新 Desktop。
- [x] 3.3 严格校验本 change，按阶段本地提交，记录提交号和无推送。

## Workflow follow-up

- Windows 安装预览包及真实 OMP 旧凭据 id=1 退出由主会话在确认无活动任务后执行；id=2/其他 CLI 不得改动。已于 2026-11-06 由主会话执行（经用户授权），记录见下方「Windows 实机退出验收」。
- Desktop UI、Windows 真实登录与 Pi 真实退出未验证；因此本 change 不归档，不以格式检查隐藏缺口。

## Validation record

- 1.1 部分完成：Mac 两个 Pi 版本与 OMP 16.4.4 合成账号退出、Windows SDK/帮助/结构只读检查完成。Pi 现场失败未在 Mac 复现，Windows OMP 18.8.7 完整注册表未实际查询，保持未勾选；不把模拟菜单当作真实 Windows 退出。
- 所有 pnpm 命令使用 `pnpm_config_verify_deps_before_run=false corepack pnpm …`，避免当前 worktree 的既有共享 node_modules 链接触发 pnpm 自动重建依赖。未安装依赖或修改版本号。
- `corepack pnpm typecheck`：最终通过（DSH 0.2.2-rc.1）。首次失败为新 worktree 缺失生成的 lib/typert.remote-client.d.ts；从本 worktree 的隔离 preview 构建复制该生成声明后通过，没有构建/更新 Desktop 链接。
- `corepack pnpm test tests/native-login-providers.test.ts tests/account-logout.test.ts tests/pi-account-window.test.ts tests/omp-account-window.test.ts tests/account-guide-flows.test.ts tests/pi-omp-accounts.test.ts tests/pi-omp-native.test.ts tests/account-terminal.test.tsx tests/accounts-window.test.tsx tests/accounts.test.ts tests/account-login.test.ts tests/native-launch.test.ts tests/windows-account-terminal.test.ts tests/i18n.test.ts`：13 文件通过，446 测试通过、1 跳过，14.27 秒。末尾 tests/i18n.test.ts 并不存在（Vitest 过滤忽略），后续使用真实文件补跑，不能将此命令称为已覆盖 i18n。
- `corepack pnpm test tests/client-i18n.test.tsx tests/windows-accounts.test.ts tests/windows-account-owner.test.ts tests/windows-account-stdio.test.ts`：3 文件通过、1 文件跳过；49 测试通过、1 跳过，7.99 秒。Windows owner 真机测试在 Mac 跳过。
- 新增 UI 测试首轮因序列化 React Fiber 循环失败，已移除无意义序列化断言；最终目标选择断言通过。首次 Vitest 因共享依赖目录临时配置权限 EPERM 无法启动，授权重跑后通过。
- `corepack pnpm build:preview`：最终成功；仅生成 `.cache/preview-package`，出现既有 CommonJS/依赖打包建议警告，无构建失败。
- `npm pack --ignore-scripts --cache ../npm-pack-cache --pack-destination ../account-preview-artifacts --json`：预览目录执行成功，不运行 prepack、不安装。首次默认 npm 缓存访问 EPERM，改用 worktree 隔离缓存重跑。归档 970 文件；已检查不含 node_modules、账号目录、auth.json 或 agent.db，且归档 Host/Client/Pi helper/provider helper 与 preview 字节一致。
- 预览包：`.cache/account-preview-artifacts/dsh-cliworker-now-0.8.7-pi-omp-accounts-preview.tgz`，18,944,770 字节。
- SHA256：`50338926150d8f72a4594d7ef3b03c46c2d93ae3ba1acf69e11d94d440b87199`。
- `corepack pnpm spec validate fix-pi-omp-logout-and-login-options --strict --no-interactive`：通过。`git diff --check`：通过。
- 本地阶段提交：`8465f23` 提案/规格；`e24b0e7` 实现/测试；验证文档作为后续独立提交，hash 见最终报告。均附要求的 Co-Authored-By；不推送、不发布。
- 未修改 `pi-native-catalog.mjs` 或认证错误展示逻辑；Windows 用户 agent.db 及真实凭据未改动。其他 CLI 列表差集、提示方案、主会话安装/退出步骤与回滚见 evidence.md。

## Windows 实机退出验收（2026-11-06，用户授权「现在装并测退出」）

- 门禁：DSH 主进程 33364 无 CLI 子进程，活动 Worker 0（多个 codex 进程不是 DSH 子进程，未动）。经应用菜单退出，确认无 DSH 进程。
- 安装：预览包 scp 到 Windows 后 SHA256 `50338926…b87199` 与 Mac 一致。`dsh.cmd plugin --profile desktop add <tgz>` 退出码 0，profile 指向该 tgz，版本 0.8.7。按包内清单逐文件 SHA256 比对 970/970 一致（lib 751/751）。回滚包仍是 Windows 上的 v0.8.7 发布包 `b270308a…646ae`。
- 启动：交互会话 26 带无障碍及防节流参数启动（PID 26200）。Codex gpt-6-astra high Windows Computer Use 观察：主界面正常加载，无崩溃弹窗。
- 退出前快照：`auth_credentials` 中有两条 `zhipu-coding-plan`：id=1（created_at 0，`disabled_cause` null，有 auth 封锁记录）和 id=2（created_at 1793975825）。在远端算出每条记录的内容摘要，只存在 Windows 本地，不输出密钥或摘要。
- UI 操作（Codex CU，原文）：
  - 「CLI Worker 设置 → OMP → 账号」窗口「OMP · 账号」列出「智谱 BigModel Coding（中国）」两行，分别为「API Key · 凭据 #1」「API Key · 凭据 #2」，各带「退出」。
  - 只点 #1 的「退出」，行内确认「退出后会删除这条凭据，其他账号保留。」，再点「确认退出」。
  - 结果「退出 智谱 BigModel Coding（中国） API 登录 · 凭据 #1」「已退出 OMP」「需要时可在设置中重新登录。」。点「完成」后列表只剩「凭据 #2」。
- 回读（只读 agent.db 元数据）：
  - id=1 `disabled_cause` 变为 `deleted by user`，`updated_at` 1793979181，即 OMP 原生的软删除；对应的 auth 封锁记录已清除。
  - id=2 `disabled_cause` 仍为 null，`updated_at` 未变，内容摘要与退出前一致。
  - 退出后无新增凭据，无 DSH 子进程或活动 Worker 残留。
- 模型目录：退出后设置目录缓存于 15:33:11Z 写入，提示「当前账号可用模型」，共 12 个 `zhipu-coding-plan/*` 模型（glm-4.5 … glm-5.3-flashx-legal）。设置页显示模型「GLM-5.3-Flash」、强度「Low」。退出过程中短暂出现「OMP 当前账号暂无可用模型，请登录或刷新」，刷新后恢复。
- 未验证：
  - Pi 真实退出，Windows 上 Pi 原始报错未复现。
  - Windows OMP 18.8.7 完整登录选项列表，以及账号窗口里登录选项的显示。
  - 其他 CLI 的账号，Codex 未打开逐一核对。
  - 真实登录或替换。
- 1.1 仍不勾选（Pi 侧缺口）；本 change 不归档。
