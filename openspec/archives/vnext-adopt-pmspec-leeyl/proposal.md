# Proposal

## Why

OpenSpec 与飞书产品面板（pm-collab-board）配合不顺：

- `tasks.md` 一条复选框就是一条任务，同步到面板后条目过多，看不出整体进度。
- 变更目录名不带版本和创建人，面板上无法按版本、负责人归类。
- 归档在 `openspec/changes/archive/<日期>-<名>/`，目录名带日期，面板交付物链接只能靠人拼。
- 截至 2026-11-13，仓库积压 41 个任务已全部勾选、却未归档的变更，主规格长期没有合并它们的增量。

用户在 2026-11-13 决定：分叉 OpenSpec 为 pmspec（源码在产品面板仓库 `tools/pmspec/`），配套技能 `pm-board-spec`，本仓库改用 pmspec。

## What Changes

- 开发依赖由 `@fission-ai/openspec@1.14.1` 换成 `pmspec@1.14.1-pm.1`。面板下载地址上线前，先用 `vendor/` 里的 tgz 安装；`pnpm spec` 改为调用 pmspec。
- `openspec/config.yaml` 改用 `schema: pmspec`，设置 `pmspec.requireEvidence: false`（证据缺失只告警），按两级任务改写 tasks 规则，并把过时的 v0.8.4 更新为 v0.8.9。
- 项目技能 `.agents/skills/openspec-*` 由 `pnpm spec update` 重新生成为 `pmspec-*`。
- 新变更命名为 `v<主>-<次>-<修订>-<主题>-<创建人>`，版本未定时写 `vnext`。中文标题、版本和飞书显示名写进 `.openspec.yaml` 的 `pm` 段。
- 归档目录改为 `openspec/archives/<变更名>/`：
  - 69 个旧归档用 `git mv` 迁移，日期写入 `pm.archived`；
  - 41 个积压变更按首次提交顺序归档，并合并主规格；
  - 仓库内的链接同步改写。
- 同步更新 AGENTS.md、`doc/openspec.md` 及中英文使用说明。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `development-workflow`：工具入口改为 pmspec，变更命名与归档位置改变；任务改为两级，并以子任务证据作为归档依据。

## Impact

- 只影响开发工具、文档和 `openspec/` 目录，不改插件运行时代码。两处代码改动只是注释里的路径。
- `pnpm-lock.yaml` 改为引用本地 tgz；`vendor/` 新增约 0.6MB 的包文件。
- 面板上旧交付物链接若指向 `openspec/changes/archive/...`，需要另行批量改写；写面板前须经用户同意。

## 成功指标（基线、目标）

- 活动变更数：基线 42 个，其中 41 个已全部勾选；目标为只保留未完成的 `add-workbuddy-cli` 和本变更。
- `pnpm spec:check` 严格校验：目标为活动项与已归档项全部通过。
- 主规格：每条需求与其最新增量一致（拆分的超长需求除外）。

## 范围外

- 不改写 41 个旧变更的 `tasks.md` 正文。旧格式的问题只作提示；缺少的真实验收在面板上以「补验收」任务跟进。
- 不推送 GitHub，不发布妙搭面板，不写面板数据。
- 不处理 `add-workbuddy-cli` 剩余的 1 项任务。
