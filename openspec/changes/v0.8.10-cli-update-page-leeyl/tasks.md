## 1. 共享协议与来源清单 〔后端｜6h〕
- [x] 1.1 新增 `src/shared/cli-management.ts`：分区、原因码、版本信息、计划、操作快照、下载进度、下载源设置的类型与 zod schema
  - 共享文件只放类型、常量与 `customRegistryProblem()`（前后端共用的自定义地址校验）；zod schema 放在 Host（`cache.ts`、`versions.ts`），客户端对 Host 返回值做基本形状校验。typecheck 通过（2026-11-13）。
- [x] 1.2 新增 `src/host/cli-management/sources.ts`：17 个 CLI 的包名、发布源、自带更新命令、默认安装位置、前置条件、兼容范围、版本读取方式与后台可用标记（按 PRD 5.3 表，待核实项不开放自动方法）
  - Phase A：`sources.ts` 明列 17 个 CLI、npm / 已核实的 brew 名称、官方说明、更新 argv（仅描述）、安装位置、前置条件、兼容范围与后台标记；未核实方法保留 manual。`corepack pnpm vitest run tests/cli-management.test.ts tests/cli-management-remotes.test.ts tests/general-settings.test.ts tests/cli-settings.test.ts tests/accounts.test.ts`：5 文件、400 项通过（2026-11-13；CLI / HTTP 均为模拟夹具）。
- [ ] 1.3 来源核实：Gateway 能否区分设置页与 Agent 调用（PRD 第九节第 15 条）

## 2. 版本检查、安装来源识别与缓存 〔后端｜10h｜前置 1〕
- [x] 2.1 安装来源识别：真实路径、npm 前缀与包名、Homebrew 元数据、官方布局、桌面托管、手动类管理器
  - Phase A：`identity.ts` 复用现有路径记录和 `resolveCliExecutable`，读取真实路径、npm 白名单、brew tap receipt、官方布局和手动类管理器；复用 Pi / WorkBuddy 安装读取。正反例、符号链接与应用版本指纹见上述 400 项通过记录。
- [x] 2.2 当前版本读取（有界子进程或清单，Kimi 带 `KIMI_CODE_NO_AUTO_UPDATE=1`）与 SemVer 比较、预发布通道、适配范围（Pi 白名单、OpenCode V1）
  - Phase A：有界读取 5 秒、64 KiB 输出上限、UTF-8 解码、退出范围确认；Kimi 注入 `KIMI_CODE_NO_AUTO_UPDATE=1`，TRAE 复用身份检查；未证实安全的读法返回版本未知。SemVer、预发布、Pi 白名单及 OpenCode V1 测试通过；没有执行本机真实 CLI 的 `--version`。
- [x] 2.3 官方发布源查询：8 秒超时、3 并发、512 KiB 上限、不带凭据、按下载源与官方源核对
  - Phase A：沿用 `hostFetch` 和系统代理；每请求 8 秒、全局 3 并发、512 KiB、omit credentials、拒绝重定向；npm dist-tags / versions 与 Homebrew API；镜像结果向官方核对，官方不可达时保留所选源出处。HTTP 模拟测试通过；npm 路径解析和 config get registry 子进程共用 5 秒上限。
- [x] 2.4 分层缓存：路径与归属长期、版本按文件指纹、最新版本 6 小时、账号状态 10 分钟与项目区分；目录 0700、文件 0600，损坏即丢弃
  - Phase A：`stateDirectory/cli-management/state-<平台>-<机器哈希>.json`；zod 严格校验、损坏整份丢弃、atomicJSON、0700/0600；版本按指纹、发布源 6 小时、账号 10 分钟与项目哈希。账号只落盘显示字段，不存输出、凭据或操作句柄；accountStatus 缓存附 cache.checkedAt / stale / displayOnly，缓存 actions 为空，前端需接 refreshAccountStatus 原地重读及恢复操作句柄；损坏、权限、TTL、源切换和失效防回写测试通过。
- [x] 2.5 Remote：`cliUpdateSnapshot`、`checkCliUpdates`（missing / all）、`watchCliUpdates`，接入插件生命周期
  - Phase A：六个页面 / 下载源 Remote 已注册，参数顺序与 `workers.ts` 对齐；watch 按 revision，snapshot 不探测，check 立即返回、30 秒截止、取消后等待所有并发读取清理。Host / Client `corepack pnpm typecheck` 通过（DSH 0.2.2-rc.2），Remote 模拟测试通过。
- [x] 2.6 单元测试：来源识别正反例、版本比较、指纹失效、缓存损坏、只读快照不启动探测
  - Phase A：新增 `tests/cli-management.test.ts`、`tests/cli-management-remotes.test.ts`；来源、版本、指纹、缓存、网络、只读快照、Remote、账号缓存等纳入上述 400 项回归。
- [ ] 2.7 修复阶段 A 审查（Codex 审查，2026-11-13）报告的 Host 问题
  - P1 `service.ts`：`npm config get registry` 清理未确认后预加载与前台仍会再起 npm 进程，须立即停止后续探测。
  - P2 `service.ts`：启动器指纹不变而清单版本已变时仍用旧缓存版本，须把清单纳入缓存身份或优先用新读出的清单版本。
  - P2 `identity.ts`：自动记录的路径失效后前台检查不重找，误报未安装；前台检查须复用 `resolveCliExecutable` 的失效路径恢复，后台仍只读文件。
  - P2 `service.ts`：旧 `manual` 分组在安装归属变成可识别的 npm 后仍保留，发布源查询被永久跳过；须按新身份重算。
  - （未执行：并入阶段 B 由 Codex 修复。）

## 3. 后台预加载 〔后端｜6h｜前置 2〕
- [ ] 3.1 启动 60 秒延迟、空闲判定（无任务、无登录窗口、无更新、CPU 忙碌低于 50%）、一次一项、间隔 2 秒、子进程降优先级
  - Phase A 已实现并通过模拟测试：60 秒延迟、2 秒 CPU 双采样、忙碌低于 50%、逐项读取与间隔、可取消定时器、私有启动器对子进程调用 os.setPriority；只读取已记录路径，不后台搜索。
  - （未执行：决定 7 的第五类「缺失模型目录」后台补齐尚未接入。现有 MiMo 目录路径可执行 models --refresh，其他原生目录可能建会话或续期；没有把这些读法标成无副作用。保留本项未勾选，不声称五类预加载已全部完成。）
  - 后台账号仅允许 MiMo、CodeBuddy 的本地文件投影，并禁止其退回 PATH / 注册表 / 原生身份探测。跳过 Antigravity、Codex、Claude、Kimi、ZCode、Grok、OMP、Pi、Hermes、OpenCode、Qoder、Qoder CN、TRAE CN、WorkBuddy CN、WorkBuddy；原因列于 service.ts 白名单注释。
- [x] 3.2 派遣、账号窗口、更新时暂停并确认子进程退出，空闲 30 秒后从断点继续；页面打开时切前台并复用结果
  - Phase A：runtime 与账号 reservation 发出通知；当前项 abort 后等待退出，30 秒空闲后重试；页面接管等待当前读取完成，复用版本 / 发布源 / 安全账号缓存，剩余页面检查并发执行。模拟暂停、CPU 采样中接管、并发清理等待、账号队列接管测试通过；实际更新操作的准入接线由阶段 B 的 4.2 继续。
- [x] 3.3 通用页开关「启动后在后台检查 CLI」（默认开）接入 `generalSettings`
  - Phase A：`GeneralSettings.backgroundCliCheck: boolean` 默认 true，Host 读取、保存、nullable 恢复默认与 schema 接入；general-settings 回归通过。前端开关由主会话负责。
- [x] 3.4 单元测试：延迟、空闲判定、暂停与继续、指纹不变不启动进程、开关关闭、插件停用清理
  - Phase A：启动延迟、CPU / Worker / 账号 / 操作忙闲、开关关闭、暂停继续、指纹复用、停用清理模拟测试通过。`corepack pnpm vitest run tests/native-process.test.ts` 首次沙箱内因 `/bin/ps EPERM` 失败，批准沙箱外重跑后 1 项通过；这是 Node 夹具进程范围验收，不是实际 CLI / Windows 验收。

## 4. 更新执行、维护锁与停滞续传 〔后端｜14h｜前置 2〕
- [ ] 4.1 计划与指纹：`planCliOperation`、开始前重算指纹、受控方法 ID、requestId 幂等
- [ ] 4.2 维护锁：同步准入，接入派遣、续聊、账号、模型目录、路径修改；有任务时拒绝更新
- [ ] 4.3 执行器：npm（同前缀、精确版本、`--registry`）、Homebrew、CLI 自带更新命令；输出去 ANSI、脱敏、32 KiB 尾部；进程树取消后才报告已取消
- [ ] 4.4 下载器：10 秒停滞、Range 续传（206/200/416）、200 次、2 小时、integrity 校验、临时文件 24 小时与 2 GB 上限
- [ ] 4.5 结果核对：重新解析路径与版本，等于目标才成功；版本未变、身份变化、清理未确认分开编码
- [x] 4.6 下载源设置：四个选项、自定义 https 校验、连接检查、不改用户 npm 配置
  - Phase A：四个下载源选项按本机持久化，自定义 HTTPS / 无凭据 / 无查询参数校验，连接检查，`npm config get registry` argv 只读查询；不写 npmrc。下载源与 Remote 模拟测试通过；安装 / 更新时使用 registry 留在阶段 B。
- [ ] 4.7 单元测试：互斥、任务占用拒绝、更新期间拒绝派遣、取消与进程树退出、停滞续传与上限、Range 不支持、校验失败、输出截断与脱敏、窗口关闭后继续、插件停用清理

## 5. 首次安装 〔后端｜10h｜前置 4〕
- [ ] 5.1 纯 CLI 安装：官方推荐优先、同为推荐用 npm；官方脚本只用内置地址、先下载再以文件执行；前置条件检查
- [ ] 5.2 桌面应用安装：ZCode、WorkBuddy CN、WorkBuddy 的位置校验（权限、空间、非空目录）；macOS DMG 复制流程；Windows 打开官方安装程序；装后写入路径记录
- [ ] 5.3 单元测试：安装方式选择、前置条件不满足、位置校验、装后路径写入、重新安装改用新路径

## 6. 「更新 CLI」设置页前端 〔前端｜14h｜前置 2〕
- [x] 6.1 导航入口、徽标与转圈；页头（检查更新、全部更新）；分区与统一折叠按钮
  - `settings-dialog.tsx` 第三项导航 + `navIndicator()`；`cli-update-page.tsx` 页头与分区。`useCliUpdateData` 在弹窗打开期间只订阅一次，导航与页面共用。
- [x] 6.2 行组件：32px 品牌图标（深色主题单色图标反相）、版本与来源说明、操作按钮与悬停原因
  - 复用 `BrandIcon`；按钮只用 md/sm；禁用原因走 Tooltip。更新 / 安装按钮调用的 Host 方法在阶段 B/C 实现前不存在，页面按可选方法处理。
- [x] 6.3 加载与重排：缓存直显、缺的进「检查中」、最多两次重排、展开与进行中的行不动、滚动锚点、30 秒上限、整页错误与重试、`aria-busy` 与播报
  - 纯函数 `cli-update-layout.ts`（14 项测试）；30 秒截止在 Host 的 check。整页错误只在没有可显示快照时出现，已有结果时改为分区上方的错误行加「重试」（新增测试覆盖）。
- [ ] 6.4 展开区：下载进度与续传次数、命令与输出、结果状态、手动方法气泡、安装位置气泡
  - 界面已按快照字段实现并用模拟快照测试（`readable=false` 显示「下载进度无法读取」）。（未完成：操作 Remote 在阶段 B/C 落地前无法用真实快照核对；安装位置选择依赖 `chooseInstallDirectory`。）
- [x] 6.5 下载设置：下载源下拉与自定义地址、检查连接
  - `cli-download-source.tsx` + `NativeChoice` 新增说明行 / 分隔线参数；8 项测试。
- [x] 6.6 文案进 `client-localization` 词表；`doc/settings-ui-design.md` 同步新增参数
  - `i18n-messages.ts` 新增 `cli-update-page`、`cli-update-settings` 两区；设计文档新增「「更新 CLI」页」一节。
- [x] 6.7 前端测试：分区归类与重排规则、展开行不动、徽标计数
  - `cli-update-layout`（14）、`cli-update-page`（12）、`cli-update-data`（9）、`cli-download-source`（8）、`general-settings`（8）及 `settings-dialog` 新增账号缓存 5 项。
  - 同一审查的两项前端问题已修：① 页面打开时该 CLI 的目录读取仍在进行，强制重读被丢弃 → `AccountQueryQueue.whenIdle()` 在该 CLI 空闲后补读；② `$stream` 自行重连（Host 重启）后新一代快照 revision 更低被丢弃 → 每个新 generation 重置 revision 下限。各加测试，临时关掉修复时测试失败，恢复后通过。
  - 账号缓存接线：`accountStatus` 命中 Host 缓存时只有显示字段；前端先显示缓存，再对当前打开的 CLI 或已过期条目调用 `refreshAccountStatus` 恢复登录 / 退出按钮；「刷新状态」直接走新读取；旧 Host 无该方法时退回 `accountStatus`。

## 7. 验收与文档 〔测试｜10h｜前置 3,4,5,6〕
- [ ] 7.1 `pnpm typecheck`、相关 vitest、`pnpm build:preview` 隔离构建
  - Phase A：corepack pnpm typecheck 最终通过；上列 5 个后端关联测试文件 400 项通过。 （未执行：本阶段简报明确禁止 build / build:preview、全量测试。）
  - 阶段 A + 前端整合（2026-11-13）：`corepack pnpm typecheck` 通过（DSH 0.2.2-rc.2）；`corepack pnpm vitest run` 289 文件 6358 项通过、14 项跳过（首轮 8 项失败：`panel.test.tsx` 的组件桩缺新图标、`cleanup-persistence.test.ts` 的账号桩缺 `isBusy`，已补；`native-agy-acp`、`native-bridge-time-limit` 两个计时类测试在满载时偶发超时，单独与第二轮全量均通过）；`corepack pnpm build:preview` 成功。阶段 B/C 后需重跑。
- [ ] 7.2 预览台与设计稿 15 张逐张截图对照，差异修完再截
- [ ] 7.3 macOS 真实更新：npm 全局、Homebrew、CLI 自带命令各一次；人为限速验证停滞续传；核对更新前后版本、路径、事件与退出状态
- [ ] 7.4 安装真实验收：macOS 隔离 HOME 装一个 npm 类 CLI 和一个桌面应用（自选位置）；Windows 装一个桌面应用到非系统盘；不覆盖现有安装
- [ ] 7.5 Windows：npm 全局更新一次、停滞续传一次、预加载空闲判定与低优先级
- [ ] 7.6 README、`doc/design.md` 同步新页面与预加载说明
  - （未执行：Phase A 文件归属仅 Host、指定共享协议与任务证据；README / doc/design.md 的整体验收说明由后续整合阶段统一更新。）
