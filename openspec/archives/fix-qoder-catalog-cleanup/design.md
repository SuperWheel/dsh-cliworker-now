# Design

## Context

见 proposal.md。官方 1.1.73 bundle 静态核验：ACP `wYd/Foe` 强制普通可写认证；SDK `qodercli` payload 提供 readOnly/none，`lUi` 可将 auth 根与 `Pr()` 配置根分开。`FHd` 在 catalog-ready initialize 后返回 `KB(config).map(veA)` 的完整模型和强度；`DT` 只在 supportsDisabled 明确为真时追加 none。SDK 的模型目录包含 disabled 项，必须只接纳 isEnabled=true 的可用模型。

原 `.models/default` 是含 key/uid/scene/updatedAt 的 24 小时默认目录缓存，`_doInitCore/reloadSharedCache` 自动刷新；不是用户保存的模型偏好。现有失败探针没有前值，不推测恢复原文件。SIGTERM handler 明确调用 exit 143，因此 Node outcome 可能是 143/null。

## Goals / Non-Goals

**Goals:** 元数据零 prompt、保留来源与路由语义、共享配置不写回，结束回执和范围清理可核验。

用户追加的性能目标：消除同一次设置目录加载的重复原生账号初始化，保留刷新和运行前校验。其他 CLI 的本地绑定查询和既有缓存行为不因 Qoder 优化改变。

**Non-Goals:** 不修改真实 ACP 执行、默认选型、原生设置迁移、用户会话或全局安装。

## Decisions

- 复用现有 stream-json 账号传输：目录发送 initialize（supportsCatalogReadyInitialize=true、skills=[]）和 end_session；账号仍为 initialize、account_info、end_session。不新建 ACP 会话，不逐模型切换。
- 每次查询创建 0700 私有根、0600 payload。浏览器认证用 qodercli + 原根 QODER_SDK_AUTH_CONFIG_DIR；PAT 用官方 accessToken payload 和私有 auth 根，密钥仅进入所选子进程；可安全复制已有 machine_id 供 customs 解密，不复制 user 账号文件。浏览器机器标识缺失时启动前拒绝，避免原生 telemetry 在共享 auth 根初始化它。
- 私有根只复制原 settings.json、.env、最多 256 个账号槽的 .models/<slot>/customs；所有读取 no-follow、有文件大小限制，拒绝链接或异常类型。不复制默认缓存、历史或锁。cwd 保留，项目/local/.env 的原生优先级保留；SDK 子进程显式启用官方 custom-base-url BYOK 入口以保留 providers。
- 按原生 project 优先、user fallback 检测生效 .env，出现 Qoder 认证/运行控制或 Gemini 模型/home 声明即在账号绑定（含 PAT 快速路径）及查询前拒绝，避免 SDK 浏览器身份与实际 ACP 的 .env PAT 身份不一致；普通代理变量保留。
- 原生 G8o/MNu 会迁移旧 project/local 配置并写回。启动前检测其已核验旧字段，发现即拒绝并提示在原生 CLI 迁移；不自行重建合并器或静默忽略项目来源。
- 成功 end_session 回执在解析时记录。只有无取消/协议错误、done 尚未到达且我们实际发起正常 terminate 时，才接受官方 143/null 或 SIGTERM/SIGKILL；其他非零、提前退出、终止/范围观察失败均失败。始终等待读流和进程范围退出后移除本次私有根；范围未确认时保留目录并报告清理错误。
- Qoder 授权目录使用同一个 catalog-ready 原生查询中的当前账号及模型，沿用既有 binding 构造和 expected binding 校验。操作前后在共享源重新读取认证、机器标识、user/project/local 设置、生效 .env、customs 清单与内容、PAT/运行环境和可执行入口身份；任一变化均拒绝结果，不能用旧快照掩盖变化。
- 仅 Qoder 冷目录和显式刷新可跳过设置缓存外层的重复前置 binding，改用上述已自证授权的结果；热缓存命中仍 fresh binding，刷新强制重新查询。原生账号投影不作跨请求 TTL 缓存，不改变 Worker 运行前独立校验。预计冷开 5→2、刷新 4→1 个进程；真实耗时受 CLI 与网络影响，必须实测且与进程数分别记录。
- Desktop 重开复验发现外层通用 10 秒账号查询预算会在 Qoder 已完成元数据、仍等待进程退出时提前取消。仅将 Qoder 外层预算对齐其已有 15 秒原生元数据预算；其他 CLI 保持 10 秒，显式取消、有限等待和完整清理仍保留。两次零 prompt 实机实验表明 ACK 后关闭 stdin、或额外等待 1 秒自然退出均未改善，故不合入这些实验，也不缩短进程清理宽限。

## Risks / Trade-offs

- 官方协议或 settings 迁移规则变更 → 已核验字段严格验证，未知模型格式不发布；继续保持真实任务运行前核验。
- 私有配置包含用户路由密钥 → no-follow 有限复制、0700/0600，仅所选进程可见，范围退出确认后删除；从不回写源文件。
- 用户并发修改配置 → 不回滚或覆盖共享源；现有账号来源绑定负责运行前重检。
- 原生初始化仍有固定耗时 → 优先合并重复工作，保留有限超时和明确错误，不回退静态模型或延长登录状态缓存。
- 操作前后来源指纹证明本地认证与配置未变，不代表初始化之后再次远端认证。原生初始化会检查凭据有效期；若时间流逝或远端撤销使凭据随后失效，真实任务仍由独立运行前原生校验拒绝，目录查询不缓存登录身份。

## Migration Plan

无用户数据迁移或依赖变化。完成定向回归，由统一任务完成类型检查、隔离 preview 和实机零 prompt 复验，再在空闲时更新 Desktop。可回退插件源码；不恢复或改写用户文件。真实模型执行仍待独立授权验收。
