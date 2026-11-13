# Tasks

## 1. 切换到 pmspec 〔后端｜2h〕
- [x] 1.1 开发依赖由 `@fission-ai/openspec@1.14.1` 换成 `vendor/pmspec-1.14.1-pm.1.tgz`，`pnpm spec` 改为调用 pmspec
  - 证据：`corepack pnpm install --prefer-offline` 成功，`pnpm spec --version` 输出 `1.14.1-pm.1`
- [x] 1.2 `openspec/config.yaml` 改用 `schema: pmspec` 并设置 `pmspec.requireEvidence: false`；tasks 规则改为两级任务，过时的 v0.8.4 改为 v0.8.9
  - 证据：提交 8583efd
- [x] 1.3 用 `pnpm spec update --force` 把项目技能重新生成为 `pmspec-*`，删除旧的 `openspec-*`
  - 证据：`.agents/skills/` 下共 6 个 `pmspec-*`；`pmspec-propose` 中使用 `--version/--topic/--creator`，`pmspec-archive-change` 的目标为 `openspec/archives/<name>/`

## 2. 迁移归档并清理积压 〔后端｜4h｜前置 1〕
- [x] 2.1 预演：在副本中迁移并按序归档，核对冲突
  - 证据：`pmspec migrate archives --dry-run --json` 列出 69 项，冲突 0
  - 证据：副本中 41 个变更全部归档成功；只有 release-v078-latest-install 的 ADDED 与主规格重名（主规格措辞更新），改用 `--skip-specs`
- [x] 2.2 用 `git mv` 迁移 69 个旧归档到 `openspec/archives/<名>/`，日期写入 `pm.archived`
  - 证据：`openspec/archives/` 共 69 项；空的 `openspec/changes/archive/`（`pnpm spec update` 生成的 `.gitkeep`）已删除
- [x] 2.3 按首次提交顺序归档 41 个已全部勾选的变更，合并增量规格（add-traecn-cli 先于 add-traecn-ask-level）
  - 证据：41 个全部归档，活动变更只剩 add-workbuddy-cli（30/31）
  - 证据：逐条比对 173 条需求，172 条与最新增量一致；剩下 1 条是有意拆分的 TRAE 权限需求
- [x] 2.4 为 7 个新建能力域补写 Purpose，把超过 500 字的 TRAE 权限需求拆成两条，含义不变
  - 证据：client-localization、codebuddy-cli、general-settings、host-lifecycle-durability、isolated-workspace、traecn-cli、worker-parent-lineage 均已补写
- [x] 2.5 改写仓库内指向旧路径的链接和路径文字
  - 证据：27 个文件、80 处改写；其中两个 `.ts` 文件只改了注释
  - 证据：改写前后失效的相对链接都是 14 处（均为原有问题），没有新增
  - 证据：提交 bffe4e0

## 3. 文档与规格 〔产品｜2h｜前置 2〕
- [x] 3.1 更新 AGENTS.md 的 OpenSpec 工作流：命名、两级任务、归档位置，技能改为 `pmspec-*`
  - 证据：AGENTS.md 第 36–38 行
- [x] 3.2 改写 `doc/openspec.md`，新增「pmspec 与 OpenSpec 的差别」，并改写命令示例与升级方法；同步中英文使用说明中的技能名
  - 证据：`doc/openspec.md`、`doc/usage-details.md` 第 520 行、`doc/usage-details.en.md` 第 495 行
- [x] 3.3 编写 development-workflow 增量规格：修改 4 条需求，新增「旧命名的变更」与「勾选却写着未执行」两个场景
  - 证据：`specs/development-workflow/spec.md`

## 4. 校验 〔测试｜1h｜前置 3〕
- [x] 4.1 严格校验活动项与已归档项
  - 证据：`pmspec validate --all --strict --no-interactive`，31 项全部通过
  - 证据：`pmspec validate --archived --strict --no-interactive`，110 项全部通过
- [x] 4.2 类型检查（只改了注释，确认无影响）
  - 证据：新工作区缺少构建产物 `lib/`，临时链接主目录的 `lib/` 后，`pnpm typecheck` 通过（DSH 0.2.2-rc.2）
  - 未做真实模型调用，也未更新 Desktop：本变更只涉及开发工具与文档，不需要

## 5. 面板对接 〔产品｜2h｜前置 4〕
- [x] 5.1 改写面板上指向旧路径的来源与交付物链接
  - 证据：面板 828 条任务的交付物链接原本全为空，旧路径写在任务描述的「来源：openspec/changes/<名>/tasks.md」行
  - 证据：2026-11-13 推送 main（`debf4f1..781ffc3`）后，GitHub 上 `openspec/archives/<名>/tasks.md` 抽查 3 个返回 200
  - 证据：`PATCH tasks/batch` 预演 200 + 44 条通过后写入，244 条成功、0 失败；复取快照核对 244 条来源行已改为 archives、交付物链接已填，其他字段无变化，任务总数 828 不变
  - 证据：涉及 9 个变更；add-workbuddy-cli（31 条，未归档）与 add-doubao-cli（11 条，仓库中没有该变更）不在范围内
- [x] 5.2 新建需求并把本变更同步到面板；41 个已归档变更按决定 5 处理，不整批重新同步
  - 证据：已新建需求「改用 pmspec 管理开发变更」（来源技术优化、类型技术，不设目标版本）
  - 证据：对 6 个已同步变更做了 `tasks/sync?dryRun=1` 预演，发现的问题记入决定 5 与 5.4
  - 证据：面板新版发布后（妙搭 release 7707540038565579795，提交 3509050），`tasks/sync` 预演新建 5 条主任务、未执行原因不再重复，随后正式写入
  - 证据：写入请求网关返回 504，但复取快照：需求 REQ-0132 下 5 条任务已建（1～4 已完成，5 进行中 75%），需求的「OpenSpec 变更」已记 `vnext-adopt-pmspec-leeyl`，任务总数 828 → 833；换新幂等键预演为新建 0、不变 5，没有重复
- [x] 5.3 决定保留 `vendor/` 本地包、不改用线上下载地址，并把 pmspec 升到 1.14.1-pm.2
  - 证据：用户 2026-11-13 同意推荐：本地包让安装与 Windows CI 不依赖面板在线（面板 11-10 出现过 503），锁文件不变
  - 证据：`vendor/pmspec-1.14.1-pm.2.tgz`（sha256 前缀 `ba3be41ae0c62a50`，与面板仓库 `downloads/` 清单一致）；`corepack pnpm install --prefer-offline` 后 `pnpm spec --version` 为 `1.14.1-pm.2`
  - 证据：`pnpm spec update --force` 重新生成 6 个 `pmspec-*` 技能；`pmspec validate --all --strict` 32 项全部通过
  - 证据：`doc/openspec.md` 改为固定 pm.2，升级说明写明下载后核对 sha256 再放进 vendor
- [x] 5.4 修复预演中发现的面板同步缺陷
  - 证据：面板仓库提交 `3509050`：tasks/sync 新增 `archived`，来源行指向 archives；「未执行：」前缀去重；已完成任务保留原完成日期；`sync-tasks.mjs` 完成日期改用 `git log --follow --diff-filter=AM`；pmspec 接受 `1b.` 这类主任务编号
  - 证据：面板类型检查、lint、`npm test` 1400 项、服务端构建通过；pmspec `vitest run` 218 个文件 6393 项通过
  - 证据：已推送妙搭 `sprint/default` 与 GitHub `main`；2026-11-13 经用户批准发布（release 7707540038565579795，状态 finished），预热 69 个静态文件；线上技能包哈希与清单、响应头一致；发布后无新错误日志
  - 未验证：pmspec 源码修复尚未打进下载包，下载包仍为 1.14.1-pm.1

## 跟进
- `pnpm spec update` 会重新创建空的 `openspec/changes/archive/.gitkeep`，在 pmspec 后续版本中改掉
- add-workbuddy-cli 完成剩余 1 项后，按旧命名规则归档
