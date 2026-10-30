## 1. 差异核对

- [x] 1.1 确认 Mac 与 Windows Desktop 均为 0.2.1-rc.5；npm 上 rc.4/rc.5 已发布（rc.5 于 2026-10-29T14:15Z）；官方 tag `dsh-v0.2.1-rc.5` = `b830ec950faba0a46dda564be3e2d854afed94f1`。
- [x] 1.2 rc.3 → rc.5：388 个文件变化，四包中只有 `ui-chat`（推理显示文本、Body Slot `rawText`）与 `ui-conversation`（视图标签提示、更多视图文案）有源码变化，其余为版本号；Host 端引用的 SDK 包只有版本号变化。

## 2. 重建四包

- [x] 2.1 固定 checkout `.cache/dsh-host-source-021rc5`（HEAD = tag = `b830ec95…`，另取 rc.3 tag 供三方合并），`git apply --3way` 应用 rc.3 的 48 文件补丁：全部无冲突。`--export-patch` 导出 rc.5 补丁（SHA256 `83aa7068…f297`，48 文件），与 rc.3 补丁的增删行完全相同，只有上下文与索引行不同。补丁不涉及 rc.5 改动的 `ReasoningRow`、`ui-chat/contract/slots.ts`、`ConversationSession`，官方新行为原样保留。
- [x] 2.2 构建依赖：rc.3 冻结三文件只改 DSH pin（5 个）与 workspace 例外（追加 `|| 0.2.1-rc.5`），以 rc.3 锁文件为起点 `pnpm install --ignore-scripts`（独立 store `.cache/dsh-host-pnpm-store-021rc5`），package.json/workspace 未被改写；新锁 953 个包，第三方无增删、无版本变化，DSH 全部 rc.5。`generate-dependency-links.mjs` 生成 865 行清单（304 个 DSH 包为 rc.5，其余版本不变，无 rc.3 路径残留）；`--prepare-links` 通过；`check-client-types.mjs` 四包类型检查 session/conversation/subagent/chat 均为 0。
  - 未执行：上游四包 Vitest（在 rc.5 checkout 中运行被自动模式以「外部仓库代码」拦下，没有绕过）。
- [x] 2.3 `build-host-extension --target 0.2.1-rc.5` 构建并 `--verify`（222 个文件）；产物 `ui-chat` 含 `<signature>` 处理、`rawText` 与插件的 `externalTurnUsage` 扩展。`vendor-host-extensions --from …021rc5-data` 冻结 `runtime-host/`（4 包、205 个文件，均为 0.2.1-rc.5），无参数复核通过。

## 3. 插件

- [x] 3.1 开发 SDK 39 个 pin 与根 workspace 300 条发布期限例外改为 rc.5，`pnpm install --ignore-scripts` 重生根锁：855 个包，第三方无增删、无版本变化。`build-dependencies.mjs`、`build-host-extension.mjs`、`vendor-host-extensions.mjs` 加入 rc.5；选图测试增加 rc.5，未验证版本拒绝改用 rc.6；runtime-host 来源断言改为 rc.5 commit 与版本。
- [x] 3.2 `pnpm typecheck` 对 DSH 0.2.1-rc.5 通过；关联 `build-dependencies`、`host-runtime-package`、`market-install-peers`、`panel-layering`、`harness-conversation-official`、`harness-conversation`(tsx)、`panel`、`panel-native-composer` 共 8 文件 177 项通过（首次 1 项为预期的旧 rc.3 commit 断言，已改）；全量 `vitest run --maxWorkers=2` 248 个文件通过、4 个跳过，5283 项通过、14 项跳过、0 失败；`pnpm build:preview` 成功，预览包四包均为 0.2.1-rc.5，`ui-chat` 含 `<signature>` 处理，任务选项菜单层级为 100。
- [x] 3.3 文档：README（中英）宿主说明、`doc/native-conversation-host-extension.md`、`host-extensions/dsh-0.2.1-rc.5/README.md`、`doc/design.md` 已更新。

## 4. 安装与界面

- [ ] 4.1 Windows rc.5 安装新预览包（用户已同意兼容处理后安装），核对文件并启动。
- [ ] 4.2 界面：子 Agent 对话可打开、任务选项菜单在代码块之上；推理显示正常。
- [ ] 4.3 Mac Desktop 链接更新（需确认无活动任务）。
