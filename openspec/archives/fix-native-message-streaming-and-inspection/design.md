# Design

## Context

见 proposal.md 的实际故障。现有 bridge 支持 step，但 OpenCode/MiMo 与 Hermes 的文本增量未设置，fold 把每帧视为独立消息。ACP/ZCode 固定 step 不碎片，但工具前后回复不能保留独立位置。TelemetryReader 读取 raw 的白名单仍偏旧协议，runtime 又只挑选部分统计；Client 使用自制过程卡片与简单 context popover。

Harness rc.2 的完整 ReasoningRow/ToolCallTree/ContextMeter 是包内部组件，不能通过未导出路径安全导入。公开 DisclosureRow、MarkdownText、StateDot、JsonTree 和文件/终端块可复用；其原生上下文分类本身是可见请求组成的估算，不等于提供商精确 token。设计保留这些真实边界。

## Goals / Non-Goals

**Goals:** 修复所有已识别原生流身份错误；用同一证据恢复截图历史；恢复各 CLI 能提供的当前占用与容量；对齐原生过程/上下文菜单的结构、格式与行为，已知和未知数据可辨。

**Non-Goals:** 不修改 Harness 核心或全局 CLI，不将父主会话统计投影给 Worker，不提取未公开推理/隐藏 prompt，不猜模型容量或凑分项；不改动排队/独立引导状态机，不将模拟测试写成真实验收，不升出 v0.7.10 或发布。

## Decisions

1. 新 runner 以原生 message/part/block 为身份生成稳定 step，delta 只追加同一段，完成快照与增量核对后补尾；Hermes/ACP/ZCode 只有明确工具/消息边界时开启新的连续段。修复 runner 边界而不在 UI 按标点或时间猜测拼接，保留 interleaved 工具和公开思考。
2. 历史只读投影独立为有界 helper，在 runtime fold 前工作。OpenCode/MiMo 仅在旧 raw 能证明单一消息/文本 part、全部公开增量与终态一致时临时补 step；多 part 但缺逐帧归属时不猜。缓存绑定事件范围与原文件身份，拒绝链接/超限/读取变化，不写回原记录、不重跑任务。
3. 原生模型容量 metadata 仅投影已匹配的 provider/model 的 `limit.context` 等已核实字段；新协议 usage/context frames 进入 TelemetryReader 明确白名单。Host 区分输入/输出/缓存/推理 token 的提供商口径，当前窗口按本 CLI 原生已查实规则计算，使用估算和 source 元数据；runtime 完整转发安全 telemetry，不继续丢字段。通用 total usage 不自动等于 contextUsed。
4. 逐 CLI 审核直接提供的当前窗口、原生目录容量、可见请求组成和可读取会话记录。新增可选分类数据与来源，均绑定所属 Worker/session/model；有真实可见请求内容才按已核实估算规则分类，没有的数据保持 undefined。分类不需要凑成提供商总量，也不把差值全部算对话；不启动额外生成来探测分类。
5. Client 复用导出的原生 primitives，按安装版同一源码/主题实现完整组件未导出的薄适配。公开思考使用 Markdown，工具展示匹配真实类型的安全参数/结果/终端/差异及调用层级，未知工具保留通用结构化展开；删除 raw COMPLETED 卡片和重复状态文字。布局、动画、键盘、停止、历史、窄栏与原生对照渲染核对，不靠 class 字符串验收。
6. context popover 按原生宽度、间距、header、legend 和分段条实现，已知分项按原生比例展示；没有分项时展示单色真实总占用与三行未知，不画伪造彩色比例。说明精炼为 CLI 没有提供的内容，不把协议实现细节塞入产品流程。

## Risks / Trade-offs

- [错误合并隐藏独立消息] → 原生身份或明确边界、跨工具测试、delta/snapshot 冲突校验，旧历史无证据不修。
- [历史 raw 反复读取和越界] → 文件描述符/路径身份、有界读取、原子变更复核和带身份缓存，读取失败不影响真实运行结论。
- [token 口径混用] → 逐 CLI 实机安装源码/官方类型与真实 raw 核对，区分累计与当前，缺值保留；模型容量不得按别名猜。
- [组件未导出导致假复用] → 使用公开导出与原生 primitive 的受限适配，原生源码作为格式/行为依据；不新增深层私有 import 或修改宿主。
- [分项不能完整取得] → 不隐藏限制，能力矩阵逐项说明总量/容量/分项是否有证据；界面保留原生查看体验与未知值。
- [真实账号与 Windows 不能全覆验] → 沿已有选型做影响范围内最小真实调用，保存失败/阻塞；不重跑整套发布验收。

## Migration Plan

先记录 11 CLI 审计和重放基线，写定向回归，再实施 runner/Host/Client。保留旧 schema 和旧 transport，不改用户会话、偏好、原 raw/events。通过关联回归、类型检查和隔离 preview 后，用隔离浏览器核对原生样式与数据；确认正式 Desktop 无活动任务后更新并重开截图 Worker，验证历史归并/上下文/过程。真实 OpenCode 等使用已保存选型进行必要小调用，未验证范围写入 doc/tasks.md；规格、实现、证据核对后严格验证并归档。
