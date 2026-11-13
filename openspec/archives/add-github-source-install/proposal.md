# Proposal

## Why

用户希望像截图一样使用 `github:SuperWheel/dsh-cliworker-now` 安装插件。当前仓库的 `main` 指向 `lib/index.js`，但 lib 不入 Git 且没有 Git 依赖打包构建钩子，单独给出简写不能证明可安装。

## What Changes

- 增加 GitHub 源码依赖安装时的构建入口，复用现有跨平台构建和完整辅助文件清单。
- 普通源码安装依赖不触发插件重建；npm/Release 预构建包继续无生命周期脚本。
- 双语说明增加 Desktop/Web GitHub 简写与固定 commit 方式，解释仅按安装器提示批准对应源码构建，不自动放宽用户配置。
- 在隔离环境做 Git 源安装、构建产物和注册的最小验收，保持 v0.7.8，不重发 npm 或替换 Release 资产。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `package-distribution`：增加遵循原生构建授权的 GitHub 源码安装方式。

## Impact

影响 package.json 的源码打包脚本、安装文档和关联验收。Host、Client、Gateway、界面名称和用户数据路径均不变。新增入口与既有 npm 安装并存；源码安装获取当前 Git 提交，不宣称等于冻结 npm 包。
