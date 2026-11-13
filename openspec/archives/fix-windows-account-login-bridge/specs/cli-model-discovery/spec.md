## ADDED Requirements

### Requirement: MiMo 本地模型缓存过期时用原生命令刷新
插件读取 MiMo 模型时 SHALL 继续禁止 MiMo 自行联网更新模型列表。当前账号模型目录可读、但其中没有任何 MiMo 本地模型列表里的候选时，插件 SHALL 调用一次 MiMo 自带的 `models --refresh`（同一可执行文件 10 分钟内最多一次，使用与其他元数据命令相同的隔离环境），清空插件的 MiMo 元数据缓存后重新读取；模型与思考强度 MUST 仍只取刷新后 MiMo 原生列表与账号目录的交集。账号目录不可读、被拒绝或已有交集时 MUST NOT 刷新。刷新失败或刷新后仍无交集时 SHALL 提示本地模型列表与账号不一致，MUST NOT 按账号目录或模型名猜测强度。

#### Scenario: 本机缓存早于账号可用模型
- **WHEN** MiMo 本地列表只有 `mimo-v2.5` 系列，账号目录只返回 `mimo-v2.6` 系列
- **THEN** 插件运行一次 `mimo models --refresh` 后重新读取，列出 v2.6 模型及 MiMo 原生给出的强度档位

#### Scenario: 账号目录不可读
- **WHEN** 账号模型目录返回 401 或无法连接
- **THEN** 插件不刷新 MiMo 缓存，按原有规则报告暂无可确认模型

#### Scenario: 刷新失败
- **WHEN** `models --refresh` 失败，或刷新后仍无交集
- **THEN** 提示「MiMo 本地模型列表与当前账号可用模型不一致」，10 分钟内不再重复刷新
