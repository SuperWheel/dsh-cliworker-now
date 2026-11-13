# 用 OpenSpec（pmspec）管理后续开发

本项目从 v0.6.6 渐进接入 OpenSpec，先管理后续变更，保留历史。
2026-11-13 起改用 pmspec：它是 OpenSpec 1.14.1 的分叉，按飞书产品面板的需要定制。源码和设计稿在产品面板仓库的 `tools/pmspec/`（`PMSPEC.md`）。
命令与 OpenSpec 基本相同，主要差别见下面的「pmspec 与 OpenSpec 的差别」。

## 1. 已接入的范围

- 开发依赖固定为 `pmspec@1.14.1-pm.1`。面板下载地址上线前，从 [`vendor/`](../vendor/) 中的 tgz 安装，由锁文件管理，无需全局安装。
- 项目级技能由 `pnpm spec update` 生成，共六个 `pmspec-*`。
- 改用 pmspec 的变更为 `vnext-adopt-pmspec-leeyl`。
- 首个变更 [adopt-openspec-workflow](../openspec/archives/adopt-openspec-workflow/) 已归档，建立 [development-workflow](../openspec/specs/development-workflow/spec.md) 开发流程规格。
- 此次不补写全部业务规格，不改变业务与 Desktop 安装。

统一用 `pnpm spec` 调用锁定版本，并以 `OPENSPEC_TELEMETRY=0` 关闭遥测。
生成技能中的裸 `openspec`／`pmspec` 命令，均改用 `pnpm spec` 执行。

| 命令 | 用途 |
| --- | --- |
| `pnpm spec --version` | 查看项目使用的版本 |
| `pnpm spec:list` | 列出活动变更 |
| `pnpm spec list --specs` | 列出主规格 |
| `pnpm spec:check` | 执行 `validate --all --strict --no-interactive` |
| `pnpm spec tasks <变更> --json` | 按主任务列出子任务进度与校验问题，供同步到面板 |
| `pnpm spec decisions <变更> --json` | 读出 design.md 中的「决定」记录，供写入面板决策日志 |

### pmspec 与 OpenSpec 的差别

- **变更命名**：格式为 `v<主>-<次>-<修订>-<主题>-<创建人>`，版本号中的点改成横线；版本未定时写 `vnext`。例如 `v0-8-10-cli-update-page-leeyl`。
  用 `pnpm spec new change --version 0.8.10 --topic cli-update-page --creator leeyl --creator-name Leeyl --title <中文标题>` 创建。
  中文标题、版本和飞书显示名写进 `.openspec.yaml` 的 `pm` 段；版本确定后用 `pnpm spec change rename <名> --version <x.y.z>` 改名。
- **两级任务**：`## N. 主任务 〔职能｜工时｜前置 N〕` 下列 `- [ ] N.M 子任务`，主任务进度等于子任务完成比例。
  - 证据写成子任务下的缩进普通列表项，不再嵌套复选框。
  - 没做的写「（未执行：原因）」，并保持不勾选。
  - 归档后的观察项放 `## 跟进`，不计入进度。
  - 相似工作并入同一主任务，一个主任务对应面板上的一条任务。
- **归档位置**：归档到 `openspec/archives/<变更名>/`，目录名不带日期，日期写在 `pm.archived`。
  2026-11-13 已把旧的 `openspec/changes/archive/<日期>-<名>/` 全部迁移过来。
- **防虚勾**：pmspec 命名的变更若勾选了子任务、却写着「未执行」，严格校验和归档会报错。
  缺少证据只告警（`config.yaml` 中 `pmspec.requireEvidence: false`）。
  改用 pmspec 之前创建的旧名变更，任务格式问题只作提示。

## 2. 文档分别放什么

| 位置 | 职责 |
| --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | 开发规则、权限、验证与交付边界 |
| [`../openspec/config.yaml`](../openspec/config.yaml) | 项目上下文及各类产物的编写规则 |
| `openspec/specs/<能力>/spec.md` | 已纳入管理的当前行为契约 |
| `openspec/changes/<变更名>/` | 进行中的提案、规格增量、设计及任务清单 |
| [`../openspec/archives/`](../openspec/archives/) | 已完成变更及其决策记录 |
| [`design.md`](design.md) | 既有设计和版本演进历史，继续保留 |
| [`tasks.md`](tasks.md) | 2026-10-28 之前的验证与发布历史，不再追加 |

任务清单与实际验证结果都写在各变更自己的 `tasks.md`（结果作为对应子任务下的缩进普通列表项），不集中写入 `doc/tasks.md`。
旧设计和待办先对照当前源码、测试及后续记录，再提取主规格。
规格表达预期行为，测试与运行证据说明验证程度，二者不能替代。

## 3. 在 Codex 中使用

Codex CLI／IDE 可用 `$pmspec-propose`；Desktop 从 **Skills** 选择技能。
技能未刷新时，可用自然语言要求按 `AGENTS.md` 和 OpenSpec 流程处理。
文件位于 [`.agents/skills`](../.agents/skills/)；技能名不是 CLI 子命令。
如需其他开发助手的专用入口，先用 `pnpm spec init --help` 核对工具 ID，再显式执行
`pnpm spec init --tools <tool-id> --profile core`。插件支持的 CLI 列表不等于必须安装的开发助手列表。

| 技能名 | 适用时机 |
| --- | --- |
| `pmspec-explore` | 先调查问题、比较方向和澄清边界，不直接实施代码 |
| `pmspec-propose` | 生成提案、规格增量、设计与任务 |
| `pmspec-apply-change` | 按已授权范围实施任务并记录实际验证 |
| `pmspec-update-change` | 需求改变时同步修订规划产物，不修改业务代码 |
| `pmspec-sync-specs` | 将增量合入主规格，暂时保留活动变更 |
| `pmspec-archive-change` | 核验完成状态、同步主规格并归档 |

常用表达：

> 用 OpenSpec 研究这个问题，核对实现和规格。

> 生成 OpenSpec 提案，写明范围和验收方式。

> 实施这个变更，完成相应验证后同步规格并归档。

仅要求提案时停在规划阶段；已有实施与归档授权直接沿用，不重复审批。
真实模型调用仍需 CLI／模型选型授权。

## 4. 一个变更的完整流程

以下 `v0-8-10-improve-worker-search-leeyl` 为示例，执行前替换为实际变更名。

```sh
# 确认项目根及现有变更
pnpm spec context --json
pnpm spec list --json

# 创建骨架，并读取产物依赖
pnpm spec new change --version 0.8.10 --topic improve-worker-search --creator leeyl --creator-name Leeyl --title "改进 Worker 搜索"
pnpm spec status --change v0-8-10-improve-worker-search-leeyl --json

# 逐项读取要求，再由开发者或 Agent 编写对应文件
pnpm spec instructions proposal --change v0-8-10-improve-worker-search-leeyl --json
pnpm spec instructions specs --change v0-8-10-improve-worker-search-leeyl --json
pnpm spec instructions design --change v0-8-10-improve-worker-search-leeyl --json
pnpm spec instructions tasks --change v0-8-10-improve-worker-search-leeyl --json

# 产物完成后校验
pnpm spec validate v0-8-10-improve-worker-search-leeyl --strict --no-interactive
pnpm spec status --change v0-8-10-improve-worker-search-leeyl
```

`new change` **只创建骨架，不生成完整提案**；`instructions` 只输出要求。
按 `status` 的依赖和路径编写 `proposal.md`、`specs/`、`design.md`、`tasks.md`。
正文用中文，保留结构标题及 `SHALL`／`MUST` 关键字。
没有规格级行为变化的纯重构或文档维护，可以在该 change 的 `.openspec.yaml` 声明
`skip_specs: true`，按 CLI instructions 跳过规格；`design.md` 按 instructions 的适用条件处理。
不要为了通过校验编造需求。本次接入定义了新的开发流程行为，因此有实际流程规格。

按当前产物实施代码和测试，完成后才勾选；范围变化时同步修订规划产物。

```sh
pnpm spec instructions apply --change v0-8-10-improve-worker-search-leeyl --json
pnpm spec tasks v0-8-10-improve-worker-search-leeyl --json   # 各主任务进度与校验问题

# 实施完成，检查产物、任务数量及归档要求
pnpm spec status --change v0-8-10-improve-worker-search-leeyl --json
pnpm spec list --json
pnpm spec instructions archive --change v0-8-10-improve-worker-search-leeyl --json
pnpm spec validate v0-8-10-improve-worker-search-leeyl --strict --no-interactive

# 在实施、必要验证及规格同步范围均已明确后执行
pnpm spec archive v0-8-10-improve-worker-search-leeyl --yes
pnpm spec:check
pnpm spec:list
```

归档会更新主规格，并把变更目录移到 `openspec/archives/<变更名>/`，完成后核对结果。
已落实的变更若只同步规格，用 `pmspec-sync-specs` 技能；不存在 `pnpm spec sync` 命令。
`status` 的文件存在和任务勾选不证明验收通过；`validate` 检查结构，不证明业务正确。
归档前完成所需验证，`--yes` 不替代任务、证据或冲突处理。

## 5. 现有业务怎样逐步补规格

首次仅建立开发流程规格。七个业务域**只是建议，尚未生成规格**；后续触及时提取现状基线及本次增量。

| 建议能力域 | 提取重点 | 源码与测试入口 |
| --- | --- | --- |
| `worker-dispatch` | 明确指定 CLI、首次选型、角色选择、两层派遣 | [Host](../src/host/index.ts)、[派遣测试](../tests/role-dispatch.test.ts) |
| `worker-lifecycle` | 排队、互斥、停止、进程清理、同会话续聊 | [运行时](../src/host/runtime.ts)、[核心测试](../tests/core.test.ts) |
| `cli-capabilities` | 原生协议、真实模型能力、错误判断、退役兼容 | [共享类型](../src/shared/types.ts)、[适配器](../src/host/adapters.ts)、[运行时测试](../tests/runtime.test.ts) |
| `settings-and-accounts` | 项目偏好、CLI 开关、账号来源和原生终端 | [账号模块](../src/host/accounts.ts)、[设置测试](../tests/cli-settings.test.ts)、[账号测试](../tests/accounts.test.ts) |
| `roles-and-names` | 预设管理、角色快照、命名和同父会话查找 | [角色模块](../src/host/roles.ts)、[角色测试](../tests/roles.test.ts) |
| `history-and-observability` | 私有持久化、恢复、历史分页、真实事件与用量 | [存储](../src/host/storage.ts)、[核心测试](../tests/core.test.ts)、[遥测测试](../tests/telemetry.test.ts) |
| `harness-ui-integration` | Gateway、侧栏、主题、组件及生命周期清理 | [Client](../src/client/index.tsx)、[注册测试](../tests/client-registration.test.ts)、[面板测试](../tests/panel.test.tsx) |

命名与角色预设已实现，见 [角色说明](role-presets.md)。
Kimi 订阅 403、Grok／Hermes 真实任务未验收，参见 [支持范围](../README.md#42-支持范围与验证边界) 和 [实际记录](tasks.md)。本次不新增付费验收任务。

## 6. 验证、交付和升级

日常业务调整按 `AGENTS.md` 只做影响范围对应的最小验收：关联测试、必要类型检查和隔离构建；UI 变更需相应实际渲染核对。发布验收在用户批准的正式 GitHub 提交之前执行，范围见 `openspec/specs/development-workflow/spec.md`。
开发期间不自行增加版本号，正式提交 GitHub 时使用用户确认的版本号。GitHub 提交及发布须用户明确批准。
正式构建前确认无活动任务和账号终端，不覆盖会话、凭据或其他配置。
真实 CLI 验收检查事件、退出状态及产物，不采信完成自述。
纯流程文档做规格和差异检查，不虚报测试。

升级时审阅目标版本说明，并显式固定版本：

```sh
# 从产品面板下载新版 pmspec tgz 放进 vendor/（或面板下载地址上线后直接用该地址），再固定版本
pnpm add -D pmspec@file:vendor/pmspec-<目标版本>.tgz
pnpm spec update
pnpm spec:check
```

`update` 刷新技能集成；它会重新创建空的 `openspec/changes/archive/.gitkeep`，删除即可。需求修订用 `pmspec-update-change`。
升级检查生成文件、配置及锁文件，不改全局配置。
分阶段提交相关文件，保留其他改动，不自动推送。
