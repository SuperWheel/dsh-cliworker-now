# 注册接线实际验证（2026-11-07）

范围：仅 add-workbuddy-cli 的注册、接线、图标及文档。现有七个核心实现／声明文件没有改动。不提交、不发布，不执行真实账号、模型或 Desktop 操作。

## 命令与结果

- `corepack pnpm build:preview`：通过，输出 `.cache/preview-package`，未更新已安装插件。
- 首次根目录 `corepack pnpm typecheck`：Host 通过；Client 缺少未生成的 `dsh-cliworker-now/remote` 声明，产生关联类型错误。隔离构建生成声明后，仅复制 `lib/typert.remote-client.d.ts` 到根目录生成区，根目录 `pnpm typecheck` 与 `pnpm --dir .cache/preview-package typecheck` 均通过；未修改类型检查规则。
- 运行资源检查：隔离包 lib／lib/types/host 下 native-workbuddy.mjs、workbuddy-bootstrap.mjs、codebuddy-acp-outcome.mjs、workbuddy-key-helper.cjs 共 8 份副本逐字节匹配源文件，两个 runner 模块均能导入。检查只 import，不启动程序。
- `corepack pnpm spec validate add-workbuddy-cli --strict --no-interactive`：通过。
- `pnpm spec:check`：57 个项目通过，0 失败。系统未装 pnpm 命令，嵌套脚本使用工作树 `.cache/tool-bin/pnpm` 包装器转调 corepack pnpm 11.25.0。
- `/Library/Developer/CommandLineTools/usr/bin/git diff --check`：通过。
- Nowledge Memory 精确检索 `add-workbuddy-cli registration wiring`：无结果；实现依据本工作树的设计、规格和源码。

最终关联测试（沙箱限制本机 socket 监听；已有同范围用例在沙箱内出现 listen EPERM／ready-listen-failed 后，获准在沙箱外原样运行）：

```sh
corepack pnpm test tests/workbuddy-registration.test.ts tests/workbuddy-installation.test.ts tests/workbuddy-bootstrap.test.ts tests/native-workbuddy.test.ts tests/qodercn-integration.test.ts tests/qoder-routing.test.ts tests/routing.test.ts tests/worker-permissions.test.ts tests/cli-settings.test.ts tests/cli-account-binding.test.ts tests/accounts.test.ts tests/authorized-catalog.test.ts tests/settings-catalog-cache.test.ts tests/native-attachments.test.ts tests/cli-native-capabilities.test.ts tests/native-worker-windows-env.test.ts tests/native-runtime.test.ts tests/cli-executable-paths.test.ts tests/settings-dialog.test.tsx tests/client-i18n.test.tsx tests/panel.test.tsx tests/runtime-account-isolation.test.ts tests/worker-goals.test.ts tests/windows-accounts.test.ts tests/settings-display-cache.test.ts tests/running-message-settings.test.ts tests/windows-cli-resolution.test.ts tests/windows-cli-installation.test.ts tests/worker-fork.test.ts
```

结果：29 个测试文件通过，1421 项通过，0 失败。包含 29 项新增注册接线测试、两版设置页及卡片模拟渲染、英文文案、Windows 模拟安装与既有核心 91 项模拟回归。测试名／夹具标注模拟；没有真实私有绑定调用、账号登录或模型执行。

## 仍未验证

- 国际版实际 product 身份、专属图标、Windows 实机及命名管道。
- 真实任务、审批允许／拒绝、恢复、停止与桌面端独立性。
- 隔离构建运行真实元数据探测、Desktop 明暗主题／窄栏目视验收。
- 原生没有稳定账号主体回执，来源绑定不能检测同站点账号切换；每次准入只重新确认登录与目录。

## 改动文件

- `AGENTS.md`
- `README.en.md`
- `README.md`
- `doc/assets/cli-icons/v5-workbuddy/README.md`
- `doc/assets/cli-icons/v5-workbuddy/manifest.json`
- `doc/assets/cli-icons/v5-workbuddy/workbuddy.png`
- `doc/design.md`
- `doc/settings-ui-design.md`
- `doc/usage-details.md`
- `doc/workbuddy-protocol.md`
- `openspec/changes/add-workbuddy-cli/registration-checklist.md`
- `openspec/changes/add-workbuddy-cli/registration-verification.md`
- `openspec/changes/add-workbuddy-cli/tasks.md`
- `scripts/build.mjs`
- `src/client/assets/workbuddy.png`
- `src/client/cli-executable-settings.tsx`
- `src/client/i18n-messages.ts`
- `src/client/icons.tsx`
- `src/client/management-styles.ts`
- `src/client/operation-error.ts`
- `src/client/settings-dialog.tsx`
- `src/client/worker-card.tsx`
- `src/host/accounts.ts`
- `src/host/adapters.ts`
- `src/host/authorized-catalog.ts`
- `src/host/cli-account-binding.ts`
- `src/host/cli-native-capabilities.mjs`
- `src/host/index.ts`
- `src/host/native-attachments.mjs`
- `src/host/native-bridge.mjs`
- `src/host/native-harness-injection.mjs`
- `src/host/native-worker.ts`
- `src/host/process.ts`
- `src/host/routing.ts`
- `src/host/settings-catalog-cache.ts`
- `src/host/workbuddy-metadata.ts`
- `src/shared/account-links.ts`
- `src/shared/conversation-features.ts`
- `src/shared/types.ts`
- `src/shared/workbuddy.ts`
- `src/shared/worker-permissions.ts`
- `tests/cli-account-binding.test.ts`
- `tests/client-i18n.test.tsx`
- `tests/fixtures/legacy-runtime.ts`
- `tests/panel.test.tsx`
- `tests/routing.test.ts`
- `tests/runtime-account-isolation.test.ts`
- `tests/settings-dialog.test.tsx`
- `tests/windows-accounts.test.ts`
- `tests/workbuddy-registration.test.ts`
