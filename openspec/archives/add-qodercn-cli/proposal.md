# Proposal

## Why

用户的 Windows 同时安装 Qoder 国际版与中国版；现有 `qoder` 接入仅允许国际版，不能把中国版视为别名而混用账号、目录和会话。需要为中国版提供独立选型和执行身份，在实际原生协议证据范围内复用 ACP。

## What Changes

- 泛称 Qoder 根据实际安装分流：只装一版选该版，两版均安装在宿主原生询问框中选择；明确版本不回退。
- 新增 `qodercn` CLI，独立标签、项目偏好、可执行路径、账号绑定、目录缓存、清理保护及 `qodercn-acp-v1` 会话协议。
- 按官方 `@qodercn-ai/qoderclicn` 与 Windows 1.1.74 实机核对中国版入口、`.qoder-cn`、`QODERCN_` 变量及共享 SDK 控制变量；严格拒绝跨版入口和凭据回退。
- 复用已经核验相同的 ACP、元数据生命周期和只读统计算法，保留中国版来源身份；模型和强度仍动态读取，不复制国际版档位。
- 提取所有 CLI 共用的 Windows PATH/常见入口发现层，品牌身份与特殊原生入口使用声明规则，保留显式优先和失败边界。
- 同步文档，执行针对性回归、类型检查、隔离构建及 Windows 实机元数据/协议验证。无登录或未获模型选型时如实保留真实生成边界。

## Capabilities

### New Capabilities

- `qodercn-cli`: 中国版独立身份、原生账号、模型、会话和跨版隔离。

### Modified Capabilities

- `platform-runtime`: 增加全部受支持 CLI 共用的有界 Windows 目录/PATH 发现契约，保留既有品牌身份、显式优先和特殊桌面发现要求。

## Impact

共享 CLI 注册/路由，Host 入口发现、账号和模型授权、原生桥及遥测，Client 图标与统计，安装说明及设计/验收记录。依据 `src/host/qoder-accounts.ts`、`windows-cli-installation.ts`、`native-qoder.mjs` 和官方中国版文档/1.1.74 发行包。无新运行依赖、不改 Harness 核心、不升版本、不推送发布、不迁移旧会话；真实模型调用仍需已授权选型。
