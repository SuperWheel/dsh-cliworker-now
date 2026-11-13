# Proposal

## Why

开发者需要在 Mac 构建后，把同一插件产物传到自己的 Windows 原生环境验证并取回证据。现有 `scripts/build-preview.mjs` 与 `.github/workflows/windows.yml` 已提供隔离构建和 Windows 验收步骤，但没有可复用的个人电脑 SSH 测试入口；本会话已实测密钥登录与 SFTP 往返。

## What Changes

- 新增开发命令，使用显式连接配置、固定主机指纹及独立密钥，通过 SSH/SFTP 传送允许列表源码快照和 Mac 隔离构建包。
- 在 Windows 专用目录准备项目锁定的 pnpm 与本机依赖，保留用户现有项目、CLI 安装、账号和 Desktop 配置。
- 运行类型检查、既有 Windows 定向回归及同一 Mac 产物的 Windows 加载检查，下载带版本、哈希、阶段退出码和边界的报告。
- 连接配置、机器路径、运行日志和测试结果置于 Git 忽略的私有目录；不包含真实模型调用或 Desktop 界面验收。

## Capabilities

### New Capabilities

- `windows-remote-verification`: 个人 Windows 测试机的显式连接、隔离执行、构建产物一致性和结果回传。

### Modified Capabilities

无。插件 Host、Client、CLI 派遣及安装协议保持现有行为。

## Impact

新增 `scripts/windows-remote*`、相关开发测试与使用文档，增加 package.json 开发入口；补充 README、设计及验收记录。复用系统 OpenSSH、Windows 现有 Node 与项目 pnpm 版本，不引入插件运行时依赖，不更新 Desktop 链接、不推送远程。
