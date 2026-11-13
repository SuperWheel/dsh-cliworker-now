## MODIFIED Requirements

### Requirement: 可复现的项目 OpenSpec 入口
项目 SHALL 将 pmspec（OpenSpec 的产品面板分叉）固定为开发依赖并提交锁文件，通过 `pnpm spec` 执行锁定版本；面板下载地址上线前 MAY 以仓库 `vendor/` 中的 tgz 安装。该入口 SHALL 关闭本次命令的遥测，不依赖全局安装，也不修改插件运行时依赖或全局工具配置。

#### Scenario: 开发者安装并检查规格
- **WHEN** 开发者按仓库声明的 Node/pnpm 版本安装冻结锁文件后，运行 `pnpm spec --version` 和 `pnpm spec:check`
- **THEN** 命令使用项目锁定的 pmspec 版本，并对仓库规格、活跃变更执行非交互严格校验

### Requirement: 变更与既有设计证据分工
项目 SHALL 使用 `openspec/changes/<name>/` 保存有行为影响的需求、增量规格、设计和实施任务，使用 `openspec/specs/` 保存已落实的规格，完成的变更 SHALL 归档到 `openspec/archives/<name>/`。新变更 SHALL 命名为 `v<主>-<次>-<修订>-<主题>-<创建人>`（版本未定写 `vnext`），并在 `.openspec.yaml` 的 `pm` 段记录中文标题、版本和创建人飞书显示名。既有 `doc/design.md` 和 `doc/tasks.md` SHALL 保留为架构演进与历史验收记录。未覆盖业务域 SHALL 在实际变更触及时逐步提取。

#### Scenario: 创建后续业务变更
- **WHEN** 开发者准备新增能力、修改行为/协议/权限或进行跨模块重构
- **THEN** 先阅读相关源码、测试与当前有效文档，用 `pnpm spec new change --version <x.y.z|next> --topic <主题> --creator <代号>` 创建或续用一个明确范围的 change，再依据用户授权实施

#### Scenario: 发现旧版本未勾选事项
- **WHEN** 历史日志有未勾选任务，但后续版本存在实现或完成记录
- **THEN** 核查后续证据再判断当前状态，保留历史原文，不直接复制为新待办或无证据勾选

#### Scenario: 无行为变化的小修正
- **WHEN** 开发者仅修正拼写或排版，且不改变行为、协议、权限及安装方式
- **THEN** 可以直接完成并记录相应检查，不强制创建完整 change

#### Scenario: 旧命名的变更
- **WHEN** 改用 pmspec 之前创建的变更名称不符合 pmspec 命名
- **THEN** 继续按原名称实施和归档，任务格式问题只作提示，不要求改名或重写历史任务

### Requirement: 中文项目约束进入工作流
项目 SHALL 在 `openspec/config.yaml` 保存中文上下文和产物规则，保留 OpenSpec 解析需要的结构及关键字，并通过 `pnpm spec update` 生成的项目级 `pmspec-*` Codex 技能，提供探索、提案、实施、修订、同步和归档入口。生成的技能 SHALL 与项目定制分开维护，不覆盖用户已有技能。

#### Scenario: 获取产物说明
- **WHEN** 开发者运行 `pnpm spec instructions proposal --change <name> --json`
- **THEN** 返回中文项目上下文、proposal 规则与 pmspec 模板，包含本仓库的模块、权限、原生 CLI 能力和验证边界

### Requirement: 基于实际证据归档
开发流程 SHALL 在所需任务真实完成、规格与实现核对、严格校验通过后归档 change，并将实际结果作为子任务下的缩进证据项写入该 change 的 `tasks.md`。任务 SHALL 分为「主任务 + 子任务」两级，主任务进度按子任务完成比例计算。勾选的子任务 MUST NOT 带「未执行」标记。结构校验或任务文件存在 SHALL NOT 被视为功能测试、真实 CLI 或 Desktop 验收通过。

#### Scenario: 开发工具接入完成
- **WHEN** 仅修改开发工具和文档，约定的工具、依赖和隔离验证均已通过
- **THEN** 记录执行命令与结果，归档合并该 change 的规格，并说明未执行真实模型调用或 Desktop 更新

#### Scenario: 必需验收仍受阻
- **WHEN** change 要求的真实调用因缺少模型选型授权或订阅被阻塞
- **THEN** 保留未完成任务和阻塞证据，不虚勾完成或以格式校验代替该验收；按已有授权继续独立工作

#### Scenario: 勾选却写着未执行
- **WHEN** pmspec 命名的变更中，已勾选的子任务带有「（未执行：…）」
- **THEN** 严格校验与归档报错，直到该子任务取消勾选或补齐实际执行
