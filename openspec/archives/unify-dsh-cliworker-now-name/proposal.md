# Proposal

## Why

同一插件目前混用 cliworker-now 仓库名、CLI Worker/CLI Worker Now 展示名与 dsh-cliworker-now npm 包名。用户要求统一为 dsh-cliworker-now，并同步外部插件目录，避免安装与搜索混淆。

## What Changes

- GitHub 仓库及当前外部文案统一使用 dsh-cliworker-now；同步 README、Release 模板和后续打包元数据。
- 根据用户最新澄清，保留 DSH 内全部现有界面名称、Host 文案及派遣称呼，运行时代码不变；保留历史记录、已发布包、配置和协议标识。
- 更新市场提交，核对 dshfind 条目迁移与真实下载统计；缺少目录管理权限的操作保留明确待办。
- 当前源码版本仍为 0.7.8；已提交 npm 的不可变包不重发、不替换资产，不擅自增加版本号。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `package-distribution`：统一当前对外名称，同时维持旧安装和持久化兼容。

## Impact

打包元数据、README、Release、GitHub remote、市场条目与 dshfind 主键。保持 cliworker Gateway、工具 ID、Cordis patch id 和私有存储路径不变。历史源码/截图与旧 npm 包的原名如实保留。
