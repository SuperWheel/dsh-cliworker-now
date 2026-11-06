# Tasks

## 1. 实施

- [x] 1.1 `accountSupportedChoices` 剔除被拒绝认证的凭据并累计统计；桥接 account-scope 输出带统计的对象，Host 兼容旧数组。
- [x] 1.2 Pi/OMP、OpenCode 目录为空且有认证失败时报认证失败；有剔除时附带 notice，`catalogFor` 传出。
- [x] 1.3 设置页显示认证失败 notice；补 `operation-error.ts` 模式与英文；同步 README、README.en.md、doc/design.md。

## 2. 增量验证（用户要求只做增量测试，不跑全量）

- [x] 2.1 新增测试：新旧两条凭据一条 401 时显示其余凭据的模型与提示；全部 401 时报认证失败；一条 unknown 时仍为空；OpenCode 认证失败提示；account-scope 新旧格式解析；i18n 映射。
- [x] 2.2 运行 typecheck 与关联测试文件，记录准确数量。
- [ ] 2.3 严格校验本 change，本地提交，不推送。

## Validation record

- 2026-11-07，worktree `claude/fix-pi-omp-accounts-087`。按用户要求只做增量测试，未跑全量 vitest，也未做 Windows 实机复测。
- 所有 pnpm 命令都带 `pnpm_config_verify_deps_before_run=false corepack pnpm …`，原因同 `fix-pi-omp-logout-and-login-options`（worktree 共享 node_modules 链接）。
- `pnpm typecheck`：通过（DSH 0.2.2-rc.1）。
- `pnpm test tests/pi-account-availability.test.ts tests/pi-omp-windows-directories.test.ts tests/opencode-adapter.test.ts tests/client-i18n.test.tsx tests/pi-omp-adapter.test.ts tests/harness-opencode-accounts.test.ts tests/opencode-oauth-source.test.ts`：7 个文件、207 项通过。新增测试：
  - OMP 一条 401、一条正常：显示正常凭据的模型，report 计 1。
  - 全部 401：空目录，计 2。
  - 一条 401、一条 500、一条正常：仍为空，保守规则不变。
  - account-scope 新格式解析：notice 文本；全部拒绝时 Pi/OMP 的认证失败提示；计数非法时报错；预备派遣只带模型。
  - OpenCode 401/403 的认证失败提示，404/500 不附提示。
  - 中英文映射。
- `pnpm test tests/settings-dialog.test.tsx tests/extended-catalog-cleanup.test.ts tests/cli-settings.test.ts`：首次 1 项失败。失败的是 `names each OMP account of one provider by its email when replacing one`：上一变更 e24b0e7 把账号行改为「账号登录 · 凭据 #n · 邮箱」、替换项改为「替换凭据 #n」，这条旧断言没有同步，与本变更无关。已按新文案更新断言，并新增「设置页显示已跳过认证失败凭据的 notice」测试。重跑 3 个文件 384 项通过；新增测试单独运行通过。
- `pnpm build:preview`：通过。`.cache/preview-package/lib` 中 `pi-native-catalog.mjs`、`pi-omp-bridge.mjs`、`index.js` 含新逻辑，`client.js` 含新文案。
- 未执行：全量 vitest；Windows/Mac Desktop 实机复测（Windows 上那条 401 旧凭据已在前一变更中退出，现场已无法直接复现）。
