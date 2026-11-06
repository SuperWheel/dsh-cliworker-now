# Design

## Context

延续 add-cli-login-templates、fix-windows-account-login-bridge 及 cli-account-isolation。账号凭据只能由原生 API/命令修改；成功以目标来源回读确认。Mac 当前主入口 Pi 1.0.4、另有已安装 SDK 1.1.0，OMP 16.4.4；Windows Pi 1.1.0、OMP 18.8.7。

## Goals / Non-Goals

**Goals:** 完整原生登录选项、按 ID 的精确退出、失败可见、可复核隔离证据。

**Non-Goals:** 不更改模型可用性判断、用户真实账号、Desktop 部署或其他 CLI 执行协议。

## Decisions

- 由私有元数据子进程查询 Pi 原生 provider auth 能力和 OMP `get_login_providers` RPC；使用空的隔离账号、禁止工具/扩展、无 prompt。输出仅 ID/名称/原生能力，Host 校验有界结构。复用现有元数据进程清理；只缓存同一安装身份的成功结果，失败不伪装成固定表。
- Pi 指定 provider 退出直接构造 ModelRuntime，调用其原生 logout 并 listCredentials 回读；不创建 InteractiveMode。保留无 provider 的原生菜单入口。
- OMP 继续原生 `/logout <provider>`，适配带边框的行，仍按 stored API key/oauth 后的稳定 ID 定位，不按行号或邮箱。无法识别时交还原生终端。
- 新凭据保存后退出旧凭据的现有替换顺序保留，验证旧凭据退出结果。所有成功还需 Host 原生来源回读，模型错误展示保持不动。
- 不改变窄弹窗、分步布局和主题参数；国内智谱文案不再显示为误导性的 zai.cn。

## Risks / Trade-offs

- 原生安装变化 → 按可执行文件身份失效缓存，启动时校验能力；原生菜单保底。
- 元数据启动耗时 → 同安装缓存；不在每次退出确认轮询重复发现。
- Windows 18.x 布局可能继续变化 → 有界严格行识别，截断或含糊时不自动回车；Windows 真实退出由主会话验证。
- Pi Windows 失败未在 Mac 复现 → 继续只读核对接口，报告中不把防御性简化当作已证实根因。

## Migration Plan

无账号数据迁移。仅构建预览包，保留当前发布包及校验值作为回滚；部署与真实旧 key 退出由主会话确认无活动任务后执行。
