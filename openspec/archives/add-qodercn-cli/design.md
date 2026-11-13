# Design

## Context

见 proposal.md。Windows 实装 1.1.74，中国版独立原生入口为 `.qoder-cn/bin/qoderclicn/qoderclicn.exe`；官方 npm 包为 `@qodercn-ai/qoderclicn`，qodercn 分发器与 qoderclicn CLI 分离。CN 发行包固定品牌，原生 ACP 身份为 qoder-cli-cn，工具扩展仍使用 `_meta.qoder`。认证和模型控制协议仍使用 qodercli 类型；SDK 控制变量保留 QODER 前缀，而品牌变量使用 QODERCN。默认项目配置仍是 `.qoder`，用户根为 `.qoder-cn`，CONFIG_DIR_NAME 会覆盖两者。

## Goals / Non-Goals

**Goals:** 显式传递版本身份，复用已核对的协议算法，同时完整隔离账号、配置、会话与统计。保留其他进行中改动。

**Non-Goals:** 复制/迁移凭据，固定模型清单，绕过权限，新增 SDK 依赖，修改 Harness 核心，改变版本或发布。

## Decisions

1. 在现有 Qoder 模块显式增加版本参数，默认保持 qoder 兼容；不复制整套实现，也不依赖全局可变品牌状态。目录操作快照包含 CLI 身份，源绑定包含对应根与 provider。
2. Windows 根据各版固定原生路径和精确 npm 包身份识别入口。原生 PE 文件名和 symlink 目标必须匹配当前版本，禁止把对侧程序当本版；显式脚本也在 ACP 初始化检查品牌。
3. 新增 qodercn-acp-v1。ACP 共用通信、模型/权限回执、工具、停止和恢复；原生 agentInfo.name 在创建会话前严格核对，未确认规划模式仍拒绝。
4. 环境按品牌选择根和 PAT，清除对侧命名空间，保留已核验共享 SDK 控制变量。元数据复制只来自选中根，原生 auth readOnly 与 memoryOnly 沿用现有生命周期，不向现有项目写会话。
5. 遥测类型与来源增加中国版身份；同一算法读取所选品牌根和日志名，不能把对侧事件或历史当本轮数据。Client 复用已有布局和官方同品牌图形，文字明确 Qoder CN。

6. 用户追加要求：泛称 Qoder 在安装探测后分流，仅一版时直接选择，双版使用宿主原生询问框；显式品牌不回退。公共 Windows 发现层复用进程与最新用户/机器 PATH、共享常见 bin 入口，专属目录和身份校验保留声明。所有桌面实机操作仅在 Windows，本地 Mac 只做代码及隔离构建。

## Risks / Trade-offs

- [发行包后续改变协议] → 动态检查原生身份和配置回执，未知失败关闭。
- [环境或项目共用配置产生不一致] → 源绑定覆盖实际加载的项目 `.qoder`，拒绝未绑定 dotenv/路由，品牌用户根分别读取。
- [无登录不能完成真实模型验收] → 独立记录入口和未登录实机证据，不假勾模型任务。
- [已有未提交工作] → 保存本次编辑前基线，只改必要片段，不回退其他差异。

## Migration Plan

无需数据迁移，旧 qoder 协议和记录不变；preview 回归通过后才考虑安装。回退本次注册和变体改动即可，新增中国版历史保留原 ID，不能改为国际版继续执行。
