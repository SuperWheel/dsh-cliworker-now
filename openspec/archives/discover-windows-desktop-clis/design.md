# Design

## Context

见 proposal.md。统一解析在 adapters.ts，Windows Codex 已有可取消 metadata 查询，ZCode 默认路径及 OpenCode 通用 PATH 无自定义桌面发现。Windows 实读确认：ZCode 3.14.5 / OpenCode 2.0.26 的卸载 InstallLocation 均空，分别由 uninstall ICO / app EXE 的 DisplayIcon 和 StartMenu/Desktop 快捷方式定位。不能只读一个猜测的注册表键。

## Goals / Non-Goals

**Goals:** 增加 Windows metadata 后备发现并在共享 resolver 中贯通；保留明确来源和进程生命周期。

**Non-Goals:** 全盘扫描、安装/升级第三方 CLI、复制桌面账号、自动选择多个版本、拓展 macOS 的自动发现范围（本次路径保存和手动管理适用 macOS/Windows）。

## Decisions

1. 新 Host helper 在一个非交互 Windows PowerShell 子进程内，只读 HKCU/HKLM 的 Registry64/Registry32 uninstall 与目标 App Paths，并通过已知用户/公共 StartMenu/Desktop 有界枚举已有目标快捷方式。Shell.Application GetLink.Path 不创建、保存或执行 link。匹配 DisplayName 后提取 InstallLocation、DisplayIcon 的合法目录；不读取或执行卸载字符串。补充独立的已知 vendor 默认目录及精确产品名的运行中进程 image path；不启动桌面、不读进程命令参数。DisplayIcon 是注册表字段，不要求存在桌面图标。只返回产品、来源及候选安装路径，不返回原始命令或其他产品资料。
2. 查询有总时限、64 KiB 输出、记录/目录数量和深度上限（桌面只查根目录、开始菜单最多 4 层），跳过 reparse 目录。不完整/失败不能报未安装；取消和异常复用 captureCatalogMetadata 的范围退出门禁，不缓存整份 metadata；成功解析的 CLI 路径按下文保存。
3. Host 将 metadata 当不可信数据，拒绝控制字符、相对/device/网络路径。ZCode 只检查同安装根的 resources/glm/zcode.cjs 和 resources/config/provider/zcode-builtin.json；OpenCode 只检查 root/opencode-cli.exe 或 resources/opencode-cli.exe，并校验普通文件与 PE。canonical 文件必须留在对应安装，按 Windows 不区分大小写去重；不同可用入口拒绝歧义。ICO 文件名或根目录名称不必等于产品名。
4. 显式设置和 managed ZCode 不变。默认原生查找成功保持已有入口；未找到默认入口才查询 metadata。OpenCode PATH 指向有桌面资源标识的 GUI 时，从同一安装解析独立 CLI，缺失时短错误；显式 GUI 路径报配置错误，不静默替换。坏权限或未知 launcher 不触发后备发现。
5. 状态错误仍通过 WindowsCliInstallationError 安全投影；错误中区分 CLI 缺失/歧义/探测失败，并给配置字段，不显示原始个人路径。CLI 所在目录不推定账号登录；现有独立账号、选择和启动检查继续运行。
6. 保持 v0.7.8，仅 helper/resolver/状态及取消相关回归、类型检查和 preview。Windows 原生执行真实 metadata 查询，合成自定义目录/快捷方式验证可以不启动模型。无活动任务后更新 Mac 链接和 Windows 本地包，不发布或全量验收。

## Risks / Trade-offs

- installer 没有登记/shortcut 的便携目录无法定位 → 保留明确路径配置，不承诺发现无证据文件夹。
- OpenCode 布局依版本/渠道改变 → 只认实际独立 CLI，不能把 GUI 或 utility-process sidecar 当 CLI。
- stale uninstall 或多渠道安装 → 缺失记录跳过、可用入口去重、不同入口要求显式路径。
- 换安装或查询取消 → 自动缓存文件消失或用户恢复自动识别时重读 metadata；不改用户安装配置，取消不保存迟到发现。

## Migration Plan

无需迁移。原配置不变；回退本次 resolver/helper 与本地包即可。保留本机私有 metadata/测试证据，文档仅写一般规则。

参考：[ZCode 构建](https://github.com/zai-org/ZCode/blob/main/packages/desktop/electron-builder.config.js)、[OpenCode 当前构建](https://github.com/anomalyco/opencode/blob/dev/packages/desktop/electron-builder.config.ts#L96-L112)、[OpenCode 1.18.35](https://github.com/anomalyco/opencode/blob/v1.18.35/packages/desktop/electron-builder.config.ts#L53-L69)、[NSIS 登记](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/templates/nsis/include/installer.nsh#L133-L157)、[Microsoft App Paths](https://learn.microsoft.com/en-us/windows/win32/shell/app-registration)。

## 路径管理补充（用户后续明确）

- 全部 11 个 CLI 在首次成功解析后保存本机绝对路径，后续优先复用。Host 私有存储记录自动/手动来源，按平台和机器隔离；已有 deployment 显式路径仍高于自动缓存，UI 手动指定高于 deployment。恢复自动识别只移除 UI 手动/缓存记录，不改部署配置。
- 保存路径只作定位缓存，每次仍检查文件/原生入口。自动缓存文件消失时重新发现；手动路径失效保留输入并显示错误，不切换到另一安装。路径通过单一 argv 传递，不解析 shell、参数、~ 或环境变量。
- revision 比较防止旧自动探测覆盖手动更新。修改路径时拒绝该 CLI 的活动/排队任务和账号终端；取消不采用迟到结果，进程清理未确认继续沿用 Host 阻塞。
- Gateway 提供路径状态、保存刷新及恢复自动接口。Client 每个 CLI 页在“项目默认设置”之外独立展示 h3“高级设置”，默认折叠；展开为“CLI 路径管理”，显示来源和预填路径、可手动编辑，刷新后更新 CLI 账号与模型状态；失败保留输入。路径是本机设置，不跟随项目模型设置。
- 关闭/切换页面取消请求；迟到读取不得覆盖正在输入的路径；没有识别结果时留空，不填虚构路径。
