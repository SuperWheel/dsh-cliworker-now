# Design

## Context

见 proposal.md。当前 helper 用同一普通文件校验读取 CLI 与 app.asar 标记；Electron 会虚拟化 ASAR，普通 Node 单测不能覆盖这一差异。账号与模型查询共用该 helper，因此识别失败会同时阻断两处状态。

## Goals / Non-Goals

**Goals:** 在 Electron 与普通 Node 中采用一致的磁盘安装判断，保持路径优先级、验证严格性及用户配置。

**Non-Goals:** 不调整模型、认证、CLI 版本或发现目录，不重装 OpenCode，不改宿主或全局 ASAR 配置。

## Decisions

- helper 局部懒加载文件系统：Electron 通过 `createRequire(import.meta.url)('original-fs')` 获取物理文件 API；普通 Node 使用既有 `node:fs`。类型、权限、真实路径、PE 读取全部使用同一局部 API。
- 不改变 `process.noAsar`，避免影响并行的 Harness 模块加载；不依据异常文字吞掉错误，避免把权限或损坏伪装成不存在。
- 文件系统选择不新增包依赖或持久化。需要原始 FS 却不可用时仍报安装读取错误，不静默回退。
- 使用独立模拟 Electron 文件系统测试补足环境差异；Windows 实际 Host 捕获一次错误并还原临时诊断，再安装修复包验证真实状态及自动路径保存。

## Risks / Trade-offs

- [原始 FS 获取时机] → 懒加载，仅在此安装检查需要读文件时访问 Electron 内置模块。
- [扩大普通文件放宽范围] → 不放宽文件/权限/PE 约束，仅读取实现改用物理 FS。
- [诊断泄露/残留] → 路径与底层错误仅存私有测试目录；不记录凭据，捕获后恢复原 bundle 并校验 hash。

## Migration Plan

无数据迁移。先确认实机 Host 原因、专项回归、类型检查及隔离构建，再确认两端空闲后更新同版本 Desktop。出现回归可恢复此前包，保留用户路径与会话。
