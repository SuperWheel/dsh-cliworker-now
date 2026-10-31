# development-workflow Specification

## Purpose
规定 CLI Worker Now 仓库中需求、增量规格、实施任务和实际验证的管理方式，让开发者使用可复现的项目工具逐步维护当前规格，同时保留已有架构演进、验收边界及用户授权。

## Requirements

### Requirement: 可复现的项目 OpenSpec 入口
项目 SHALL 将 OpenSpec 固定为开发依赖并提交锁文件，通过 `pnpm spec` 执行锁定版本；该入口 SHALL 关闭本次命令的 OpenSpec 遥测，不依赖全局安装，也不修改插件运行时依赖或全局工具配置。

#### Scenario: 开发者安装并检查规格
- **WHEN** 开发者按仓库声明的 Node/pnpm 版本安装冻结锁文件后，运行 `pnpm spec --version` 和 `pnpm spec:check`
- **THEN** 命令使用项目锁定版本并对仓库规格及活跃变更执行非交互严格校验

### Requirement: 变更与既有设计证据分工
项目 SHALL 使用 `openspec/changes/<name>/` 保存有行为影响的需求、增量规格、设计和实施任务，使用 `openspec/specs/` 保存已落实的规格；既有 `doc/design.md` 和 `doc/tasks.md` SHALL 保留为架构演进与真实验收记录。未覆盖业务域 SHALL 在实际变更触及时逐步提取。

#### Scenario: 创建后续业务变更
- **WHEN** 开发者准备新增能力、修改行为/协议/权限或进行跨模块重构
- **THEN** 先阅读相关源码、测试与当前有效文档，创建或续用一个明确范围的 change，再依据用户授权实施

#### Scenario: 发现旧版本未勾选事项
- **WHEN** 历史日志有未勾选任务，但后续版本存在实现或完成记录
- **THEN** 核查后续证据再判断当前状态，保留历史原文，不直接复制为新待办或无证据勾选

#### Scenario: 无行为变化的小修正
- **WHEN** 开发者仅修正拼写或排版，且不改变行为、协议、权限及安装方式
- **THEN** 可以直接完成并记录相应检查，不强制创建完整 change

### Requirement: 中文项目约束进入工作流
项目 SHALL 在 `openspec/config.yaml` 保存中文上下文和产物规则，保留 OpenSpec 解析需要的结构及关键字，并通过项目级 Codex 技能提供探索、提案、实施、修订、同步和归档入口。官方生成技能 SHALL 与项目定制分开维护，不覆盖用户已有技能。

#### Scenario: 获取产物说明
- **WHEN** 开发者运行 `pnpm spec instructions proposal --change <name> --json`
- **THEN** 返回中文项目上下文、proposal 规则与官方模板，包含本仓库的模块、权限、原生 CLI 能力和验证边界

### Requirement: 基于实际证据归档
开发流程 SHALL 在所需任务真实完成、规格与实现核对、严格校验通过并将实际结果写入 `doc/tasks.md` 后归档 change。结构校验或任务文件存在 SHALL NOT 被视为功能测试、真实 CLI 或 Desktop 验收通过。

#### Scenario: 开发工具接入完成
- **WHEN** 仅修改开发工具和文档，约定的工具、依赖和隔离验证均已通过
- **THEN** 记录执行命令与结果，归档合并该 change 的规格，并说明未执行真实模型调用或 Desktop 更新

#### Scenario: 必需验收仍受阻
- **WHEN** change 要求的真实调用因缺少模型选型授权或订阅被阻塞
- **THEN** 保留未完成任务和阻塞证据，不虚勾完成或以格式校验代替该验收；按已有授权继续独立工作

### Requirement: 日常最小验收与版本冻结
日常修复和调整 SHALL 仅执行与影响范围对应的最小验收；发布验收 SHALL 在用户批准的正式 GitHub 提交之前执行。开发期间 MUST NOT 自行增加版本号，正式提交时使用用户确认的版本号。GitHub 提交及发布仍需明确授权。最小验收 SHALL 明确已执行检查和未验证边界。

#### Scenario: 当前版本内修复
- **WHEN** 用户要求修复 bug 但未批准正式提交 GitHub
- **THEN** 保持当前版本号，执行关联检查、隔离构建及必要最小平台验证，不执行发布验收、不推送或发布

#### Scenario: 版本发布
- **WHEN** 用户明确批准正式提交 GitHub 或发布，并确认版本号
- **THEN** 提交前执行上述发布验收并核对安装及分发证据，未验证项继续保留

### Requirement: 发布验收范围
发布验收 SHALL 包含：macOS 类型检查、全量 vitest、`spec:check` 与相对远端主分支的 `git diff --check`；Windows 远程隔离 preview、冻结依赖安装、类型检查、Windows CI 定向测试文件与 Host 加载；正式构建、公开清单、打包内容扫描与官方 dsh 隔离 profile 安装；macOS 与 Windows Desktop 用原生安装器安装发布候选包后的只读界面核对；发布后 npm 固定版本元数据与 Release 安装包哈希回读。真实 CLI 验收 SHALL 只覆盖自该平台上次真实验收以来派遣、登录或退出代码有变化的 CLI，并在发布候选包上执行；其余 CLI 引用已有验收记录。Windows 隔离环境全量 vitest SHALL NOT 作为发布门槛；Windows 平台代码的测试 SHALL 并入 Windows CI 定向文件。

#### Scenario: 真实 CLI 验收范围
- **WHEN** 准备发布且某 CLI 自该平台上次真实验收以来派遣、登录或退出代码没有变化
- **THEN** 不重跑该 CLI 的真实调用，在发布记录中引用上次验收；有变化的 CLI 在发布候选包上实测并核对事件、退出状态与实际产物
