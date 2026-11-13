## ADDED Requirements

### Requirement: CLI 原生工具优先，DSH 工具作为备选
DSH 工具桥 SHALL 以 CLI 原生工具为首选：与该 CLI 当前已启用原生能力重叠的 DSH 工具（本地文件读写编辑、搜索、命令执行，以及与 CLI 原生配置同名的 MCP 服务器）默认 MUST NOT 交给 CLI；CLI 原生缺少或被插件关闭的能力，对应 DSH 工具 SHALL 作为备选提供。重叠判定 MUST 依据按 CLI 维护的能力表，而非工具名称猜测。交出的 DSH 工具描述 SHALL 标明为备选。CLI 有原生开发者指令入口时，插件 SHALL 附简短的原生优先说明，列出实际交出的工具；MUST NOT 改写用户任务内容或覆盖用户自己的指令文件。尚未接通执行的 CLI MUST NOT 收到工具目录。工具执行仍 MUST 经宿主权限与审批链。

#### Scenario: Codex 收到工具目录
- **WHEN** 写任务中 Codex 启动且工具桥已接通
- **THEN** Codex 的 DSH 工具目录不含与其原生能力重叠的读写、搜索与 shell 工具，只含 DSH 独有能力，描述标明备选，并收到原生优先说明

#### Scenario: CLI 原生缺少某能力
- **WHEN** Pi 的原生工具集中没有命令执行工具
- **THEN** DSH 的命令执行工具作为备选交给 Pi，每次执行经宿主权限与审批

#### Scenario: 同一 MCP 两处都配置
- **WHEN** 用户在 CLI 原生配置和 DSH 中配置了同名 MCP 服务器
- **THEN** CLI 只使用原生那一份，DSH 那一份不交出

#### Scenario: skill 来源
- **WHEN** CLI 原生已有 skill 且 DSH 也有获准 skill
- **THEN** CLI 按原生方式使用自己的 skill，DSH skill 仅可经工具桥的读取工具按需获取

#### Scenario: 未接通执行的 CLI
- **WHEN** 某 CLI 的工具桥执行尚未核验
- **THEN** 不向该 CLI 注入工具目录，任务记录说明原因

#### Scenario: 工具返回不支持的内容类型
- **WHEN** 某宿主工具只能返回 CLI 不支持的内容类型
- **THEN** 该工具在目录阶段即被排除，不出现执行成功却报错的结果
