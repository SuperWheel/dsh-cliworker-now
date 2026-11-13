# Design

## Context

见 proposal.md。原实现已有官方来源覆盖与私有路由文件，但账号查询、binding 和模型读取没有统一固定当前配置，ambient 拒绝使入口提前失败。当前官方文档确认 `--settings`、Fable 映射字段和 `[1m]` 后缀；网关 discovery 默认关闭。

## Goals / Non-Goals

**Goals:** 让查询、账号绑定和执行使用同一当前 Claude 自身来源；官方操作可独立启动；保持两平台原生账号存储。

**Non-Goals:** 新增 CC Switch 管理界面、读其数据库、自动更换 provider、改 Harness 核心或对其他 CLI 开放配置回退。

## Decisions

1. 以 user/project/local Claude settings 合并结果为来源，不认 ambient 为账号证据。所有 Claude 元数据和任务通过同一原生覆盖启动：清除继承的认证/provider/model 变量，固定当前凭据、端点及明确模型映射。直接接受继承环境会混用宿主凭据；仅允许相等环境不能解决桌面长期进程的旧变量。
2. 官方 login/logout 单独验证账号目录、settings 目录重定向及 managed 覆盖，直接使用官方 overlay 与 `auth login --claudeai`，不探测代理、不要求路由令牌有效。managed 优先于 session overlay，因此不放宽其认证覆盖。
3. route/model 映射纳入 binding。查询状态也使用私有 `--settings` 文件；凭据不进入 argv、Gateway、日志或 Git，进程范围退出后才清理。
4. 配置模型仅在网关 metadata 404/405 时开放，`cost=unknown`，notice 明确未核验。成功目录仍求交，401/403/网络错误不回退。保持原生 `[1m]` argv，在目录比对时仅移除这个后缀。该 Claude 专属例外显式同步原有目录规格。
5. 同一代码路径用于 macOS 和 Windows，无 shell 拼接、symlink 账号或新依赖。日常只跑 Claude 相关回归、类型检查、preview 和最小原生参数验证；Windows 原生验证可用时执行，无连接时如实记录。版本设为用户指定的 0.7.8 开发状态；公开 0.7.7 安装链接保留以免指向未发布包。

## Risks / Trade-offs

- 网关配置不是远端权益证明 → 明示配置证据；真实执行保持原生错误，不通过批量模型调用猜测。
- 切换时长期桌面环境过期 → 只对选定 Claude 子进程清除/固定，不修改宿主全局环境或磁盘原生配置。
- 强制 managed 来源不能覆盖 → 保留拒绝及简短错误，不声称其可隔离。
- Windows 机器连接不可用 → 合成跨平台代码检查与原生 Windows 结果分开记录，不虚报实机通过。

## Migration Plan

无需账号或历史迁移。先 preview 构建验证，再确认无活动任务与账号终端后构建当前安装链接；不上传 GitHub。回退本次源码与生成包即可，原生 settings 未写入。

参考：[Claude CLI](https://code.claude.com/docs/en/cli-reference)、[模型配置](https://code.claude.com/docs/en/model-config)、[网关协议](https://code.claude.com/docs/en/llm-gateway-protocol)、[配置优先级](https://code.claude.com/docs/en/settings)、[CC Switch 映射](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/proxy/model_mapper.rs)。
