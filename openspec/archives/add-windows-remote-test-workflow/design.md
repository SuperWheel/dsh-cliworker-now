# Design

## Context

见 proposal.md 的问题范围。现有 Windows CI 使用固定 pnpm、平台定向测试和实际进程夹具；Mac preview 独立于 Desktop 链接。用户测试机已有 Windows 11 x64、Node 24、Git、Python，SSH/SFTP 往返已通过；具体地址、密钥和主机指纹只保存在本机私有配置。

## Goals / Non-Goals

**Goals:** 建立一次命令的可复用开发验收；验证 Mac 产物在真实 Windows 和 Windows 本机 SDK 依赖中运行，取回报告。

**Non-Goals:** 插件运行时远程派遣功能、全局工具替换、Desktop 升级、真实账号操作、模型生成或 GUI 验收。官方 CLI 额外启动探针可按后续验收独立执行，不作为默认成功条件。

## Decisions

- 本机 Node ESM 编排系统 ssh/scp，均采用参数数组、严格主机记录和 BatchMode；远端以固定 PowerShell 编码命令启动自身 Node runner。连接参数不嵌入 shell 任务文本。
- 允许列表快照包含 package/lock/workspace 配置、src、定向 tests、构建所需脚本及 TS/Vitest 配置。禁止目录链接及凭据文件；每次运行独立编号、清单与哈希。Mac preview 打包后单独传送，同一包在 Windows 加载。
- Windows 专用根目录有归属标记；共享 tools 内通过已有 npm 准备锁定 pnpm，各 run 内安装冻结依赖。环境通过子进程 env 对象设置隔离用户目录、npm 配置、缓存和 DSH_HOME，不修改用户全局环境或生产配置。默认依赖网络仅用于安装工具/包，验收不调用模型。
- 复用 CI 七个文件；实际 Job、ConPTY、Python 进程属于原生验收，临时账号与 launcher 数据属于合成夹具。当前 Windows Node 24 满足包引擎，但与 CI Node 22 是不同的矩阵记录。
- Windows 运行器按阶段输出报告和日志；运行退出码、Vitest JSON、接收包哈希及加载结果相互核对。未成功阶段不遮蔽。仅清理自身锁和进程，证据目录保留；本机 POSIX 私有目录 0700、文件 0600。
- 不执行根目录正式 build，不改变 Mac Desktop 当前 lib 或 Windows Desktop。Harness CLI/SDK 随本机测试依赖准备在隔离源码目录，不要求把 dsh 添加到全局 PATH。
- 冷源码的 Client 类型检查依赖包自身生成的 `lib/typert.remote-client.d.ts`。在 Windows 校验并解包 Mac 产物后，将其 lib 复制到本次源码测试目录，记录 `mac-contract-types` 阶段；Host 加载仍直接指向原解包产物，不在 Windows 重新生成协议或替代 Mac 包。

## Risks / Trade-offs

- [依赖下载慢或网络失败] → 阶段日志和非零状态可回传，不更换未经确认的镜像或忽略可选 native 依赖。
- [Windows 全量用例含 POSIX 假设] → 复用现有 CI 集，独立验证新增开发工具用例；不声称全套 Windows 通过。
- [共享工具目录写冲突或中断] → 专用运行锁和自身进程清理；不能确认时保留失败与锁。
- [包加载不等于 GUI 或真实推理] → 报告固定列出未执行边界，不把离线测试作为全 CLI 模型兼容性证明。

## Migration Plan

配置本机私有连接文件，运行远程命令，核对阶段及产物；失败修复后创建新 run。撤销只需删除本次开发入口和专用测试目录，既有项目及账号不依赖它。
