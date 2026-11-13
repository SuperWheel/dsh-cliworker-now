# Design

## Context

见 proposal.md。`native-process.ts` 对非 Electron 自身的 Windows 原生目标已有 GUI 引导器、三路管道及私有退出回执；Node 入口仍通过 Electron 直接运行。当前 Windows Codex 0.162.1 的启动脚本随后以继承句柄方式创建原生程序，构成已确认缺口。Antigravity 原生入口在热查询中正确进入引导器，但冷查询触发内部自动更新；本机 updater 日志的 PID 28472 与实际 AGY 自派生链相符，已从标题线索推进到启动原因的实证。

## Goals / Non-Goals

**Goals:** 隐藏真正后台启动，不删账号与目录校验；核对现有各类启动入口；保留退出回执、SDK Job 范围和取消确认。

**Non-Goals:** 修改第三方安装或 Harness 核心；统一重写任意 CLI 的内部进程创建；更改用户终端默认应用、账号、路由或模型配置；执行真实生成。

## Decisions

1. Codex 在普通后台 spawn 正规化之后生成专用描述符，仍记忆原 JS/shim 路径，交互 spawnTerminal 不变。只对已核验官方 wrapper 的源码指纹应用优化；其他启动器维持原有路径，不以本次修复拒绝原先支持的其他版本。该兼容边界须明确记录，不能宣称任意第三方内部 spawn 都已验证。
2. 描述符核对主包 name/bin/canonical 入口、可选平台依赖别名及平台 manifest 版本/os/cpu、所属包内原生 PE 类型／架构；保留 wrapper 的原参数和包管理器环境。平台包解析不存在时才按官方逻辑回退本包 vendor；已定位包损坏不能换另一安装。环境只传原 env 加增量／删除标记，不重新引入 SDK 清理的全部父环境。
3. 描述符原生目标进入既有隐藏 relay。拒绝修改父进程全局 child_process，亦不在第三方 wrapper 中改 pipe 后继续让其于 exit 立即退出，以免丢失尾部输出。
4. Antigravity 冷开实机出现原生 CLI 内部再次启动自身，热读没有该后代；官方文档说明后台自动更新以 15 分钟 TTL 控制，且提供 `AGY_CLI_DISABLE_AUTO_UPDATE=true`。Windows 当前／旧模型读取入口及普通任务启动只向该 CLI 子进程合并此变量，不修改父环境、用户配置、更新文件、第三方安装或交互账号终端；macOS 和其他 CLI 不注入。独立 helper 与 `firstPartyEnvironment` 分开，避免影响共享该函数的账号交互。
5. 以实际窗口、进程链及固定 updater 日志类别核对修复。验收避开仅在 15 分钟 TTL 内热读的假阴性；不删除用户 updater 标记来制造通过结果。官方依据：https://antigravity.google/docs/cli/troubleshooting/ ，值必须为 `true` 的兼容说明：https://github.com/google-antigravity/antigravity-cli/issues/1046 。

## Risks / Trade-offs

- 上游 wrapper 内容升级 → 未核验版本沿用原逻辑并明确本轮验证范围；后续按实际新版语义扩展，不能靠包名猜环境。
- 平台可选包采用 npm 别名、pnpm 外部实体目录 → 根据各自 canonical 包根校验，不能要求所有文件位于主包目录内。
- 只看到隐藏选项但后代仍可弹窗 → 以实际 Windows 窗口事件为验收，区分测试启动器、已有用户进程与本轮查询。
- 原生进程提前退出而后代持有输出 → 保留现有私有退出回执及完整 Job 清理，不改为 relay 进程退出替代原生退出。

## Migration Plan

无数据迁移。先关联回归、typecheck、preview，再在无任务和账号终端时更新安装包；Windows 用正常 Desktop 冷启动、相关刷新和同值选型观察。正式安装前后保留配置和历史哈希；失败可还原上一构建。v0.7.8、本地阶段提交、无 GitHub 发布。
