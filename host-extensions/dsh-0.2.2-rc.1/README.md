# DSH 0.2.2-rc.1 原生会话扩展

官方 tag `dsh-v0.2.2-rc.1` 固定于 `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`。本次未解析官方 app 的构建标记，不把任何应用标记写成 tag commit。

rc.5 的 48 文件扩展在 0.2.2-rc.1 上 `git apply --3way`，8 个文件有冲突并逐处人工合并，保留官方新行为：

- `ui-conversation/src/client/index.ts`：同时导出官方文字交互类型与插件的外部状态类型。
- `ui-conversation/src/client/skeleton/InputBar.tsx`：保留官方「消息待 Host 接收时 Stop 独立显示」与 `stopAction`（取消被拒时禁用）；插件的 `composerPresentation === 'main'` 按主会话处理同一规则。文件选择沿用官方 `canAcceptDrop`，可续聊子会话仅在 `childImageUploads` 时开放。
- `ui-chat/src/client/chat/ChatFlow.tsx`、`RunningStatus.tsx`：保留官方断线暂停计时与 `holding`（会话已停但 Turn 未闭合时隐藏占位），外部请求状态在 `holding` 时不显示。
- `ui-chat/src/client/chat/StatsPills.tsx`：改用官方 `reading()`/`text`（取代 `ariaLabel`）表达插件的未知用量与积分药丸。
- `ChatView.module.css`、`stat-dialog.module.css`：保留官方文字交互样式与锚定宽度上限，插件的外部请求样式与 12px 内边距追加在后。
- `ui-chat/tests/chat-view.client.spec.tsx`：官方与插件新增用例并存。

0.2.2-rc.1 新增日、西、法、德、俄、葡六种语言；插件新增的 12 条 conversation 与 38 条 chat 词条在这六种语言中暂用英文（源码内以注释标明），中英文不变。

## 隔离重建

所有命令从插件根执行；使用项目 pnpm（本机经 `corepack pnpm`），禁用依赖安装脚本。固定 checkout 位于 `.cache/dsh-host-source-022rc1`（HEAD = tag），应用 source.patch。将 build-dependencies 三文件复制到 `.cache/dsh-host-build-deps-022rc1`，执行 `pnpm --dir .cache/dsh-host-build-deps-022rc1 install --ignore-scripts --frozen-lockfile --store-dir <repo>/.cache/dsh-host-pnpm-store-022rc1`。

build-dependencies 由 rc.5 三文件改 DSH pin 为 0.2.2-rc.1，并新增 `@deepseek-ai/dsh-util-file-drag`（`ui-primitives` 的新依赖）。与 rc.5 相比，cordis 系列升到 4.1.0（cosmokit 1.9.0、schemastery 3.19.0），第三方只新增 acorn、acorn-walk、hosted-git-info、rrule、shell-quote、mime，其余版本不变。

`dependency-links.json` 由 `generate-dependency-links.mjs` 按 rc.5 清单逐行映射到 0.2.2-rc.1 安装位置，从磁盘重新读取版本与 package.json 摘要，并追加四包新依赖（ui-context-menu、ui-file-drag、message-quotes、tool-executor-ptc、util-file-drag）。

0.2.2 的官方 tsdown 预设会把 `RolldownMagicString` 交给构建器，因此该目标改用 checkout 链接的 tsdown 调用 `build`，使预设与构建器共用同一个 rolldown 实例。

插件侧还有两处随本目标调整，不在本目录内：

- `scripts/host-extension-guard.mjs`：0.2.2 的 `settings.configure` 与查找都按 `owner.ctx.fiber` 归一，设置代理落到官方包已配置的 vendor fiber，此时沿用官方配置，不重复注册；代理同时提供 `config` 与 `effectiveConfig`。
- `scripts/build.mjs`：typert 分析器要求 `declare module` 扩充块内引用的名称有顶层导入，而 tsc 声明输出会省掉它；构建只对暂存的 SDK 声明副本补 `import type`，不改已安装的 SDK。生成的 `typert.*.d.ts` 与 rc.5 构建逐字节相同。

```sh
node host-extensions/dsh-0.2.2-rc.1/generate-dependency-links.mjs
node scripts/build-host-extension.mjs --target 0.2.2-rc.1 --prepare-links
node host-extensions/dsh-0.2.2-rc.1/check-client-types.mjs
node scripts/build-host-extension.mjs --target 0.2.2-rc.1
node scripts/build-host-extension.mjs --target 0.2.2-rc.1 --verify
node scripts/vendor-host-extensions.mjs --from artifacts/dsh-host-extension-022rc1-data
```

四包官方 Host/声明继承同版 npm 基线，新增扩展类型由源码检查验证；浏览器重新构建。上述命令不安装或启动官方 app。实际验证与未验证边界见 `openspec/archives/upgrade-host-022rc1/tasks.md`。
