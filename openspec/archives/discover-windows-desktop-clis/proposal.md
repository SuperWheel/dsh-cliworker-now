# Proposal

## Why

Windows 上的 ZCode Desktop 自定义安装到 `E:\Trae CN\ZCode` 后，现有 `executableFor` 只看默认目录与 PATH，会漏掉实际存在的 `resources/glm/zcode.cjs` 并误报未安装。OpenCode 没有桌面 CLI 发现分支，随部分桌面版本提供的 `opencode-cli.exe` 也可能漏检或与 GUI 主程序混淆。

## What Changes

- 为 Windows ZCode/OpenCode 增加有界、只读的已知默认目录、安装登记、运行中产品映像位置和已知快捷方式发现，支持非系统盘、自定义目录、中文与空格。
- 根据对应产品的真实布局核验 CLI；明确配置及已部署 ZCode 运行时继续优先，不扫描任意磁盘、不启动安装器或桌面 GUI。
- 桌面已存在但 CLI 缺失、查询失败和多个不同可用安装给出可解释提示；不按最新版、修改时间或任意顺序选取。
- 状态、模型发现、登录及任务共享解析入口，保留账号、会话、权限和进程清理边界。
- 首次成功识别保存并复用本机路径；手动路径刷新、自动路径失效重找和恢复自动识别。保存来源、按 CLI/平台/机器隔离，拒绝迟到查询覆盖用户更新。
- 版本保持 v0.7.8；仅相关最小回归、类型检查、隔离构建及 Windows 原生元数据/参数验收，不发布、不跑模型或全量。

## Capabilities

### New Capabilities

- `harness-cli-path-settings`: 全部 CLI 的本机路径持久化与高级设置交互。

### Modified Capabilities

- `platform-runtime`: Windows 桌面随附 CLI 的自定义安装位置发现与入口核验。
- `cli-connection-health`: 桌面安装、独立 CLI 缺失、歧义及查询异常的诊断。

## Impact

Host 的 Windows 安装发现、统一可执行入口解析、必要状态诊断和相关测试；README、设计与验收日志。新增全部 11 个 CLI 的本机路径保存和 Gateway 路径管理接口；Client 每个 CLI 页以独立、默认折叠的“高级设置”承载路径管理。无新增依赖，不改 Harness 核心、账号或会话。OpenCode 桌面发行物的布局依版本和渠道而异，只接受实际存在且核验通过的 CLI，不承诺所有桌面版本包含独立 CLI。
