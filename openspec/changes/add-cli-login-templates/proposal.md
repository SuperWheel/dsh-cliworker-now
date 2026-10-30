## Why

Antigravity 改为插件自绘的分步登录窗口后，用户 2026-10-26 实测认可，并提出：

- 其他 CLI 的登录界面也按同样方式适配。
- 同一 CLI 有多个登录来源（服务商）时，窗口顶部加下拉框选择来源。
- 做几个可复用的登录模板，相似的登录场景复用模板。
- 有些 CLI 可以同时登录多个账号，需要重新设计登录和退出逻辑以及两者的界面。

现状：除 Antigravity 外，所有 CLI 的登录、退出都直接显示 80×24 原生终端，只有一行说明，用户要自己读懂原生菜单。ZCode 有单独的 BigModel / Z.AI 按钮。Pi、OMP、Hermes 退出时另有「native / plugin」来源按钮。多账号 CLI 只能「整体退出」，或进原生菜单自己找要删的凭据。

## What Changes

1. **可复用登录模板**：插件绘制的分步窗口，原生终端在后台运行，默认隐藏，可以显示。
   - 模板有：信任文件夹、选项选择、浏览器授权（自动完成）、浏览器授权 + 粘贴授权码、设备码、输入 API Key / PAT、确认中、结果页。
   - Antigravity 迁移到同一套模板，行为不变。
   - 每个 CLI 用一份 Host 端「流程定义」（画面标记 → 模板步骤）接入。识别不了的画面停在「请在原生终端继续」，并自动展开原生终端，不会卡住。
2. **「登录到」下拉框**：有多个服务商的 CLI，在登录窗口顶部选服务商。
   - 列表由 Host 按当前安装版本提供，标出已登录的服务商。
   - Host 按 CLI 的实际能力定位到所选服务商：能用参数就用参数（如 `login <provider>`、`auth login -p`）；不能的，由插件代用户在原生菜单里选中该项。
   - ZCode 的 BigModel / Z.AI 按钮并入下拉框。
3. **多账号登录逻辑**（用户 2026-10-26 确认）：
   - **单账号 CLI**（Codex、Claude Code、Qoder / Qoder CN、MiMo、Grok、Antigravity）已登录时，登录窗口显示当前账号并提供「切换账号」：插件先自动退出，再进入登录向导。旧任务按 `continue-tasks-across-account-changes` 的换号续接处理。
   - **多服务商 CLI**（OpenCode、Pi、Kimi、ZCode）：选已登录的服务商时，先提示会替换现有凭据。
   - **同服务商多账号 CLI**（Hermes 凭据池、OMP）：选已登录的服务商时，让用户选「添加另一个账号」或「替换」。
4. **「账号」窗口**（多账号 CLI）：
   - 列出已登录账号，每行写明服务商、登录方式和可安全显示的邮箱，并带「退出」按钮。点退出先在行内确认，之后由插件自动完成，结果显示在该行。
   - 账号存放位置（原生目录 / 插件目录）作为分组标题，替代原来的来源按钮。
   - ZCode 两家只能一起退出，显示为一行。
   - 底部「添加账号」进入登录向导。
   - 不提供一键全部退出。
5. **单账号 CLI 退出**：在原生支持的范围内自动完成（退出子命令，或 TUI 斜杠命令），显示进度和结果。
6. **成功判定**：登录和退出都以原生账号状态确认，不看终端文字。多服务商时确认的是「目标服务商 / 凭据确实变化」，其他账号已登录不能算作成功。
7. **「账号终端」（manage）** 保持原生终端，不变。
8. **Windows Nous 登录后目录查询修复（2026-10-30）**：Host 代理请求保留 Node fetch 的默认 User-Agent，避免无客户端标识的目录请求被拦截；Nous 返回 HTML 403 时提示网络拦截，不将其当作账号失效。账号来源、续期和模型过滤规则不变。

## Capabilities

### Modified Capabilities

- `cli-connection-health`：
  - 新增「可复用登录模板窗口」「登录来源下拉框」「多账号登录与切换」「账号窗口与逐个退出」。
  - 修改「一致的原生退出入口」：来源按钮改为账号窗口分组。

## Impact

- **共享协议**：
  - `AccountGuide` 新增 `template`、`code`、`options` 和更宽的 `link` 校验。
  - `AccountLogin` 新增 `id`、`source`、`removable`、`group`。
  - `AccountActionDescriptor` 新增 `providers`。
  - 新增 Gateway 方法 `accountRespond`（按步骤提交选择、授权码、密钥或确认）和 `accountStartWith`（服务商、添加或替换、目标账号）。旧 Client 忽略新增字段。
- **Host**：
  - `accounts.ts` 改为驱动通用引导引擎 `account-guide/engine.ts`，每个 CLI 一份 `account-guide/<cli>.ts`。
  - `agy-account-guide.ts` 迁入引擎。
  - 逐个退出需要各 CLI 的对应启动方式（见 design）。
- **Client**：
  - `account-terminal.tsx` 改为通用窗口外壳。
  - 新增 `account-login/` 模板组件。
  - `settings-dialog.tsx` 的多账号 CLI 入口改为「账号」窗口。
  - 新增样式（遵循 `doc/settings-ui-design.md`）和英文词条。
- **文档**：`doc/settings-ui-design.md`、`doc/usage-details.md`、`doc/design.md`、`doc/tasks.md`、README。

## Out of Scope

- 不修改原生账号文件，不直接写凭据存储。所有登录、退出都走原生 CLI 流程，或 CLI 自带 SDK 的原生登录 / 退出接口。
- 插件不替用户挑选任务使用哪个凭据：同服务商多账号由 CLI 自己轮换。
- 不代用户输入密码、授权码或密钥：只把用户在窗口里输入的内容转交原生终端。
- 「账号终端」（manage）与 Windows 专属差异不在本次重新设计，只保证不回退。
