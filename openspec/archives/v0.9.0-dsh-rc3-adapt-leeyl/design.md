# Design

## Context

rc.2 → rc.3 只有 6 个上游提交（`68f83cc992` CI bubblewrap 缓存、`ac904e118e` Windows 安装器重启状态 cwd、`b8c33a1504` 实验性「导入 DeepSeek 官网对话导出」、`4c1cf20cb1` 发版）。全仓 515 个文件变化，其中大部分是新实验包 `deepseek-chat-import`、CI 与快照。

随包四包（ui-session、ui-conversation、ui-subagent、ui-chat）只有 `package.json` 版本号变化；ui-primitives 仅新增 `upload-outline` 图标。

## Goals / Non-Goals

**Goals:** 开发 SDK 与随包四包对齐官方 0.2.2-rc.3；插件在 rc.3 上通过类型检查、全量回归与隔离预览构建；在 rc.3 宿主上加载无白屏、无控制台报错。

**Non-Goals:** 不改业务派遣协议、用户数据与插件版本号；不调用真实模型或 CLI；不改 Harness 核心。

## Decisions

- 沿用 rc.2 流程：从 rc.2 源码仓库新建 detached worktree（放在本 worktree 的 `.cache/dsh-host-source-022rc3`），3-way 应用 rc.2 补丁，独立依赖 `.cache/dsh-host-build-deps-022rc3`，产物经构建、校验后 vendor。
- 因 rc.3 四包源码与 rc.2 相同，补丁预期无冲突；如有冲突仍按「官方新行为优先，插件扩展叠加」处理并记入 `host-extensions/dsh-0.2.2-rc.3/README.md`。
- rc.3 新增的扩展点（`workspace.picker` 工厂、`sidebar.session.action` HOC）均为可选新增，插件不使用，不做接入。
- 分工：四包重建交 Codex gpt-6-astra high；SDK pin、差异核对、回归与文档由主会话完成。

## Risks / Trade-offs

- 上游四包 Vitest 不在本次运行范围 → 记为未验证。
- rc.3 四包替换 rc.2 宿主未验证 → 兼容声明只写 0.2.2-rc.3。
- 正式 Desktop 加载依赖主仓库构建（profile 软链指向主仓库），由主会话决定合并与正式构建时机；本变更内只做隔离 DSH_HOME 验证。
