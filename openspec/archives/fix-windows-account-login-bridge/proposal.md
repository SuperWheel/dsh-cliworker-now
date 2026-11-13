## Why

2026-10-29/30 用户在 Windows Desktop（插件包仍为 v0.8.4 之后的旧预览）实测登录窗口，报告：ZCode 登录后仍显示「已配置」、Grok 与 OMP 登录界面无法显示、账号终端启动太慢、Pi 添加账号后服务商无法完成登录、OpenCode 登录异常，以及 Codex 有可用模型却显示「无可用模型」。排查结论（证据在私有 `.test-data/windows-remote/`、`.test-data/windows-startup-20261029/`）：

- **系统代理**：这台 Windows 只在「Internet 选项」里开了本机代理（WinINET `ProxyEnable=1`），没有 `HTTP(S)_PROXY` 环境变量；macOS 则由 launchd 导出这些变量，DSH 与 CLI 自然继承。Windows 上 `auth.x.ai`、`chatgpt.com` 直连超时、经代理可达，因此 Grok 登录在打印任何网址前就报连接超时，Codex 的 Host 端模型目录查询 8 秒超时后显示无模型，OMP 首屏从约 21 秒降到约 12 秒（经代理）。
- **终端解析**：ConPTY 用光标移动重绘屏幕、把长链接折行或放进 OSC 8，原先按「累积文本」匹配的引导会把截断的链接（Pi）、被拆开的设备码（Kimi）当真，也会被重绘残留误导（OMP 新版提示）。
- **终端启动**：ConPTY 启动时先发设备属性查询，客户端接上之前无人回应，PowerShell 引导脚本约 4.3 秒后才开始执行；随后用 `Get-CimInstance` 校验控制台父进程又约 1.3 秒。三次模拟测量（同一 Windows，模拟 CLI）从启动到首屏中位数 7.58 秒。
- **流程文案**：Hermes 新版先问 Key 后问名称，原流程在 Key 后就确认登录；OpenCode 1.19 的 OpenAI 有登录方式菜单，退出时找错凭据来源，Windows 上模型缓存路径也不对；OpenCode 与 Hermes Nous 的登录域名未登记，客户端会把链接过滤掉；Grok 回调步骤要粘贴的是网址，界面却写「授权码」。

## What Changes

- **Windows 系统代理继承**：没有任何代理环境变量时，插件读取「Internet 选项」代理（15 秒内复用读数），给它启动的每个 CLI 与账号终端补 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`（回环地址与可表达的例外始终直连）；Host 自己的 HTTPS 账号/模型查询走同一代理。用户或 CLI 自己已设代理（含显式删除）时一律不动；关掉代理后，之后启动的 CLI 不再带。macOS 行为不变。
- **登录引导读「当前屏幕」**：改为有界 VT 屏幕（处理光标移动、擦除、折行与 OSC 8 链接），链接与设备码只取当前屏幕上完整的值；隐藏的客户端终端按 Host 尺寸初始化，尺寸变化同步给引导。
- **终端启动提速**：控制台父进程改用 Toolhelp 快照校验（仍持有进程句柄防 PID 复用，失败即拒绝）；Host 代为回应 ConPTY 首个设备属性查询并吞掉该查询，避免重放时向 CLI 注入第二个回应。
- **各 CLI 登录流程**：Grok（浏览器/回调网址/新版设备码/网络错误）、OMP 18.x（就绪提示与授权码输入框）、OpenCode（登录方式菜单、浏览器与设备码、退出指向唯一凭据来源、XDG 路径）、Hermes（Key 后问名称）、Kimi（设备码须整行）、ZCode（账号绑定未确认时明确提示重新登录）；OpenCode 与 Hermes Nous 登录域名登记到共享白名单；Grok 回调输入框改为「回调网址」。
- **MiMo 模型缓存过期**（2026-10-30 用户追加：Windows 上 MiMo 模型和思考强度无法识别）：Windows 的 MiMo 0.1.15 模型缓存停在 2026-06-19，只有 v2.5；账号目录只给 v2.6，交集为空。账号目录可读而交集为空时，插件调用一次 MiMo 自带的 `models --refresh` 再读取。
- 撤回子任务对 Codex 模型目录的「只读本地缓存」改法（与 `cli-model-discovery` 要求的远端目录核验冲突），改由 Host 查询走系统代理解决。

## 范围外

- ZCode「已配置」的根因未确认：最可能是 OAuth 结果没有写入插件私有凭据目录、回落到原生 API 配置；本次只把文案改成明确的「账号绑定未确认，请重新登录」，需要用户在新包上复测并记录 CLI 退出码与凭据文件变化（不读取内容）。
- 不读取或修改 WinHTTP、PAC 脚本、SOCKS-only 代理；`<local>` 与 `10.*` 一类中间通配例外无法用 `NO_PROXY` 表达，不转换。
- 不改 Harness 核心与 DSH 自身网络设置。

## Capabilities

### Modified Capabilities

- `platform-runtime`：新增「Windows 系统代理继承」；修改「Hermes 子进程的 IPv6 代理旁路」，把「不新增代理地址」限定在该改写本身。
- `cli-connection-health`：新增「Windows 账号登录窗口的终端解析」「Windows 账号终端启动」「各 CLI 登录步骤与原生提示一致」。
- `cli-model-discovery`：新增「MiMo 本地模型缓存过期时用原生命令刷新」。

## Impact

- Host：`windows-system-proxy.ts`（新）、`host-fetch.mjs`（新）、`native-process.ts`、`index.ts`、`account-models.mjs`、`grok-models.ts`、`hermes-nous.ts`、`kimi-oauth-models.ts`、`account-guide/*`、`accounts.ts`、`windows-account-terminal.ts`、`windows-account-owner.ps1`、`opencode-*.ts`、`harness-opencode-accounts.ts`、`zcode-grok-accounts.ts`。
- Client：`account-terminal.tsx`、`account-login/login-window.tsx`、`i18n-messages.ts`；共享 `account-links.ts`。
- 协议：账号终端启动结果新增可选 `size`；旧客户端忽略。
- 安装与存储：无变化；不新增持久化文件。
