# CLI 图形化登录开发指南

本文按 2026-11-07 工作树源码整理。路径均相对仓库根；源码中的既有机制与本文的接入建议分别说明。2026-11-07 后续实施已为 CodeBuddy/TRAE 添加独立 flow、严格状态证明与共享方式卡片；CodeBuddy 已采授权前 C1–C6 并接入信任确认、自动斜杠命令、站点选择和浏览器引导；TRAE 个人采用回调网址模板。证据见[本次采集](../../../openspec/changes/add-new-cli-graphical-login/capture-2026-11-07.md)及[任务清单](../../../openspec/changes/add-new-cli-graphical-login/tasks.md)；WorkBuddy 由另一工作树实施，本页不代表其验收。

## 1、先判定账号由谁管理

| 形态 | 入口与复用方式 | 当前源码证据 |
| --- | --- | --- |
| 单账号原生 CLI | 已登录先显示当前账号卡片；明确点击「切换账号」后退出，再进入向导 | `src/shared/account-links.ts` 的 `SINGLE_ACCOUNT_CLIS`；`src/client/account-terminal.tsx` 的 `holding`、`switchAccount`；`src/client/account-login/login-window.tsx` 的 `CurrentAccount` |
| 多服务商/多凭据 CLI | 「账号」窗口列出真实 `logins`，逐项退出，添加账号时选择服务商；有多个来源时按来源分组 | `MULTI_ACCOUNT_CLIS`；`src/client/account-login/accounts-window.tsx`；`src/shared/accounts.ts` 的 `AccountLogin`、`AccountProvider` |
| 单账号、多登录方式/站点 | 仍为单账号；选择器只是决定本次原生登录路径，不意味着可同时持有多个账号 | `src/host/account-guide/providers.ts` 的 TRAE 表与 `src/host/traecn-accounts.ts` 的 `traecnAccountArguments`；CodeBuddy 参见 `src/host/codebuddy-account.ts` 与 `doc/codebuddy-protocol.md` |
| 桌面端托管账号 | 用户在对应桌面应用登录/退出，插件显示指引和原生状态；图形页需单独的无 PTY 观察分支 | `src/host/accounts.ts` 对 WorkBuddy 返回空 actions 并拒绝 `start`；`src/host/workbuddy-metadata.ts`、`workbuddy-installation.ts`。拟扩展方式见第 8 节 |

分类表不能代替接线检查：当前 `GUIDED_ACCOUNT_CLIS` 包括 Antigravity、Codex、Claude、Qoder 两版、Grok、ZCode、MiMo、CodeBuddy 与 TRAE CN；后两者保持单账号，其中 CodeBuddy 按 C1–C6 实采标记引导，未知画面与企业/iOA 保持原生；有效账号退出/重登仍待验收。ZCode 在多账号集合中按其分组退出语义展示，不能机械要求两集合互斥。多账号 flow 只在指定 provider 或单项 login 时启用；`manage` 保留原生终端。证据：`src/shared/account-links.ts`、`src/host/account-guide/flows.ts`。

## 2、架构与数据流

```text
设置页 / 账号窗口（用户选择）
  ↕ Harness Gateway：accountStart[With] / accountRespond / accountWatch / accountStop
Host 账号管理器 accounts.ts
  ↔ 原生账号状态读取：evidence / readStatus
  ↔ 引导驱动 AccountGuideDriver（FlowGuide 或 AgyAccountGuide）
  ↔ 原生 PTY：argv 启动、输出、键盘、resize、进程清理
  ↓ AccountFrame：guide + 状态；data 为独立的临时终端输出
Client AccountTerminal → LoginWindow（固定模板）/ xterm（原生回退）
```

- `src/host/index.ts` 的 `startAccount` 核对父会话、执行权限、CLI 开关和账号空闲，再调用 `AccountManager`；`accountRespond` 校验结构，`accountWatch` 按所属会话输出帧。Client 不直接访问文件或启动进程。
- `src/host/accounts.ts` 的 `startSession` 解析当前 CLI 可执行入口、准备 argv/环境/目录，调用 `createAccountGuide`，再经 `spawnAccountTerminal` 启动。引导尺寸默认为 `GUIDE_SIZE`（200 列 × 60 行）；普通终端为 80 × 24。隐藏 PTY 保持引导尺寸，显示后由 Client fit/resize。
- `src/host/account-guide/engine.ts` 的 `output` 将原生输出还原为可见画面，flow 只产生固定 `AccountGuide`、写键或状态核对事件；`accounts.ts` 执行这些事件。`src/shared/accounts.ts` 定义模板、回应及临时帧合同。
- `src/client/account-terminal.tsx` 负责创建 xterm、Gateway 生命周期、帧序号、输入串行、原生终端显示/焦点和关闭；`login-window.tsx` 只绘制 Host 给出的模板与固定文案。终端输出不会当 HTML 或模板说明渲染。
- `src/host/account-login.ts` 是账号展示元数据工具（服务商名称、OAuth/API 摘要、去重），**不是**引导调度器；不应把屏幕识别或登录 argv 放进该文件。

## 3、复用入口与模板

### 3.1 接入文件

| 要接的部分 | 文件与职责 |
| --- | --- |
| 原生命令、状态、互斥、清理 | `src/host/accounts.ts`：`actionsFor`、`argumentsFor`、`startSession`、`readStatus`；复杂 CLI 在自己的账号模块实现 |
| 步骤定义 | `src/host/account-guide/single-account.ts`、`multi-account.ts` 或独立 `<cli>-flow.ts`；只在 `flows.ts` 注册已实现路径 |
| 真实例子 | `kimi-flow.ts` 的完整设备码/退出高亮行；`pi-flow.ts` 的认证方式、浏览器码；`omp-flow.ts` 的编辑器就绪、重绘与逐凭据退出；`src/host/agy-account-guide.ts` 的专用首次启动/条款流程 |
| 服务商与来源 | `providers.ts` 的 Host 固定 ID、`isLoginProvider`、`providerStores`；Pi/OMP 还读取 `src/host/native-login-providers.ts` 的安装版目录 |
| 共享合同与链接 | `src/shared/accounts.ts`、`src/shared/account-links.ts`；provider ID、login 句柄、来源标识不可作为任意 URL 或路径传入 |
| 设置与窗口 | `src/client/settings-dialog.tsx`、`account-terminal.tsx`、`account-login/{login-window,accounts-window}.tsx` |
| 兼容与文案 | `src/client/workers.ts` 的可选 RPC、`i18n.ts`、`i18n-messages.ts`、`operation-error.ts` |

`accounts-window.tsx` 的内部 `AddAccount` 与 TRAE 的 `login-method-picker.tsx` 共用 `provider-cards.tsx`。Host 仍提供选项；单账号方式选择不应加入 `MULTI_ACCOUNT_CLIS`。

### 3.2 模板选择

以下模板枚举来自 `src/shared/accounts.ts`，渲染来自 `login-window.tsx`，行为依据各 flow 的 `respond`。

| 模板 | 使用条件 | 回应与限制 |
| --- | --- | --- |
| `starting` / `waiting` | 启动、加载或核对中 | 不虚构百分比或已完成步骤 |
| `trust` | 真实文件夹信任提示 | 用户点击才发送 `{ confirm: 'trust' }`；不能自动信任 |
| `choice` | 当前原生画面显示可核对菜单 | 固定标签与 option ID；只响应当前步骤，不能按猜测位置发方向键 |
| `browser` | 原生提供浏览器授权路径 | 白名单链接的打开/复制与等待；进程不自行结束时用 `watches: 'login'` |
| `browserCode` | 原生确实接受授权码或回调地址 | `{ code }` → `FlowGuide.paste`，需要时延迟 Enter；原生终端手输可用 `typedConfirms` |
| `deviceCode` | 原生明确显示设备码与验证页 | 提取完整码后显示；不能从 URL 或模型名猜码 |
| `secret` | 已核实 CLI 的密码型输入 | `{ secret }` 只送原生 stdin/PTY，Client 提交后清空；不是把密钥拼进 argv 的接口 |
| `terms` | 原生条款需用户同意 | 现有 `TermsAnswer` 的链接和数据分享文案专用于 Antigravity；其他 CLI 不能直接套 Google 条款，须另行核实并扩展合同 |
| `result` | 已确认或明确未确认 | 区分成功与警告，不根据屏幕里的成功字符串变绿 |
| `native` | 未识别或主动交给原生 | 登录自动展开并聚焦终端；退出默认仍隐藏，用户点击「显示原生终端」接手 |

单账号换号在 `AccountTerminal` 收到 `loggedOut` / `notSignedIn` 后调用 `close(true, 'login')`，等待 stop 清理再开始下一次；清理失败保持失败，不直接重新登录。多凭据“替换”是另一条顺序：新凭据确认后才删除指定旧凭据，不能与单账号先退出混用。证据：`src/client/account-terminal.tsx` 的 `close` 与两个后续 effect。

### 3.3 自动退出

原生有 logout 子命令时直接用其 argv；没有时通过 flow 的 `logout.command` 或就绪步骤 `auto` 输入原生 `/logout`。`accounts.ts` 的 `logOut` 先写命令、再 Enter，仅在仍为 authenticated 且 `retryEnter()` 允许时补一次 Enter，避免登录菜单上误触登录。需要逐项定位时复用 `pick`：只在完整高亮目标行上提交，重复行或超过 40 次转原生。示例见 `single-account.ts` 的 Qoder/MiMo 与 `kimi-flow.ts`、`omp-flow.ts`。

“自动退出”指用户已明确发起退出或切换后，受支持流程自动完成；不等于绕过 trust、猜测未知菜单或删除账号文件。WorkBuddy 不具备原生退出接口，属于第 8 节的桌面管理例外。

## 4、安全采集原生画面

现有 flow 注释记录了隔离 HOME、200 × 60、未提交授权的屏幕来源；`multi-account.ts`、`kimi-flow.ts`、`omp-flow.ts` 另有明确使用模拟凭据的历史记录。它们是采集方法的依据，不是新 CLI 已采集的证据。新采集按下面的检查顺序执行，并将版本、平台、argv、尺寸、所见步骤及缺口写进对应 change 的 `tasks.md`。

1. **先静态核对入口。** 查本仓库协议文档、账号模块、安装解析与 argv。只启动已识别的安装版，不探测用户 token、认证文件正文或完整环境。CodeBuddy 只允许既有安全投影的 `auth.domain`，不输出设置 JSON；TRAE 的专用状态命令见 `traecn-accounts.ts`。
2. **准备专用空目录与子进程环境。** 临时采集根/工作目录不在用户项目中；POSIX 私有目录 0700、文件 0600。在子进程 env 中设置隔离 HOME，并核对 CLI 自身目录覆盖变量；Windows 同时核对 `USERPROFILE`、`APPDATA`、`LOCALAPPDATA`。TRAE 要隔离 `TRAE_HOME`，CodeBuddy 认证按 HOME/LOCALAPPDATA 定位，不能只改 `CODEBUDDY_CONFIG_DIR`。不修改宿主 HOME 或用户配置。依据：`codebuddyAuthDirectory`、`traecnEnvironment`、`doc/codebuddy-protocol.md`、`doc/traecn-protocol.md` 与 `AGENTS.md`。
3. **禁止沿用真实授权。** 采集子进程不继承登录令牌或指向用户认证目录的覆盖项，不复制用户凭据，不访问钥匙串。HOME 隔离本身不能保证 CLI 不查系统凭据；无法证明隔离时停在该屏并记缺口。模拟状态只在单独标注的测试中使用，不能伪装成真实授权后的画面。
4. **录屏幕，不提交账号或模型请求。** 从首次启动画面开始，保留分帧 VT 输出与最终可见画面对应关系。菜单导航只限已确认无授权提交的路径；碰到信任、条款、密码/PAT、浏览器确认、设备码授权即停，不代同意、不填值、不发送 prompt。若某后续屏必须经过这些动作才能出现，记为未采集，留到另行授权的验收会话，不能猜 marker。
5. **记录足以重现识别的结构。** 标题、稳定提示、各选项与高亮位置、完整行尾、清屏/重绘、软折行/OSC 链接、bracketed paste、取消和静止行为都要记录；链接只公开域名和脱敏结构，nonce/state、设备码、回调码用模拟值替换。真实原始输出留在私有临时目录，不进入 Git、Worker 事件或报告。
6. **确认退出与证据边界。** 结束自己启动的进程范围并核对退出；不要杀用户桌面端。窗口可取消、PTY 退出与账号成功是三种不同证据。更新任务清单时分别记录；不把“未提交采集”勾成真实登录/退出通过。

采集时只使用安装版已经核实的禁自动更新选项，例如 CodeBuddy 的 `DISABLE_AUTOUPDATER=1`；不要借用别的 CLI 开关。需要浏览器回调/真实授权才能看到的屏幕留作待办。本指南仅规定方法，本轮没有运行上述采集。

## 5、编写能适应重绘的 marker

依据：`src/host/account-guide/engine.ts` 的 `GuideScreen`、`compact`、`FlowGuide.advance/respond/pick/readLinks`。

- 匹配的是经过光标移动、擦行/清屏、换行重建后的**可见画面**，不是所有历史输出拼接。`screen.has` 对大小写与空白归一化；多个 marker 必须同时存在。不要只匹配宽泛的 `login`、旋转进度或随机欢迎语。
- 步骤从后向前检查，且通常不回退索引；更具体的步骤放在通用等待之后。响应切换菜单并需要重新识别时用 `resets: true` 清掉旧屏；否则旧选项与新结果可能同时匹配。
- `auto` 每个 step ID 只执行一次，只用于用户已经选择的动作；菜单的高亮行必须完整。OMP 的增量重绘以凭据编号而非邮箱/位置匹配，Kimi 用完整样式结束和下一行说明确认目标。不要直接复用另一个 CLI 的指针或结束符。
- 设备码必须等完整行/结束边界后提取，分帧前缀不能显示为完整码（参照 `kimi-flow.ts`）。长 URL 使用屏幕软折行与 OSC 的完整目标，不从截断的可见标签拼猜。
- 未知屏静止时 `settled` 才回退；初始只有终端协商/标题且无可见文本时不能抢先转失败。当前普通 flow 静止阈值为 8 秒，动画有额外上限；等待授权独立于静止检测（`AGY_GUIDE_TIMING`）。
- `respond` 拒绝错误步骤、空值、控制字符、超长值；`FlowGuide.paste` 依据 CLI 是否开启 bracketed paste 决定封装。新 flow 不应绕过校验，把任意 option 文本当命令。

链接由 `ACCOUNT_LOGIN_HOSTS` 管理，Host `allowedLink` 与 Client `loginLink` 双重验证 HTTPS、主机及无 userinfo。带前导点的条目才包含子域；`example.com` 不自动允许 `www.example.com`。每个新域必须有原生登录画面依据，企业任意域不能开通配。CodeBuddy 采集止于 trust，当前授权表为空；TRAE 仅有实采 `www.trae.cn`，企业 SSO 留在原生。认证站点分类用的 `product.json` 通配表不是浏览器链接白名单。证据：`src/shared/account-links.ts`、`src/host/codebuddy-account.ts`。

## 6、以账号状态确认结果

| 事件 | 现有作用 | 使用条件 |
| --- | --- | --- |
| `identify` | 静止未知退出屏先读取账号，调用 `identified` 决定是否发退出命令 | 不把欢迎页或登录菜单当作已退出证明 |
| `watch: 'login'` | 授权等待期间每 3 秒读取状态，最长 15 分钟 | 浏览器完成后 CLI 仍运行；步骤仍可接收用户回应 |
| `confirm: 'login' / 'logout'` | 提交或原生退出后进行有界状态确认，默认每 1.5 秒、最多 20 秒 | 成功文案只能触发核对，不能替代核对 |
| `finish` | 结束所属终端与释放资源 | `cleanupConfirmed` 才证明进程范围已回收 |

来源：`accounts.ts` 的 `identifyScreen`、`watchAccount`、`confirmAccount`、`finish`，`engine.ts` 的 `proves`；Antigravity 有 `agy-account-guide.ts` 的专门状态规则。

通用 `proves` 的登录要求 `after.state === 'authenticated'`，并结合起始状态、身份签名或原生退出码；指定 provider/login 时核对目标行。**不要把默认规则当作所有新 CLI 的安全证明**：当前通用单账号 logout 判断仅为非 authenticated，可能包含 unknown/unavailable；新 flow 应覆盖 `proves`，未知、读取失败、清理阻塞均不得证明退出。部分旧 flow 的 `notSignedIn` 屏幕步骤直接结束，也不应复制为新 CLI 的状态确认策略。

需要补充的接入核对：原生启动可能先改变状态，旧 flow 的 `session.before` 在 PTY 分配后读取；CodeBuddy/TRAE 已改为 PTY 分配前保存基线。新流程若依赖“先退出再登录”转换，必须保存可靠基线并验证时序。没有身份字段时不捏造邮箱或“已切换到另一账号”。`readCodebuddyAccount` 区分明确不存在/普通 `.logged-out` 与读取失败/非法文件，并只用已获准的 `auth.domain` 投影确认 JSON 可读；TRAE `readTraecnAccount` 联合完整行与退出码，矛盾保持未知；WorkBuddy 元数据只有站点与安装绑定。不能以终端成功文字、文件 mtime、站点变化或退出码单独证明完整登录。

确认后继续走既有账号/模型刷新、来源失效；不保存凭据副本。`index.ts` 的 `invalidateSettingsDisplay`、`settings-dialog.tsx` 的账号完成刷新、`src/host/cli-account-binding.ts` 是接线依据。

## 7、界面、国际化与平台

- 先读 [设置页统一设计规范](../../settings-ui-design.md)。`src/client/styles.ts` 的 `.cwn-account-dialog` 为 `min(480px,90vw)`，只有展开原生终端才放宽到 720px；复用模板、宿主 Button/Input/StateDot 与主题 token。
- 新登录引导用 `.cwn-login-callout` 淡绿/淡警示色块，不带左色条、键帽或嵌套面板；不要复用仍带左色条的旧 `.cwn-account-guide`。底部状态与按钮同一行（`.cwn-login-foot`），账号卡用 `--dsw-alias-interactive-bg-hover`，服务商卡用现有两列布局。
- 当前账号页、添加账号页的操作行通过 `.cwn-accounts-actions` 右对齐；现有 `.cwn-login-actions` 不统一右对齐，结果页另为居中。按本次用户要求，新窗口操作采用右对齐；CodeBuddy/TRAE 已添加局部右对齐覆盖，其他窗口保持既有规则；修改共享参数仍须同步设置规范并回归旧窗口。
- UI 文案用 `t/useT`；Host 的固定中文由 `operation-error.ts` 的 `hostText` 映射，再由 `i18n-messages.ts` 提供英文。模板标题、plan、选项、失败和桌面指引都要覆盖。不要翻译原生屏幕 marker 或据界面语言修改 argv；CLI 显示名取 `CLI_LABELS`。
- Windows 复用 `src/host/windows-account-terminal.ts` 的 ConPTY 启动、首次 DA 应答、Job 范围与清理，以及 `account-terminal.tsx` 的 Ctrl+V/原生粘贴、输入法和焦点逻辑。不要绕开现有终端封装或附加操作系统沙箱。中文宽字符、分片 UTF-8、CR+CUP 软折行、OSC 链接需覆盖；macOS 采集不能代替 Windows 证据。
- 关闭窗口、父会话结束或插件卸载都需取消轮询/订阅、清理分配迟到的终端；关闭失败不释放冲突锁。依据：`accounts.ts` 的 `watch/closeParent/close/finish`、`index.ts` 的父会话 effect、`account-terminal.tsx` 的 generation/close 生命周期。

## 8、桌面端托管账号模式：WorkBuddy

### 已有能力

`src/host/workbuddy-installation.ts` 返回已核实的 `appRoot/runtime/entry`，通过包名、入口及 `product.json` endpoint 分国内/国际版，不靠应用名判断；`workbuddy-variant.ts` 保存两个 CliId 的站点与路径线索。`workbuddy-metadata.ts` 调用 `probeWorkBuddyMetadata`，成功返回模型/站点和安装来源绑定；`accounts.ts` 把认证错误映射为“请打开桌面端登录后重试”。

`doc/workbuddy-protocol.md` 与 `src/host/native-workbuddy.mjs` 记录元数据探测只做初始化、空会话和模型配置查询，不发 prompt；每次探测仍会留下空的原生会话。它不是廉价的文件状态读取。元数据 Host 不读凭据文件；现有私有引导助手路径属于既有实现，图形引导不得新增读取或暴露密钥。

### 新图形页的接入建议（尚未实现）

1. 使用明确的桌面管理能力，而不是把 WorkBuddy 加入普通 PTY flow。共享 `AccountGuide` 的 `choice/waiting/result` 外观；复用当前账号卡片，但按钮与说明应为“打开桌面端管理账号”，不承诺插件自动退出。
2. Client 仅发送所选 CliId 和固定动作 ID；Host 重新核对安装身份后打开准确的桌面应用，不能接受来自输出的命令/路径、URL scheme 或任意程序。浏览器 `ACCOUNT_LOGIN_HOSTS` 不用于打开本地应用。
3. 在显式打开管理页后做单个在途、有间隔、有总时限的状态观察；同一查询周期共用元数据，避免账号和模型重复建立空会话。用户在桌面端操作，窗口自动刷新并保留手动刷新。默认参数与退出条件见本变更设计，不能直接套每 3 秒的 PTY watch。
4. 缺安装、身份不符、引导失败、普通网络失败与确定未登录分别显示；只有原生状态转换才能报告已登录/已退出。当前 `native-workbuddy.mjs` 将 `session/new` 的 -32000/-32001/401/403 或认证相关文本统一归为 `CLI_OWN_ACCOUNT_REQUIRED`，范围较宽；新观察不能把所有这类错误都当作“用户已退出”，须先核实可区分的认证缺失证据，否则保留“需在桌面端检查登录”。没有稳定主体 ID 时，只报告“当前已登录”，不能报告“换号成功”。
5. 无原生终端就不显示「显示原生终端」；需给 `LoginWindow` 可选的终端回退能力及通用结果说明，不能伪造 terminal id。关闭只停止插件的观察查询/助手，不关闭桌面应用，也不写桌面账号数据。

## 9、测试与逐步核对

| 层次 | 现有参照 | 新接入必须验证 |
| --- | --- | --- |
| flow | `tests/account-guide-flows.test.ts`、`tests/agy-account-guide.test.ts` | 分帧、清屏、重绘、完整高亮行、重复/迟到回应、未知屏、设备码边界、白名单 URL、一次写键 |
| 账号管理 | `tests/accounts.test.ts`、`tests/traecn-accounts.test.ts` | 正确 argv/provider、可靠基线、watch/confirm、读取失败不成功、退出后清理才换号、同 CLI 互斥、取消/迟到分配/清理失败 |
| Client | `tests/account-terminal.test.tsx`、`tests/accounts-window.test.tsx`、`tests/account-login.test.ts` | 当前账号不启动 PTY、卡片选择、回退焦点、输入清空、状态与按钮、旧 Host 缺能力、中英文固定文案 |
| Windows | `tests/windows-account-terminal.test.ts`、`tests/windows-accounts.test.ts` | DA 应答、分片输出、ConPTY 重绘、路径/环境与进程范围回收 |
| 桌面管理 | `tests/workbuddy-installation.test.ts`、`tests/workbuddy-registration.test.ts`、`tests/native-workbuddy.test.ts` | 正确版本应用、未知能力拒绝、不执行 CLI 登录、有限观察、关闭不杀桌面端、同站点换号不伪造成功 |

所有新增 fixture 在文件名或用例名中标明“模拟”；用脱敏画面加虚构 URL/码，状态回执与屏幕输入分别模拟。不要用“屏幕包含 success”一个断言替代状态、退出和清理检查。UI 样式以真实渲染核对，避免只测试 class 字符串。

- [ ] 明确单账号、多账号或桌面托管形态，写出实际 argv、状态来源和不支持项。
- [ ] 在 OpenSpec 中列出新增行为、模块落点、平台与未采集画面，不提前勾实现。
- [ ] 按第 4 节完成允许范围内的隔离采集；每个 marker 都有版本/平台/画面出处，受阻屏保持待办。
- [ ] 逐步骤确定模板、回应、允许自动操作、下一屏重置规则与未知屏回退。
- [ ] 核对登录/退出的状态证明，未知与读取失败不能成功；退出与进程清理分别确认。
- [ ] 完成 Host/Gateway/Client 接线、链接限制、互斥、取消和旧 Host 兼容。
- [ ] 复用卡片/间距/主题与右对齐操作，中英文文案齐全，密码输入不留存。
- [ ] 跑影响范围的模拟回归、必要类型检查和隔离 preview；分别记录真实画面、Desktop、账号与平台证据。
- [ ] 同步 README/设计/协议和相应任务记录后再判断可归档；文档校验不能替代业务验收。

[接入索引](README.md) · [新 CLI 接入流程](new-cli-onboarding.md) · [账号绑定](account-binding.md) · [最小验收](integration-acceptance.md)
