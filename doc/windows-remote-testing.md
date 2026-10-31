# Windows 远程测试

此开发入口在 Mac 构建隔离插件包，通过 SSH/SFTP 传到指定 Windows 原生测试机，在 Windows 安装本机依赖、执行定向回归并取回报告。它用于验证同一 Mac 构建产物及 Windows 运行层；不是插件运行时的远程派遣功能。

## 1. 首次准备

- Mac：安装仓库锁文件依赖，可运行项目固定的 pnpm；系统提供 `ssh`、`scp`。
- Windows：安装满足 `package.json` 引擎要求的 Node.js（当前为 `>=22.19.0`），并确保 SSH 会话能找到 `node`、`npm` 和 Windows `tar`。定向进程测试还需本机 Python。
- Windows：启用 OpenSSH Server，确认 `sshd` 运行、SFTP 子系统可用及防火墙允许测试机访问；参见 [微软安装说明](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse)。
- 为这条连接使用专用 SSH 密钥，只把公钥加入 Windows 授权文件。管理员账号按 [微软密钥管理说明](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement) 配置 `administrators_authorized_keys` 的权限；私钥始终留在 Mac。
- 通过 Windows 本机输出或其他可信渠道核对服务器公钥指纹，然后写入专用 `known_hosts` 文件。网络扫描取得的公钥需要先比对指纹，不能把扫描本身作为服务器身份确认。

连接使用显式账号和密钥、`BatchMode` 及严格主机校验。主机记录不匹配时立即失败，不接受新指纹、不回退到密码，也不修改通用 SSH 配置。

## 2. 私有连接配置

在仓库内建立 `.test-data/windows-remote/config.json`；`.test-data/` 已被 Git 忽略。下列字段都需要显式填写，示例中的大写占位符应替换为自己的值：

```json
{
  "host": "WINDOWS_LAN_ADDRESS",
  "user": "WINDOWS_USER",
  "identity": "/ABSOLUTE/MAC/PATH/TO/DEDICATED_PRIVATE_KEY",
  "knownHosts": "/ABSOLUTE/MAC/PATH/TO/DEDICATED_KNOWN_HOSTS",
  "remoteRoot": "C:/Users/WINDOWS_USER/AppData/Local/cliworker-now-remote"
}
```

`identity` 和 `knownHosts` 是 Mac 上的文件路径；`remoteRoot` 必须使用 `盘符:/Users/用户名/AppData/Local/cliworker-now-remote`，不能另填已有项目、账号目录或 Desktop 数据目录。工具用 `.cliworker-remote-owned.json` 标记专用根目录的归属；目标已有内容却缺少有效归属标记时，拒绝写入。

连接配置、密钥路径、服务器地址和指纹、机器路径、运行日志及报告属于本机私有数据，不能提交到 Git。Mac 私有运行目录使用 `0700`，私有文件使用 `0600`；密钥文件不会被打包或上传。

## 3. 执行

在 Mac 的仓库根目录运行：

```sh
pnpm --config.verifyDepsBeforeRun=false test:windows:remote --config .test-data/windows-remote/config.json
```

查看参数帮助：

```sh
pnpm --config.verifyDepsBeforeRun=false test:windows:remote --help
```

这个入口按以下阶段执行：

1. 校验连接配置及允许列表源码，构建 Mac 隔离 preview 并打包；不会运行覆盖当前 Desktop `lib` 的正式构建。
2. 传送源码快照、清单和 Mac 包，核对接收文件哈希。快照包含允许的包配置、锁文件、`pnpm-workspace.yaml`、整个 `src` 和 `tests` 目录、构建脚本（`build.mjs`、`build-preview.mjs`、`build-dependencies.mjs`、`host-runtime.mjs`、`host-extension-guard.mjs`）、`runtime-host/` 及构建/测试配置；`runtime-host/` 必须与其 `manifest.json` 清单逐项一致（文件集合、字节数与 SHA-256）。测试源码随快照传送，执行限定为下列定向文件。不包含 Mac `node_modules`、凭据和用户运行数据，不跟随目录链接。
3. 在 Windows 专用根目录准备工具。`tools` 中安装项目固定的 pnpm（当前为 `11.25.0`），各次运行放入不同编号的 `runs` 目录；不做全局 pnpm 或 Harness 安装。
4. 在该次 Windows 源码目录使用 `--frozen-lockfile` 安装依赖，继承 `pnpm-workspace.yaml` 的 native 构建许可。Windows native 库必须在 Windows 本机安装，不能复用 Mac 依赖，也不能省略必要的 native 安装来凑出通过结果。
5. 按源码快照中的 `runtime-host/manifest.json` 校验包条目：`package/runtime-host/` 只能含清单文件及其上级目录，缺项或多项均拒绝；解包后再逐文件核对摘要。随后将其生成的 lib/协议声明复制到本次源码测试目录，执行类型检查和下列 Windows CI 定向测试文件；Host 入口加载仍指向原 Mac 包，并使用 Windows 本机依赖。
6. 取回报告、Vitest JSON 及阶段日志，核对测试结果、阶段退出码和包哈希。工具保留证据目录，只清理自身锁及进程。

定向测试文件与 [Windows CI](../.github/workflows/windows.yml) 一致：

```text
tests/windows-accounts.test.ts
tests/windows-process.test.ts
tests/native-launch.test.ts
tests/pi-omp-identity.test.ts
tests/adapters.test.ts
tests/account-login.test.ts
tests/model-presentation.test.ts
tests/windows-account-owner.test.ts
tests/windows-account-terminal.test.ts
tests/windows-cli-resolution.test.ts
tests/windows-codex-launch.test.ts
tests/windows-system-proxy.test.ts
tests/opencode-windows-login.test.ts
tests/zcode-grok-windows-regression.test.ts
tests/authorized-catalog-windows-agy.test.ts
tests/native-agy-acp.test.ts
tests/agy-account-guide.test.ts
```

发布验收不再在 Windows 上跑隔离环境全量 vitest：v0.8.2–v0.8.4 每轮失败集合都不同、正常环境串行重跑全部通过、根因未定位，排查成本高于收益。涉及 Windows 平台代码的改动，应把对应测试文件加入此清单和 Windows CI。

子进程的用户目录、npm 配置、缓存和 Harness 配置使用隔离环境。工具不改变现有 CLI 安装、账号或 Desktop 配置，也不要求把 Harness 命令加入全局 PATH。首次工具或依赖安装需要联网；测试过程中不发送模型任务。

## 4. 验收结果及边界

以本次回传的报告和实际日志为准。成功至少需要：源码与包校验完成、锁文件依赖安装成功、类型检查成功、全部定向文件的测试结果成功、Mac 包 Host 入口加载成功，以及结果下载和哈希核对成功。测试数量由本次 Vitest JSON 统计，不能套用历史版本数字。

报告记录 Windows 架构、Node/pnpm 版本、源码和插件包哈希、阶段状态及测试结果。任一阶段失败时整体非零退出，并尽可能取回已产生的日志；缺失或中断的阶段不等于通过。Windows 上只允许 `pi-omp-identity.test.ts` 中已知的 POSIX Pi launcher 用例跳过，并保留跳过计数；它不算通过，其他跳过项会使验收失败。

Mac 本机证据保存在以下目录。`UUID` 对应本次运行编号，`remote/` 保存从 Windows 回传的文件；失败时也尽可能回传已生成的文件：

```text
.test-data/windows-remote/runs/<UUID>/
  local-report.json
  remote/
    report.json
    windows-tests.json
    logs/
```

先检查 `local-report.json` 的整体结果，再检查 `remote/report.json` 中的阶段状态、`remote/windows-tests.json` 中的测试计数及 `remote/logs/` 中的阶段日志。前置阶段失败时，尚未生成的远端文件可能缺失。

同一专用环境已有运行锁时拒绝并发写入；中断后无法确认自身进程已退出时保留失败及锁，不能直接删除未知进程或目录。

| 证据 | 默认范围 |
| --- | --- |
| 源码定向回归 | 含合成的账号、launcher 和协议夹具；不代表已使用真实账号 |
| Windows 实际进程 | 定向用例覆盖本机 Job、ConPTY 和 Python 进程行为 |
| Mac 构建包 | 校验同一包在 Windows 本机依赖中的 Host 入口加载 |
| 官方 CLI 启动 smoke | 不属于默认入口；Windows CI 中的额外步骤需独立安排 |
| 真实 CLI 模型调用 | 未执行；默认模型请求数为零 |
| Windows Harness Desktop | 未执行；布局、导航及交互需桌面会话或截图验收 |

此入口复用现有 CI 定向集，不能据此宣称 Windows 全量测试、全部 CLI 的真实模型调用或 Desktop 界面都已通过。每次实际验证与环境差异记录在 [任务与实际验证](tasks.md)。

## 5. 失败处理

- SSH 失败：核对地址、账号、专用密钥、主机记录及 Windows `sshd`，不关闭主机校验来绕过失败。
- SFTP 失败：检查 Windows OpenSSH 的 SFTP 子系统实际路径和权限；先完成文件往返，再运行验收。
- 工具或依赖下载失败：查看对应阶段日志，修复网络后创建新 run；不自动换镜像或修改锁文件。
- pnpm/native 依赖失败：核对 Windows 本机 Node、架构和 `pnpm-workspace.yaml`，不上传 Mac 的依赖目录。
- 归属或锁检查失败：先核查目标目录及前次清理记录，保留未知目录；无需清理用户现有项目或 Desktop 数据。

### 5.1 Windows 重启后重新连接

Windows 重启后，局域网 DHCP 地址可能变化。旧地址超时不代表 SSH 密钥失效。先确认电脑已开机并连接同一网络，在 Windows 用 `ipconfig` 查看当前 IPv4，用 `Get-Service sshd` 确认 SSH 服务为 `Running`；只使用用户从测试机提供的新地址，不扫描或猜测替代目标。

新地址首次连接仍使用原专用密钥、原 `knownHosts` 文件及 `StrictHostKeyChecking=yes`。可临时设置 `HostKeyAlias` 为私有配置中此前已核验的旧地址，让新连接核对同一个已固定的服务器公钥。主机身份不匹配时立即停止，不使用 `ssh-keyscan` 的扫描结果替代身份确认。

严格校验成功后，可以在专用 `knownHosts` 中为新地址增添同一既有公钥的别名记录，并仅更新私有 `config.json` 的 `host` 字段。保留旧公钥记录及其他配置字段，两个私有文件均保持 `0600`。再使用不带临时 `HostKeyAlias` 的默认严格连接验证一次，确认后续工具可直接复用配置。实际地址、账号、密钥路径及指纹不写入文档或 Git。

重连验证仅检查网络、服务器身份、SSH 服务及已有工具，不运行测试或模型。完整远程验收入口会构建、安装依赖并运行固定的 Windows 测试集；需要最小验收时，应在独立的专用运行目录执行本次变更涉及的用例。历史运行的依赖可能已清理，须先确认可复用的 Windows 本机依赖，不能把缺失或未执行的测试记为通过。
