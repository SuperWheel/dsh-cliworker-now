# Design

## Context

动机见 [proposal.md](proposal.md)。本次是文档与规划交付，没有实施源码、真实屏幕或 Desktop 验收。当前源码、协议笔记与尚未归档的规格分别看待；显示名称跟随 `src/shared/types.ts` 的 `CLI_LABELS`，本变更不承担并行名称调整。

| 对象 | 已存在 | 缺口 |
| --- | --- | --- |
| 通用窗口 | `FlowGuide` / `AgyAccountGuide`、`LoginWindow`、`AccountTerminal`、`AccountsWindow`；200 × 60 隐藏 PTY、480px 窗口、状态核对与原生回退 | 新 CLI flow 未注册；服务商两列卡片仍在 `accounts-window.tsx` 的内部 `AddAccount` 中 |
| CodeBuddy | `accounts.ts` 的登录指引要求手输 `/login`；`argumentsFor('codebuddy', …)` 返回 `[]`；`startSession` 启动 `[executable]`，仅额外设置 `DISABLE_AUTOUPDATER=1` | 没有引导自动打开 `/login`、识别站点或自动 `/logout`。`doc/codebuddy-protocol.md` §6 明确没有 login/logout 子命令，不能写成 `codebuddy login` / `auth login` |
| TRAE CN | `providers.ts` 已列 personal / enterprise / enterprise-pat；`traecnAccountArguments` 已实现三条登录 argv 与 logout；`readTraecnAccount` 查询 `login status` | 无 flow；单账号 holding 还受 `GUIDED_ACCOUNT_CLIS` 限制，不能仅有 providers 就认为已实现切换向导；企业完整流程尚未核实 |
| WorkBuddy 两版 | `workbuddy-installation.ts` 返回 appRoot/runtime/entry 并核对 product 站点；`workbuddy-metadata.ts` 查询账号相关元数据 | `accounts.ts` 的 actions 为空且 `start` 拒绝账号操作；无 CLI 登录/退出、无打开应用/状态观察会话 |

## Goals / Non-Goals

**Goals:**

- 将 CodeBuddy/TRAE 的原生登录动作接入既有模板与生命周期，完成可确认的单账号换号。
- 为桌面托管账号复用图形呈现，单独管理“打开应用 + 观察状态”的无 PTY 会话。
- 把每个自动按键与真实屏幕、每个成功结果与账号回读绑定；无法核实时提供明确回退。

**Non-Goals:**

- 不创建新 CLI ID、不将站点/方式伪装成多账号；不改模型、任务 ACP、权限档位、安装协议或发布版本。
- 不读取新凭据字段、不实现企业 SSO 浏览器自动化、不在插件收集 TRAE PAT、不自动退出 WorkBuddy；不把隔离采集当作真实登录完成。
- 初次规划不改源码；2026-11-07 续实施授权包含 WorkBuddy 的源码、测试及关联文档。CodeBuddy/TRAE 与共享卡片提取由另一工作树负责；不越过本次文件职责。

## Decisions

### 1、复用窗口并明确协议边界

普通 CLI 沿用 `accounts.ts → createAccountGuide → FlowGuide → AccountFrame → accountWatch → AccountTerminal → LoginWindow`；反向回应仍走 `accountRespond`。CodeBuddy/TRAE 在 flow、argv、状态证据都完成后才加入 `GUIDED_ACCOUNT_CLIS`，两者继续属于 `SINGLE_ACCOUNT_CLIS`，不进入多账号集合。

从 `accounts-window.tsx` 提取卡片选择的公共呈现，使 TRAE 的单账号向导与多账号“添加账号”复用样式、键盘语义和右对齐继续/返回按钮。选项仍由 Host 描述；TRAE 不附加无效的“其他服务商”项，取消选择不启动 CLI。已登录先展示 `CurrentAccount`，切换退出成功后再选择本次方式，避免用户选择方式时已经改变账号。CodeBuddy 不提供未经证实的启动前站点参数选择器，见下一节。

新 flow 使用自己的 `proves`。通用引擎目前 `logout` 的默认条件为 `after.state !== 'authenticated'`，不足以排除 unknown/unavailable；新流程不得复制此宽松条件。普通结果帧可能先于最终清理帧，Client 必须继续等待 `accountStop`/`cleanupConfirmed` 才能开始下一次登录，不改成“出现绿勾即放行”。

UI 复用 `.cwn-login-*` / `.cwn-accounts-*`；按用户要求新流程的操作右对齐。现有普通 `.cwn-login-actions` 及居中结果按钮不是全面右对齐，若实施调整共用样式，连同 `doc/settings-ui-design.md` 同步并检查旧窗口。固定 Host 文案加入 `hostText` 映射与 i18n，两种语言都测；原生 marker 保持采集原文。

### 2、CodeBuddy：单账号 TUI 引导

**入口与命令。** 当前 `accounts.ts` 的三个落点（`instructionFor`、`argumentsFor`、`startSession`，原约 128/193/892 行）只打开无参数 TUI，随后靠用户手输。新建独立 flow（建议 `account-guide/codebuddy-flow.ts`），在确认编辑器就绪后一次性输入 `/login`；若启动已直接显示登录/站点菜单，则不再发 `/login`。参数仍为 `[exe]` 与已核实的禁更新环境；不利用 ACP `authMethods` 臆造非交互登录命令。

**模板与分支。** 计划是 `starting → trust（确有该屏才显示）→ waiting（打开登录）→ choice（原生站点菜单）→ browser → waiting（状态确认）→ result`。只有真实画面要求回填时才加入 `browserCode`，只有真实设备码屏才用 `deviceCode`。首次条款/主题等未知屏先转 `native`；现有 `terms` 含 Google 固定内容，不能直接套用。

站点来源 `authMethods` 的 `internal/external/iOA/selfhosted` 仅证明站点种类，不证明菜单顺序或可发送的按键。`choice` 只在相应原生菜单完整出现后呈现固定中文选项，用户点击才回应当前画面；没有安全高亮定位证据就交原生。中国站与国际站优先引导；企业域/iOA 即使可识别入口，也只引导到其原生流程，不收集企业域、密码或企业 OAuth 配置，不为任意域提供图形打开链接。

**退出。** 用户点击切换后，启动 `[exe]`，使用已采集的就绪 marker 与 `/logout` 路径自动退出。若有确认菜单，仅对真实已核实的退出选项自动回应；`signedOut/menu` 防止重复 Enter 进入登录。不能删除 `Tencent-Cloud.coding-copilot.info` 或手写 `.logged-out`。未知屏停止自动操作并保留终端回退。

**状态确认。** `readCodebuddyAccount` 当前以普通认证文件存在且无 `.logged-out` 为 authenticated，`verification: local`；只读 `auth.domain` 得出安全站点分类，不提供邮箱/稳定主体。其 `readCodebuddyLoginState` 把 EACCES/EPERM 与无账号合为 unauthenticated，实施需为引导提供可区分“明确不存在/退出标记”和“读取失败/非法文件”的证据，后者不成功。基线在原生动作之前保存，切换新登录必须先观察明确退出；TUI 后续新出现的 authenticated 才确认当前已登录。不能用 CLI 持续运行、mtime 变化、退出码零或相同站点摘要证明新身份。

现有 `ACCOUNT_LOGIN_HOSTS.codebuddy` 为 `codebuddy.cn`、`codebuddy.ai`、`copilot.tencent.com`，并非真实屏幕完整核验结果；尤其不自动包含 `www`。采集后只加入实际打印的精确授权主机，站点分类用的企业通配表不能搬进白名单。`_codebuddy.ai/getUserInfo` 带 `accessToken`，继续禁止调用。

**需要的真实画面记录（本轮均未采集）。**

| 编号 | 具体画面/结构 | 用途与未提交边界 |
| --- | --- | --- |
| C1 | 隔离 HOME 启动 `[exe]` 的首屏、首次 trust/条款/主题（若有）、是否自动出现登录菜单 | 决定 starting/trust/native；若需同意或信任才可继续，停并记缺口 |
| C2 | 允许范围内的输入编辑器就绪提示、输入 `/login` 后补全及菜单的完整绘制、默认高亮 | 决定一次写键时机；不能把欢迎动画当就绪。需先越过 C1 授权屏则延后 |
| C3 | 原生站点菜单的标题、四类入口的实际文案/顺序/高亮、方向键后重绘与取消 | 决定 choice 的匹配与定位；ACP 声明不代替屏幕 |
| C4 | 中国/国际授权前的链接提示、实际主机、OSC/折行、等待回调或要求粘贴的文本、设备码行（若存在） | 不提交浏览器授权、code 或任何凭据；不能无提交到达则保持未采集 |
| C5 | 企业域/iOA 的首个自定义输入/SSO 提示、取消和无凭据错误 | 只确定 native 回退边界，不填企业信息、不授权 |
| C6 | 未登录时 `/logout` 的反馈；可安全取得的斜杠补全/确认菜单、退出后重新出现的登录菜单 | 未登录路径可采；已登录退出前后画面必须另有允许的会话，不通过真实退出来完成“未提交采集” |
| C7 | 静止未知屏、终端关闭/中断以及 Windows ConPTY 的 C1–C6 重绘差异 | 记录真实可见分帧；登录成功/失败后屏和有效账号退出链列入 Desktop 另行验收，不虚构 |

### 3、TRAE CN：单账号 + 登录方式卡片

| 方式 | 当前已实现 argv（`traecnAccountArguments`） | 本次图形计划 |
| --- | --- | --- |
| 个人 `personal` | `[exe, '--enable', 'personal_user_login', 'login', '--personal']` | 卡片保留开发中特性说明；`starting → browser → waiting → result` 为候选主路径，实际是设备码/回填则分别用 deviceCode/browserCode；先采屏再定 marker |
| 企业 SSO `enterprise` | `[exe, 'login', '--enterprise']` | 选择卡片后 `native`，由 CLI 与企业浏览器完成；不推测租户域名，不自动填写/授权；Host 仍通过状态确认结果 |
| 企业 PAT `enterprise-pat` | `[exe, 'login', '--with-trae-pat']` | 选择卡片后 `native`；继承原生读取环境变量或 stdin 的行为，插件不查看环境变量值、不显示/保存 PAT，也不新增 `secret` 输入框 |
| 退出 | `[exe, 'logout']` | 隐藏终端自动运行，`waiting → result`；状态确认并清理后才进入登录方式选择 |

PAT 默认留在原生是有意选择：`doc/traecn-protocol.md` 明确令牌由用户在原生终端提供，完整企业流程未核实；通用模板支持 secret 不能证明 TRAE 已被授权改用该输入。后续若需要 PAT 图形输入，应单独确认范围并采集输入/回显/取消行为，本方案不阻塞其他流程。

`readTraecnAccount` 当前调用 `login status` 后只传 output 给解析器。实现需要核对协议记录的组合：完整行 `Logged in using Trae` 且退出 0 才为已登录，`Not logged in` 且退出 1 才为明确未登录；其他组合/错误/清理阻塞不能证明成功。保留 `does not support CLI usage` 套餐原因。返回只证明当前 TRAE 登录，不显示个人/企业身份或具体账号。

个人授权若 CLI 自行退出，走 `guidedExit → confirmAccount`；若采集证明继续运行，增加 `watches: 'login'`。SSO/PAT 在原生回退中完成后也需状态核对，不能只展示终端已关闭。`traecnEnvironment` 继续保留原生 TRAE 配置，登录特性开关不写入配置。

**待采集清单：** T1：隔离 HOME/TRAE_HOME 的个人登录首屏、开发中特性/套餐限制提示；T2：授权前 URL 主机、完整等待/设备码/回调输入提示及取消，三种模板按实际选择；T3：企业 SSO 首屏及进入企业自定义流程的边界；T4：没有 PAT 环境变量时的 stdin 提示/是否回显（不输入 PAT），有环境变量直读的路径仅做模拟覆盖，本轮不查看真实值；T5：未登录 `logout` 与 `login status` 输出/退出码，授权成功/有效账号退出链留到独立验收；T6：Windows 安装身份及 ConPTY 的上述屏幕。以上均须真实 CLI 会话、无授权提交；遇到阻断则记录缺屏，不继续登录。

### 4、WorkBuddy 两版：桌面管理与状态观察

**入口。** 每版设置页增加“在桌面端管理账号”操作；当前已登录复用灰底账号卡，说明“登录、退出或切换请在桌面端完成”。复用 `choice` 显示“打开桌面端”，之后 `waiting` 和状态/刷新操作，最终 `result`。不使用单账号 `switchAccount` 的自动 logout 分支，也不使用 `browser` 假装本地应用是 URL。

**Host 与 Gateway。** 采用与 PTY 会话区分的桌面观察会话，建议在共享 action descriptor 中新增可选 `target: 'desktop'`（现有只含 models），并新增专用的 `accountDesktopStart/Respond/Watch/Stop` RPC；名字在实施时可按项目惯例调整，语义必须独立。Client 仅发送父会话、CliId、Host 返回的会话 ID 与固定动作（打开、刷新、继续观察），不传任意路径/命令。观察帧复用 `AccountGuide` 与 `AccountFrame` 的 seq/status/cleanupConfirmed，不产生 data 或假 PTY id。

Host 分别保存 `{parent, cli, controller, deadline, inFlight, sequence}`，复用 CLI 互斥、父会话关闭与清理保护；不能直接把可空 terminal 塞进旧 `AccountSession` 后忽略其清理假设。旧 `accountStart` 对 WorkBuddy 仍拒绝；新 Client 对旧 Host 只显示原有手动指引，不发未知 RPC。

**打开准确的应用。** `resolveWorkBuddyInstallation` 每次动作前重新核对 `appRoot/runtime/entry/product`，拒绝另一版、缺文件或身份变更。增加受约束的平台打开适配器：macOS 使用 `/usr/bin/open` 的 argv 打开已验证 `appRoot`，不加 `-n` 强制新实例；Windows 使用经过验证的桌面运行入口打开 GUI，不带内置 CLI 参数，不拼接 shell，具体 Windows 启动/激活方式必须在平台验收中确认。不得从屏幕取路径/URL scheme，不借 PATH CodeBuddy 启动。桌面应用独立于账号查询进程范围，关闭引导不终止它。打开失败时显示手动打开提示及重试，不能假装动作已成功。

**观察预算。** 默认打开页读取一次状态；用户点击打开桌面端或继续观察后，完成上一轮后至少间隔 15 秒再查，最多 5 分钟或 20 次自动查询，先到即止。手动刷新与自动查询合并，禁止重叠；超时后手动刷新只做一次，继续观察须显式点击，重新建立预算。保留原生元数据每个 RPC 的 20 秒超时，并沿用账号查询的 25 秒外层总时限及清理确认；不能绕过 `accounts.ts` 后误把每个 RPC 的超时当作整轮总时限。默认观察参数是本方案选择，不是源码已有行为。

选择有限观察而不套用每 3 秒 PTY watch 的原因：`readWorkBuddyMetadata` 经 `probeWorkBuddyMetadata` 建空原生 session，还逐模型查询配置，原生没有删除接口。每周期复用同一次元数据获取账号和模型，避免二次探测；仅在状态变化/用户刷新时触发对应 UI 失效，不循环重建全量目录。

**确认规则。** metadata 成功只表示当前已登录。当前 `native-workbuddy.mjs` 将 `session/new` 的 -32000/-32001/401/403 或认证相关文本都映射到 `CLI_OWN_ACCOUNT_REQUIRED`；这个泛化代码不够证明已退出。新观察先核实可区分的“认证缺失”回执，只对确定缺失显示当前未登录；模糊认证拒绝保留“需在桌面端检查登录”，其他引导/网络/安装失败保持 unavailable。无法取得更精确回执时，退出确认保持未确认，不凭通用错误代码成功。起始明确未登录→成功可显示登录完成；已登录→明确未登录可显示当前已退出并结束本轮观察；用户如要继续登录可再启动观察。起始和结束都已登录时只更新当前状态，不能说换号成功：binding 由安装/配置目录/站点构成，不含主体 ID。即使观察到先退出再登录，也不编造新账号名称。

**Client 的必要扩展。** `LoginWindow` 支持可选的原生终端能力和桌面动作槽，复用步骤/等待/结果组件；无 PTY 时隐藏底栏终端切换，保留状态与打开/刷新按钮同排。当前 result 的“现在可以派遣”由登录 step 固定产生，新桌面页需可传安全结果说明，只报告已确认状态。页内不增加技术协议文案，试验性说明继续来自原有设置。

**实施补充（2026-11-07）。** `workbuddy-desktop.ts` / `workbuddy-desktop-open.ts` 与四个专用 Gateway RPC 已实现；没有核实到新的精确认证缺失回执，因此生产路径对通用认证错误保持 unknown。Windows 只接受从核实应用根解析的 `WorkBuddy.exe` / `WorkBuddy AI.exe`，无 CLI 参数，仍未实机验证。观察预算到期取消在途查询并等待清理，关闭从不终止 GUI。

**待核实画面/实机证据。** W1：两版可核实的应用身份及桌面账号入口（不读取账号内容）；W2：未登录引导、打开失败、手动打开、取消与回到插件；W3：有限观察期间的原生状态错误分类和查询清理；W4：Windows 精确打开正确版本且关闭插件不关闭桌面端。W1/W2 在已有允许的会话中只观察不提交，若没有隔离桌面用户环境不创建或复制真实凭据；W3/W4 先模拟，真实退出/换号需独立 Desktop 验收。WorkBuddy 不采造 CLI 登录 marker。

### 5、存储、权限与隐私

不新增账号文件、凭据缓存或持久化观察会话。CodeBuddy 仅使用既有站点投影；其 JSON 中可能存在其他秘密，不能整文件打印或输出解析错误。TRAE 不读取 PAT；WorkBuddy 不扩展私有引导的凭据访问。原生终端 data 只属于临时传输，不进入 Worker 历史；guide 只包含固定文案、允许链接和原生公开的本次设备码。

普通账号 RPC 继续使用 `index.ts` 的父会话归属、`assertExecution`、`assertCliEnabled`、`assertAccountIdle`。桌面打开/观察采用同样的所有权和互斥边界，关闭无论是否仍具备执行权限都应能清理自己资源；失去权限后停止后续自动动作。模型任务没有本次授权，不发 prompt。

## Risks / Trade-offs

- [原生屏幕尚未采集] → C/T 清单未勾；实现不能用模拟文字决定生产 marker，缺屏路径先原生回退。
- [状态假阳性] → CodeBuddy 区分明确退出与读取拒绝，TRAE 核对状态和退出码，WorkBuddy 区分认证缺失与一般失败；专门增加反例测试。
- [同站点换号无法辨认] → 沿用现有来源重检，窗口只说当前状态；不扩权读取主体或 token。
- [自动退出遇信任/未知菜单] → 用户处理信任或原生接手，不猜按键；“全自动”只覆盖已核实的正常退出链。
- [WorkBuddy 空会话增长] → 单次在途、15 秒完成后间隔、5 分钟/20 次上限与周期内共享；不声称查询无副作用或能删除原生会话。
- [Windows 与国际版缺证据] → 单列平台实机任务，macOS/模拟不替代；应用打开失败提供手动指引。
- [共享 UI 回归] → 提取卡片时覆盖原有多账号添加/替换/逐项退出；状态同排、480px、明暗主题和英文溢出在 preview 中目视核对。

## Migration Plan

1. 本轮完成指南、提案、规格与任务清单并严格校验，保留活动 change，不归档。
2. 后续在允许的真实 CLI 会话完成 C/T 授权前画面采集；按已有可核实步骤实现 Host，再接 Client 与模拟测试。无法到达的授权后屏保留 Desktop 任务。
3. 同步关联文档：`doc/settings-ui-design.md` 与 `doc/workbuddy-protocol.md` 的“无入口”改为“有桌面管理指引，无 CLI 登录/退出”；同步 README、usage、设计和相关协议记录。`add-workbuddy-cli` 仍未归档，其“模型目录与账号状态”需求需协调同样的语义修订，不在本 change 冒充已有主规格做 MODIFIED。
4. `add-cli-login-templates` 的“登录来源下拉框”与当前源码两列卡片不一致；并入主规格前同步为选择卡片，保留“没有原生参数时不在启动阶段代选”的规则。CodeBuddy 的当前屏 `choice` 是用户当场回答，不是后台替用户选服务商；若归档时仍有歧义，补充该区分再同步，不能留下互相冲突的要求。
5. 跑关联回归、typecheck、隔离 preview 与最小平台检查，再在 Desktop 验收明确范围。正式构建更新链接前确认无活动 Worker/账号操作；本轮不构建、不更新 Desktop。
6. 回退以关闭新增引导能力为单位：CodeBuddy/TRAE 恢复原生终端；WorkBuddy 恢复既有静态桌面提示。停止所有新增观察、取消查询并确认清理；没有账号存储迁移，不回滚用户真实账号。

## Open Questions

- 需要实测回答：CodeBuddy 的首次菜单、四站点高亮/重绘、授权输入及 `/logout` 确认屏；TRAE 个人授权究竟为浏览器回调还是设备码；Windows 的原生画面与 WorkBuddy GUI 打开方式。对应 C/T/W 任务，不要求用户猜技术答案。
- 本轮没有必须由用户先决策才能完成文档的事项。后续完整 Desktop 验收需要用户指定可用于测试的站点/账号及允许的退出/重登范围；企业 SSO/PAT 首期已决定保留原生，不等待企业账号即可推进其他实施。
- 若用户日后要求图形 PAT 输入、企业 SSO 全程引导或 WorkBuddy 自动退出，属于另行扩展，不默认为本方案已授权。
