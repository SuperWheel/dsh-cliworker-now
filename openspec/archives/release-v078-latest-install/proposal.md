# Proposal

## Why

v0.7.8 已累积路由兼容、CLI 发现、设置页与 Windows 后台启动修复，用户现已批准全量验收及 GitHub、npm、市场更新。现有首页安装行固定在 v0.7.7，需要验证重复执行能否更新，而不是只验证首次安装。

## What Changes

- 将双语首页的推荐安装及更新入口改为显式 `@latest`，保留固定 v0.7.8 Release 包作为备用来源。
- 用隔离 profile 核验首次安装与旧版升级；说明执行命令才更新，宿主启动不自动更新。
- 对本次 v0.7.8 执行 macOS/Windows 全量自动验收、Desktop 定向验收及公开包一致性验证；修正验收发现的问题。
- 依次提交 GitHub、npm 和现有市场 PR；保留未执行的真实登录、模型生成及市场待审核边界。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `package-distribution`：推荐安装行使用经验证的最新版本选择器，并要求现有安装的升级证据。

- `platform-runtime`：修复 Windows 后台引导器退出与 SQLite 长路径读取。
- `cli-account-isolation`：补齐 Windows 原生文件读取的链接及路径替换拒绝。
- `cli-model-discovery`：持久保存设置模型目录并按宿主生命周期刷新；修复 Claude 路由和 Codex 当前目录来源。

## Impact

影响 README、发布与测试证据、package-distribution 规格及市场元数据。不增加当前 v0.7.8 版本号，不迁移用户会话或凭据，不增加宿主自动更新机制。已有 Host/Client 修复沿用对应已归档规格；新增运行问题若改变行为需同步相关规格。

用户追加要求已确认：缓存可选列表，保留仍有效的已选默认值；无效默认值提示重新选择。Windows 全量回归发现 OpenCode、Hermes 和 Pi 元数据读取对 O_NOFOLLOW 的跨平台假设，本次补齐路径/句柄检查。
