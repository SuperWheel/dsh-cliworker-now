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
- [ ] 5.1 批量改写面板上指向旧归档路径的交付物链接（未执行：须先推送本分支，并经用户同意写面板）
- [ ] 5.2 把本变更和 41 个已归档变更同步到面板，缺少真实验收的以「补验收」任务跟进（未执行：须经用户同意写面板）
- [ ] 5.3 面板下载地址上线后，把 `vendor/` tgz 换成线上地址（未执行：妙搭面板尚未发布）

## 跟进
- `pnpm spec update` 会重新创建空的 `openspec/changes/archive/.gitkeep`，在 pmspec 后续版本中改掉
- add-workbuddy-cli 完成剩余 1 项后，按旧命名规则归档
