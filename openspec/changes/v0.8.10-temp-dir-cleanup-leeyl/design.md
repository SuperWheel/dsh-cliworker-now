# Design

## Context

四处删除失败及 catalog 失败泄漏已经源码确认；128 MB 解包和 Windows 占用来自用户实机证据。本机 OMP 可执行文件存在 PI_NATIVES_DIR 字符串；Pi 1.5.2 安装包 dist 的 350 个 JS 文件未找到该变量，不对 Pi 套用 OMP 协议。未确认 OMP 自带缓存淘汰。

## Goals / Non-Goals

回收插件自己的短期资源，降低 OMP 重复解包；不触碰真实账号、正式任务 HOME、代理配置与现有清理保护。

## Decisions

- 共用 ESM 文件辅助器供 Host 与原生子进程使用，rm recursive/force/maxRetries=6/retryDelay=150，异常转 false；不把磁盘清理错误当进程范围清理错误。
- extendedCatalog 用 try/catch/finally，仅 ProcessCleanupUnconfirmedError 跳过删除。ZCode 临时目录同样遵守该规则。
- 清扫只 lstat 真实目录；状态目录逐层检查 catalog/CLI/query，临时目录只按源码确认的插件前缀；不递归发现其他候选，不读取文件内容。源码中的 native-request-、login-、run-、terminal-、hermes-、kimi-、pi/omp 账号/登出、request-、downloads/local-、image-、desktop-update- 与安装 staging 均位于各自状态/安装目录，不加入系统临时目录清扫。cliworker- 下仅列出本插件实际 mkdtemp 名称，避免误删同前缀外部项目。一小时远超元数据的秒级超时，年轻目录保护覆盖扫描与新建并发；使用仅含进程号的目录标记保护当前及其他存活 Host 的活动目录；确认退出后删除标记，磁盘删除失败可在下次清扫重试。历史无标记目录沿用一小时门槛。
- 启动工作异步运行，AbortSignal 控制扫描，卸载等待任务；查询前同一状态根节流十分钟且合并在途清扫。
- OMP 共享缓存为 <state>/omp-natives，权限 0700；版本目录按数值版本排序保留三个，近期目录暂缓删除，锁定的下次重试。身份、登录选项、catalog 和 approval --help 使用共享目录；bridge 仅元数据阶段向 OMP 注入，正式运行保持原行为。代理键大小写均保留。

## Risks / Trade-offs

一小时门槛是保守的回收启发式，不是历史目录进程退出证明；当前已知活动资源必须排除。Windows Defender 与原生句柄释放的实际时长仍需用户实机验收。锁定缓存可暂时超过三个版本。目录链接检查不能提供对恶意并发替换的内核级原子保证，但不得主动跟随已发现链接。

## Migration / Rollback

无数据迁移，旧临时目录渐进清扫；共享缓存可由 OMP 重建。不修改 cleanup-blocked 标记。回退代码即可停止清扫与缓存注入。

## Open Questions

Windows native addon 实际复用、磁盘占用稳定及 Defender 锁释放尚待用户复验；Pi 没有已确认的同等变量，不注入。
