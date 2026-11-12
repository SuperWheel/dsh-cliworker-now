# Design

## Context

见 proposal.md。rc.1 → rc.2 全仓库 4645 个文件变化（+160844/−58399）。四包：ui-session 2 个文件、ui-conversation 47 个（+1467/−268）、ui-subagent 15 个（+1520/−430）、ui-chat 49 个（+1724/−294）；ui-primitives 58 个（删除 `useAnchoredPosition`/`AnchoredPositionOptions`，新增 `usePointerGrace`、`FenceCodeBlock`/`FenceMathBlock` 等）。四包新增依赖：ui-conversation → `dsh-session-projection`，ui-subagent → `dsh-agent-team`；zod 4.4.3 → 4.6.6。四包 `files` 新增 `src` 与 source map。cordis 系列不变。

## Goals / Non-Goals

**Goals:** 四包与官方 0.2.2-rc.2 行为一致并保留既有扩展，不再引用已移除导出；Host 端在 rc.2 上通过类型检查与回归；Mac Desktop rc.2 上可加载使用，Worker 列表正常。

**Non-Goals:** 不改业务派遣协议、用户数据、版本号；不调用模型；不做多宿主隔离矩阵。

## Decisions

- 沿用 rc.1 流程：固定 checkout `.cache/dsh-host-source-022rc2`（由 rc.1 checkout 建 worktree，HEAD = tag），独立依赖 `.cache/dsh-host-build-deps-022rc2`，产物 `artifacts/dsh-host-extension-022rc2-data`，再 vendor。补丁由真实 checkout 导出。
- 冲突合并原则与 rc.1 相同：官方新行为优先，插件扩展叠加其上；具体决定记入 `host-extensions/dsh-0.2.2-rc.2/README.md`。
- 分工：四包重建交 Codex gpt-6-astra high；SDK pin、锁文件与类型检查报告交 Codex gpt-6.1-sol high；两者文件不重叠。Host 适配按类型检查结果另行安排，主会话审查并复跑验证。

## Risks / Trade-offs

- 上游四包 Vitest 无法在自动模式下运行 → 记为未验证。
- rc.2 四包替换 rc.1 宿主未验证 → 兼容声明只写 0.2.2-rc.2。
