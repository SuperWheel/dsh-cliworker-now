# Tasks

## 1. 状态展示与回归

- [x] 1.1 导航与账号摘要统一展示 configured 的 Host 原因，允许换行；通过设置组件回归验证三种 ZCode 退出结果、其他 CLI 提示与空摘要回退。
  - `settings-dialog.tsx` 的 connectionStatus 使用 Host 摘要，账号行复用 label；`styles.ts` 允许 unverified 文案换行。`tests/settings-dialog.test.tsx` 新增 14 组摘要投影和 3 组模拟退出刷新用例，均通过。React 渲染验证不等于浏览器布局或 Desktop 实机验证。
- [x] 1.2 增加 ZCode 合成文件回归，验证 OAuth 清除后残留绑定、仅 API Key、两者皆无及手工 API 绑定分支，核对原生退出 argv 和来源一致且读取不改写文件。
  - `tests/zcode-grok-accounts.test.ts` 新增 4 组纯临时夹具；核对退出 argv、认证目录一致、前态 authenticated、后态摘要、无秘密投影和文件不变，全部通过。模拟后态不证明原生 CLI 实际删除了哪些字段。Host 无代码变更。
- [x] 1.3 同步 README、设置设计规范与 doc/design.md，核对根因说明区分源码判定与 Windows 实机证据。
  - 已同步 README 第 3 节、设置规范第 4 节和设计文档末节；具体分支与证据边界见本 change 的 design.md。

## 2. 集成检查

- [x] 2.1 运行关联 vitest 文件与 pnpm typecheck，记录实际结果。
  - 2026-10-30，所有 pnpm 命令先执行 `export PATH=/private/tmp/claude-501/-Users-leeyl-AI-Project-DeepSeekHarness-cliworker-now/2f8fa750-5e53-440a-be75-3325ede92abb/scratchpad/bin:$PATH`。
  - `pnpm test tests/zcode-grok-accounts.test.ts tests/settings-dialog.test.tsx tests/account-guide-flows.test.ts tests/zcode-grok-windows-regression.test.ts`：最终 4 文件、332 项通过（exit 0）；新增 21 个参数化用例。首次完整读取的结果有 9 项旧文案断言失败，均为预期泛化「已配置」；按保留具体摘要规则更新后通过。Windows 命名文件使用模拟屏幕，不代表 Windows 实机运行。
  - `pnpm typecheck`：Host/Client against DSH 0.2.1-rc.5 通过（exit 0）。
- [x] 2.2 运行隔离 pnpm build:preview 与 pnpm spec validate fix-configured-account-status --strict，核对差异和版本保持 0.8.4。
  - `pnpm build:preview`：通过（exit 0），产物 `.cache/preview-package`；构建仅有 ESM/CommonJS 与依赖打包建议，未执行正式 build、未更新 Desktop。
  - `pnpm spec validate fix-configured-account-status --strict`：通过；`git diff --check`：通过。package.json 保持 0.8.4，无提交或版本变更。
  - 共享工作区中 `openspec/changes/upgrade-host-rc5/tasks.md` 出现其他会话改动，本任务未修改该文件。

## 3. 平台验证边界

- [ ] 3.1 后续使用新预览包在 Windows Desktop 复测退出后的账号窗口、状态摘要及窄窗口换行，并回读不含秘密的 Host 摘要确认现场分支。
  - 本次禁止真实认证存储读取、真实 CLI 登录/退出与模型调用；此项保持未验证，不更新 Desktop 链接。
  - 2026-10-30 23:14 装入 `preview-20261030-230544` 后复测：用户已重新登录 ZCode，设置页显示「已登录 11****10@qq.com」（Host 摘要，非通用「已配置」）。其余 CLI 的状态文字逐字记录在 `.test-data/windows-desktop-20261030/cu-run-final.json`。
  - 未覆盖：退出后「已配置但未核实」分支和窄窗口换行。这次没有退出 ZCode，也没有回读 Host 摘要，所以保持未勾选。
  - 2026-10-31 09:09 退出复测（预览包 `preview-20261031-085351`，用户「装包补测」批准；证据 `.test-data/windows-desktop-20261031/ui-zcode-{logout-done,after-logout}.jpg`）：
    - 在 CLI Worker 设置 → ZCode → 账号窗口选「退出」。确认提示为「BigModel 和 Z.AI 的登录会一起退出」，确认后显示「已退出 ZCode」。
    - 账号窗口变为「尚未登录 ZCode 的任何账号」。设置页的账号摘要变为「已配置 ZCode API」，左侧导航 ZCode 为灰点（未核实），按钮从「账号」变为「登录账号」。项目默认设置提示「ZCode 当前账号暂无可用模型，请登录或刷新」。
    - 摘要用可访问性树逐字回读，是 Host 给出的原因，不是笼统的「已配置」。按源码，这条文字只来自 API 分支：要么绑定与手工 API 指纹匹配，要么回退读到个人配置里的 API Key。OAuth 残留绑定会显示「ZCode 账号绑定未确认，请重新登录」，两者皆无则是「尚未配置」，现场都不是。API 分支内部是哪一种文字相同；要区分得读认证文件，按规则没有读。
    - 仍未覆盖：窄窗口换行。这条摘要很短，当前窗口下不需要换行，也没有缩窄窗口实测，因此保持未勾选。
    - 退出后 ZCode 没有登录账号，用户需要自行重新登录。

## Workflow follow-up

- Windows 实机证据补齐前保留活动 change，不以格式通过代替业务验收或通过归档隐藏缺口。
