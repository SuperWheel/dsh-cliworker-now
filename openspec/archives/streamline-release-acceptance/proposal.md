# Proposal

## Why

v0.8.2–v0.8.4 的发布验收里，Windows 隔离 HOME/TEMP 全量 vitest 每轮失败集合不同、正常环境串行重跑全部通过、根因未定位，每次都要逐个排查；每次发布还按惯例把全部 CLI 的真实派遣与登录退出重跑一遍，而其中大部分在发布前的日常修复里已经逐项实测。规格中「当前开发版本 MUST 保持 v0.8.1」也已过时。需要把发布验收收敛到能发现发布包问题的检查上。

## What Changes

- 明确发布验收的固定项：macOS 类型检查、全量 vitest、规格严格校验与差异检查；Windows 远程隔离 preview、冻结依赖、类型检查、Windows CI 定向文件与 Host 加载；正式构建、公开清单、打包扫描与隔离 profile 安装；两平台 Desktop 用原生安装器安装后只读核对；发布后回读 npm 元数据与 Release 安装包哈希。
- 移除 Windows 隔离环境全量 vitest；Windows 平台代码的测试改为并入 Windows CI 定向文件（本次由 7 个扩到 17 个）。
- 真实 CLI 验收只覆盖自该平台上次真实验收以来派遣、登录或退出代码有变化的 CLI，在发布候选包上执行；其余引用已有记录，不重跑全部 CLI。
- 版本号改为由用户在发布时确认，不再在规格中写死。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `development-workflow`: 发布验收范围与版本确认方式。

## Impact

`openspec/specs/development-workflow`、`scripts/windows-remote-common.mjs`、`scripts/windows-remote.mjs`、`.github/workflows/windows.yml`、`doc/windows-remote-testing.md`、`doc/release-template.md`、`doc/openspec.md`、`AGENTS.md`。插件运行时行为、协议与安装方式不变。
