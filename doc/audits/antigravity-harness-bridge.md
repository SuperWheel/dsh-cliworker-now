# Antigravity 的 Harness 工具桥

适用开发版本 v0.8.1，2026-10-18。实现与真实验收分开记录；安装版可以配置 MCP 不等于已经调用成功。

## 1. 两个参考项目

| 项目及固定版本 | 实际做法 | 本次采用的经验 |
| --- | --- | --- |
| Codingns4DSH `27b4c95065e9f3ae01d513c60673a871487257f3` | AGY 驱动使用原生 stream-json stdin、附件路径和原生权限模式；该驱动没有调用其子 Agent MCP 注入模块 | 保留 AGY 自身输入、会话和权限语义，不能把其他 ACP 驱动的桥配置直接套到 AGY |
| codex-host `a8adb78b519a81795fc05b787811f20a9738d7f0` | 为原生提问创建本轮私有 `.agents/hooks.json`，用 `--add-dir` 加入运行，结束后清理；Windows Hook 通过环境变量中的已引用路径启动 | 复用附加目录和 Hook 生命周期。其 AGY 运行加入跳过权限参数；本插件保留原生保护，通过专属工具的精确准入继续进入 Harness 审批 |

源码：[Codingns4DSH AGY 驱动](https://github.com/jingyi0605/Codingns4DSH/blob/27b4c95065e9f3ae01d513c60673a871487257f3/src/host/cli-adapters/antigravity-driver.ts)、[Codingns4DSH 注入模块](https://github.com/jingyi0605/Codingns4DSH/blob/27b4c95065e9f3ae01d513c60673a871487257f3/src/host/cli-bridge/injections.ts)、[codex-host AGY 驱动](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/packages/adapters/antigravity/src/antigravity-adapter.ts)、[codex-host 提问 Hook](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/packages/adapters/antigravity/src/question-bridge.ts)。仅参考机制，自主实现工具目录和准入逻辑。

## 2. 当前实现

官方 [MCP 配置](https://antigravity.google/docs/mcp?tab=cli) 与 [Hook 协议](https://antigravity.google/docs/hooks/) 提供工作区 `.agents/mcp_config.json`、`.agents/hooks.json` 和 PreToolUse 接口。插件在本轮私有请求目录下单独建立 `agy-tools`，只把这个稀疏工作区加入 `--add-dir`；不修改用户项目或全局配置，不把包含其他私有请求的父目录加入 AGY 工作区。

MCP 服务器名由当前运行绑定派生，使用已有 `native-harness-mcp` 载体，连接令牌只经进程环境传递。原生 init/resume 身份通过现有校验后，写入私有会话记录。Hook 只对结构化原生会话、步骤和完整工具名与本轮实时目录匹配的调用返回 `auto_approve`，其他原生工具继续使用默认策略。陌生桥工具、目录撤销、身份变化或运行关闭时拒绝准入，不凭提示词、显示标题或命名空间前缀授权。

这里的 `auto_approve` 采用原生 Hook 的语义：保留显式用户规则，只让请求抵达 MCP 载体。实际工具仍经当前 child scope 的 `tools.execute` 和 Harness 权限链，Skill 仍按需加载，取消及关闭由现有桥处理。没有加入跳过全部权限的参数，也没有复制用户 Skill 或 MCP 凭据。

Host 打包入口和独立 Hook 入口分开：即使准备函数被打入 `lib/index.js`，Hook 仍执行单独的 `native-agy-harness.mjs`。临时配置、会话记录和受管 CLI 一同清理。

## 3. 验收边界

Mac / Windows 使用同一 Host 模块；仅 Hook 启动路径引用按原生平台处理。桌面测试仅在 Windows。关联离线回归分别为 macOS 107 项及宿主权限链 4 项、Windows 111 项；打包入口修正后另复验专属 7 项，分组不重复累计。两端类型检查与隔离构建通过。

Windows 真实 Desktop MCP/Skill 验收仍在进行，最终结果以 [实际任务记录](../tasks.md) 本阶段为准。无模型的 `mcp list` 只列出全局配置，不能当作附加工作区已加载的证据；原生终端探针的登录表现也不能代替 Harness 当前会话的实际执行回执。

