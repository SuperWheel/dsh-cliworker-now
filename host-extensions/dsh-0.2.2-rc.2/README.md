# DSH 0.2.2-rc.2 原生会话扩展

官方 tag `dsh-v0.2.2-rc.2` 固定于 `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`。从 rc.1 checkout 新建独立 detached worktree `.cache/dsh-host-source-022rc2`，未改动 rc.1 工作树；不把 Desktop 构建标记当作 tag commit。

## 补丁迁移

在 rc.2 HEAD 上三方应用 rc.1 的 48 文件 `source.patch`，以下 10 个文件冲突，逐处人工决定合并；保留官方新行为，再追加插件扩展：

- `ui-chat/src/client/chat/ChatView.tsx`：同时保留官方 `markdownLabels` 和插件外部回答投影导入。
- `ui-chat/src/client/chat/TurnUsagePanel.tsx`：保留外部用量、未知用量、积分和来源展示；定位改为 rc.2 `useStatDialog().anchorName`，触发器设置 `anchorName`，面板设置 `positionAnchor`。
- `ui-chat/src/client/chat/stat-dialog.module.css`：保留官方 CSS anchor 定位及视口宽度约束，移除旧锚定测量 CSS 变量，插件内边距保留 12px。
- `ui-chat/src/client/index.ts`：同时导出官方 `RunningProcessActivity` 与插件 `ExternalTurnAnswer` / `ExternalTurnAnswerProjection`。
- `ui-chat/tests/chat-view.client.spec.tsx`：保留官方 `consumeOlder` / `prepareOlder` 与插件 `setProjection` 测试辅助入口，双方用例并存。
- `ui-conversation/src/client/contract/slots.ts`：保留官方 composer `occurrence`，追加插件 `composerPresentation`、`commandSource`、`childImageUploads`。
- `ui-conversation/src/client/skeleton/ContextMeter.tsx`：外部比例、未知用量两种扩展分支均采用官方 `useId` + CSS anchor；包括未知用量触发器和 portal 面板，均不再调用已移除的定位 hook。
- `ui-conversation/src/client/skeleton/ConversationContent.tsx`：传递官方 `occurrence` 和全部插件新增 props。
- `ui-conversation/src/client/skeleton/InputBar.tsx`：保留官方文件接收注册、`occurrence`、Retry 条件、权限检查及等待 Host 时独立 Stop；插件 main presentation 使用主按钮 Stop，命令源与子会话图片选择继续可用。rc.2 已移除父会话离线时禁止子会话输入的规则，本补丁不恢复 `parentOffline` 限制。
- `ui-conversation/tests/input-bar.client.spec.tsx`：官方 occurrence/file-intake 与插件新增 props、用例并存；插件旧的父会话离线禁用断言同步改为 rc.2 直接向子会话输入的预期（未运行 Vitest）。

自动合并的 `StatsPills.tsx` 已沿用 rc.2 的 `anchorName`。本次没有新增语言或插件词条；rc.1 的中英文及日、西、法、德、俄、葡六种语言英文占位词条完整保留（conversation 12 条、chat 38 条，源码仍注明待翻译）。

## 隔离依赖与重建

`build-dependencies` 由 rc.1 三文件迁移，DSH 固定为 `0.2.2-rc.2`，workspace 发布期限例外追加 `|| 0.2.2-rc.2`。显式新增 `@deepseek-ai/dsh-session-projection`、`@deepseek-ai/dsh-agent-team`，固定 `zod` 为 `4.6.6`；cordis 仍为 `~4.1.0`。完整锁文件比较显示，非 DSH 包仅 zod `4.4.3 → 4.6.6` 与 `@deepseek-ai/libreoffice-kit` 及五个平台包 `0.1.5 → 0.2.3`，其余非 DSH 包版本集合不变。安装首次追加的 40 条精确 DSH 发布期限例外已收录进冻结 workspace 文件；三文件与实际安装目录逐字节一致。

独立依赖目录 `.cache/dsh-host-build-deps-022rc2`，独立 store `.cache/dsh-host-pnpm-store-022rc2`。首次从 rc.1 锁文件生成新版锁使用 `install --ignore-scripts`，随后将锁复制回本目录并用 `--ignore-scripts --frozen-lockfile` 复核。所有命令从插件根执行，使用项目 pnpm（本机为 `corepack pnpm`）：

```sh
/Library/Developer/CommandLineTools/usr/bin/git -C .cache/dsh-host-source-022rc1 worktree add --detach ../dsh-host-source-022rc2 dsh-v0.2.2-rc.2
/Library/Developer/CommandLineTools/usr/bin/git -C .cache/dsh-host-source-022rc2 apply --3way ../../host-extensions/dsh-0.2.2-rc.1/source.patch
# 按上述决定解决冲突后导出
node scripts/build-host-extension.mjs --target 0.2.2-rc.2 --export-patch
# 将 build-dependencies 三文件复制到独立依赖目录后安装
corepack pnpm --dir .cache/dsh-host-build-deps-022rc2 install --ignore-scripts --frozen-lockfile --store-dir "$PWD/.cache/dsh-host-pnpm-store-022rc2"
node host-extensions/dsh-0.2.2-rc.2/generate-dependency-links.mjs
node scripts/build-host-extension.mjs --target 0.2.2-rc.2 --prepare-links
node host-extensions/dsh-0.2.2-rc.2/check-client-types.mjs
node scripts/build-host-extension.mjs --target 0.2.2-rc.2
node scripts/build-host-extension.mjs --target 0.2.2-rc.2 --verify
node scripts/vendor-host-extensions.mjs --from artifacts/dsh-host-extension-022rc2-data
node scripts/vendor-host-extensions.mjs
```

rc.2 的 tsx、TypeScript 与工具版本记录直接使用独立依赖目录，避免插件根依赖并行安装期间缺失链接。构建继续由 checkout 链接的 tsdown 调用，避免跨 rolldown 实例的 `RolldownMagicString` 兼容问题。四包 Host 与声明继承同版官方 npm 基线，浏览器从补丁源码构建，扩展类型另经源码类型检查验证。新版 npm 包新增的 `src` 和 map 不进入 runtime；vendor 保留既有白名单、`ui-chat/lib/assets/*` 和 `./assets/*` 导出。vendor 默认 rc.2，旧 rc.1 仍可显式传 `--target 0.2.2-rc.1 --from ...`；构建脚本旧目标保持可用。

不安装、启动或退出 Desktop，不触及用户配置，不运行上游四包 Vitest。实际检查结果见本目录后续验证记录；本轮不证明真实 Desktop、账号、模型或 Windows 行为。

## 本次已执行的检查

- `install --ignore-scripts` 首次生成锁成功，`install --ignore-scripts --frozen-lockfile` 成功，未执行依赖安装脚本。
- `--export-patch` 导出 48 文件补丁，SHA256 `f4e0b86507dc0d6282427aef46ed7a008779e8b491c9546f029eed4e040832b4`。
- `generate-dependency-links` 生成 864 行：相较 rc.1 移除 7 个上游不存在的别名（api-account-controller、deepseek-account-platform、experimental-agent-team、experimental-agent-team-profile、experimental-client-ui-agent-team、experimental-tool-agent-team、office-to-pdf），新增 agent-team；session-projection 已存在于原清单，现同时作为显式安装依赖。清单来自磁盘 package.json 的版本与 SHA256。
- `--prepare-links` 成功；`check-client-types` 的 session、conversation、subagent、chat 均退出 0。日志在 `.cache/dsh-host-typecheck-022rc2/`。
- rc.1 工作树的 `git diff HEAD --binary --full-index` 与操作前逐字节相同；rc.2 源码无冲突标记，四包源码无已删除定位 hook 引用。

过程中的失败均已处理：首次（及复试）导出报 `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx' imported from .../scripts/build-host-extension.mjs`，原因为插件根依赖正在并行更新，现已按上述独立工具路径解决；首次生成别名报 `Error: Missing plugin-root dependency: @fission-ai/openspec`，待根依赖文件恢复后重跑成功；首次 prepare-links 报 `Isolated build dependency input is missing or differs: pnpm-workspace.yaml; copy all three build-dependencies files before installing`，核对确认是 pnpm 追加上述 40 条精确版本例外，收录后重跑冻结安装与 prepare-links 成功。

- 最终构建及 `--verify` 成功，构建清单 630 文件；vendor 冻结 4 包、217 文件，随后无参数复核成功（清单数均不含 manifest 自身）。
- `runtime-host` 四包版本均为 `0.2.2-rc.2`，202 个继承的 Host/声明文件与官方 npm 基线逐字节一致；无 `src` 目录、无 `.map`，无 `./src/*` 导出。
- `ui-chat/lib/assets/running-whale@2x-06738fa29b2f.png` 保留，21,631 字节，与官方 npm 包逐字节相同，SHA256 `0fd990d118113d19af7af4480f2b55d610b103451a08be6f7bf5a146823f8bd3`；`./assets/*` 导出与官方一致。
- `rg -n 'useAnchoredPosition|AnchoredPositionOptions' runtime-host/` 无匹配；审计脚本还对 runtime 全部 JS、声明、补丁及文档逐项检查，无已删除导出引用。
- `build-host-extension --target 0.2.2-rc.1 --verify` 仍通过旧目标 230 文件清单；未重建或覆盖旧目标。
- 构建日志、依赖差异、冲突清单和可重跑审计在 `artifacts/dsh-host-rebuild-022rc2/`；最终构建在 `artifacts/dsh-host-extension-022rc2-data/`。

未执行：上游四包 Vitest、Desktop 安装/启动/退出及界面验收、真实 CLI/账号/模型调用、Windows 验证、根项目测试与整体 preview/build。未修改根 package.json、根 pnpm 配置/锁文件、src、tests 或 OpenSpec；这些路径由并行任务负责。本轮没有 git commit/push。
