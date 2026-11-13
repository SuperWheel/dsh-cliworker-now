# Design

## Context

见 proposal.md。rc.5 → 0.2.2-rc.1 全仓库 8120 个文件变化。四包中 ui-conversation（+5246 行：引用插入、文字交互、发送后才清空草稿等）与 ui-chat（+5124 行：文字选择与交互、运行状态位置与 `holding`、断线暂停计时、统计药丸 `reading()`/`text`、`lib/assets` 图片）变化最大，ui-session/ui-subagent 主要是六种新语言。四包新增 DSH 依赖 ui-context-menu、ui-file-drag、message-quotes、tool-executor-ptc、client-connection，以及 ui-primitives 依赖的 util-file-drag。

## Goals / Non-Goals

**Goals:** 四包与官方 0.2.2-rc.1 行为一致并保留既有扩展；Host 端在 0.2.2-rc.1 上通过类型检查与回归；Mac Desktop 0.2.2-rc.1 上可加载使用。

**Non-Goals:** 不改业务派遣协议、用户数据、版本号；不调用模型；不做多宿主隔离矩阵；不翻译六种新语言。

## Decisions

- 沿用 rc.5 流程：固定 checkout `.cache/dsh-host-source-022rc1`，独立依赖 `.cache/dsh-host-build-deps-022rc1`，产物 `artifacts/dsh-host-extension-022rc1-data`，再 vendor。补丁由真实 checkout 导出。
- 冲突合并原则：官方新行为优先，插件扩展叠加其上（详见 `host-extensions/dsh-0.2.2-rc.1/README.md`）。`composerPresentation === 'main'` 的子会话按主会话规则处理 Stop；外部请求状态在 `holding` 时不显示。
- 构建依赖以 rc.5 冻结三文件为起点，只改 DSH pin 并增加 util-file-drag；第三方只新增、不升版。
- 依赖链接清单按 rc.5 清单映射并追加新依赖，从磁盘重读版本与摘要。
- ui-chat 的鲸鱼图片经 `require.asset` 由宿主资源路由按 `./assets/*` 读取，vendor 时保留文件与导出，内容与官方逐字节一致。
- 官方 0.2.2 预设会把 `RolldownMagicString` 返回给构建器；插件根与独立依赖各有一份 rolldown，跨实例对象会报 `Missing field code`。0.2.2 目标改由 checkout 链接的 tsdown 调用 `build`。
- Host 工具桥的具体实现与理由见 tasks.md 记录。

## Risks / Trade-offs

- 合并点（InputBar Stop/发送、RunningStatus、StatsPills）与官方新交互耦合 → 类型检查、关联回归与 Desktop 界面核对。
- 上游四包 Vitest 无法在自动模式下运行 → 记为未验证。
- 0.2.2-rc.1 的四包替换 rc.5 宿主未验证 → 兼容声明只写 0.2.2-rc.1。
