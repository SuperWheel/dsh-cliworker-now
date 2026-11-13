# Design

## Context

动机见 proposal.md。当前构建脚本已生成 Host/Client、Gateway 协议及平台辅助资产，使用 Node 参数数组和 Windows junction；lib 被 Git 忽略。pnpm 的 Git preparePackage 在 main 不存在且有 prepack 时请求精确来源的 allowBuilds 授权，安装开发依赖后执行 prepack。

## Goals / Non-Goals

**Goals:** GitHub 简写能安装完整当前源码，授权由宿主安装器管理，保持普通 pnpm install 的原有行为。

**Non-Goals:** 不新增运行功能、后台更新、默认脚本放行、版本号或 npm 发布；不修改已冻结的安装包、正式 Desktop 或用户 profile。

## Decisions

1. 使用 `prepack: node scripts/build.mjs`，复用已有完整构建。没有选择 prepare：prepare 会在普通本地安装依赖时运行，可能意外重建仍被 Desktop 使用的 lib。没有选择预构建分支：用户要默认仓库的源码简写，分支入口不能替代默认入口。
2. 保留开发清单 private:true、现有 files 和 packageManager。公开预构建清单由 package-release.mjs 生成且无 scripts，新增源码钩子不进入 npm/tgz。
3. 文档展示原生 GitHub 简写，推荐需稳定复现时固定 commit；构建授权使用安装器实际打印的完整依赖标识，不能猜键名或放行所有依赖。
4. 测试使用独立 HOME、DSH_HOME、profile 和缓存，不继承账号，不启动模型；核对 Git 来源、实际安装版本、产物与注册。真实 Host 夹具须证明加载安装目录，开发仓库路径污染不能计入通过。
5. 源码构建前置条件为 Node.js >=22.19 和 PATH 中可调用的项目固定 pnpm 11.25.0。Windows 实测中，Harness 内置的外层安装器不能替代嵌套构建所需的 pnpm 命令；文档明确准备工具链，测试仅在独立目录提供该命令，不自动安装全局工具或修改系统 PATH。

## Risks / Trade-offs

- 源码构建依赖下载、平台原生工具或安装器版本可能失败 → 保留原生原因，分别记录平台验证，保留 npm/Release 备用方式。
- Windows 的深层缓存/临时目录可能导致 cmd 子进程无法启动，并被 pnpm 显示为流不可读错误 → 隔离验收使用较短目录；保留首次失败及合成长路径对照，不修改系统长路径策略，文档保留预构建备用方式。
- 默认分支随开发变化 → 提供固定 commit 说明，不把源码入口描述为仅跟随 npm 稳定版。
- 后续打包将生命周期带入发布包 → 继续由现有预构建清单生成器丢弃 scripts，并核对冻结包未变。

## Migration Plan

先通过隔离 preview 构建，再在用户明确批准推送后提交源码构建入口；使用公开地址执行两平台隔离原生安装，核对后补全安装说明和验收记录。撤回时移除源码 prepack 和对应文档，不触碰已有安装、用户数据或公开 npm v0.7.8。
