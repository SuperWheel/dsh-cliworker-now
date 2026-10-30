## Context

- **账号终端的现状**：
  - Host 用宿主终端句柄运行原生 CLI（`accounts.ts` 的 `spawnAccountTerminal`）。
  - Client 只接收字节流和 Host 发来的 `AccountFrame`。
  - Antigravity 已有 Host 端引导 `AgyAccountGuide` 与 Client 端 `AgyAccountWizard`：200×60 隐藏 PTY、固定文案、原生状态确认、自动 `/logout`，见 `guide-agy-account-terminal`。
- **调研来源**：`scratchpad/login-research.md` 汇总的静态源码调研，以及隔离目录中的真实 PTY 探测。探测结果写入 `doc/tasks.md`，并回填本文末尾的映射表。
- **用户确认（2026-10-26）**：
  - 多账号 CLI 合并成一个「账号」窗口。
  - 同服务商再登录时让用户选择添加或替换。
  - 单账号 CLI 提供「切换账号」。

## Decisions

### D1 Host 引导引擎 + 每个 CLI 一份流程定义

`src/host/account-guide/engine.ts` 把 `AgyAccountGuide` 的通用部分抽出来：

- 最近 8 KB 输出，去控制序列和空白后匹配。
- 步骤只前进。
- 静止后用原生账号状态判断当前状态。
- 收集 OSC 8 和纯文本链接。
- 判断括号粘贴是否开启。

每个 CLI 的 `account-guide/<cli>.ts` 只声明以下内容：

- `rules`：有序的 `{ step, template, when(screen), extract? }`，从屏幕里提取链接、设备码、菜单项。
- `respond`：把用户在某一步的回应翻译成按键，如选项 → 方向键 / 数字 + 回车；授权码 → 括号粘贴 + 回车；密钥 → 括号粘贴 + 回车。
- `autoLogout`：就绪标记 + 要输入的命令，或无需输入（退出子命令自己完成）。
- `confirm`：确认登录 / 退出的条件，例如目标服务商出现在 / 消失于 `logins`，或凭据数增减。
- `links`：允许打开的登录地址主机名白名单。

引擎只输出 Host 固定文案的 `AccountGuide`，不转发 CLI 文本。菜单项由流程定义里的固定标签映射，不用屏幕原文。

### D2 Client 模板组件

`src/client/account-login/`：

- **外壳** `AccountWindow`：标题、「登录到」下拉框、正文、底栏（状态文字 + 显示原生终端）。
- **步骤列表**：沿用 Antigravity 的 `cwn-agy-*` 样式，改名为 `cwn-login-*`。
- **模板**：

  | 模板 | 内容 |
  |---|---|
  | `trust` | 信任文件夹 |
  | `choice` | 按钮或单选 |
  | `browser` | 打开 / 复制链接 + 等待浏览器完成 |
  | `browserCode` | 链接 + 授权码输入，「按回车完成登录」 |
  | `deviceCode` | 大字显示设备码 + 复制 + 打开链接 + 等待 |
  | `secret` | 密码型输入，提交后清空，不回显 |
  | `waiting` | 等待 |
  | `result` | `success` / `info` / `warning` |

一个 CLI 的登录就是这些模板的有序组合。窗口宽 480px，显示原生终端时放宽，用淡色色块、不加装饰（`doc/settings-ui-design.md`）。

### D3 用户回应走 `accountRespond`，不再由 Client 拼按键

新增 Gateway 方法 `accountRespond(session, id, response)`。`response` 只有四种：

- `{ option }`：当前步骤 `options` 中的 id。
- `{ code }`：授权码。
- `{ secret }`：API Key / PAT。
- `{ confirm: 'trust' | 'decline' }`

Host 校验它属于当前步骤，再由流程定义翻译成按键写入。这样做的好处：

- 按键差异留在 Host，不套用别的 CLI 的协议。
- `code` 和 `secret` 不进入事件、日志和引导帧。
- 引擎能确定「已提交」，不再靠猜粘贴。

原有 `accountWrite` 保留给可见的原生终端。

### D4 「登录到」下拉框与服务商定位

`AccountActionDescriptor.providers?: { id, label, signedIn, multi }[]` 由 Host 按已安装版本给出。各 CLI 的列表来源：

- ZCode：help 能力探测。
- OpenCode：模型目录 + `auth list`。
- Pi / OMP / Hermes / Kimi：固定表，并以真实菜单校验。Kimi 只有 Kimi Code 的两个区域（`--region mainland-cn|global`）；OMP 的 `openai-codex-device` 写入 `openai-codex`（`stores`）。

Client 选择后调用 `accountStartWith(session, cli, action, { provider, mode })`，替代 `accountStartForProvider`（保留兼容）。Host 定位服务商时，优先用 CLI 自身参数（`zcode login <p>`、`opencode auth login -p <id>`、`mimo auth login -p`）。没有参数的，由引擎在原生菜单中选中该项（筛选输入或方向键），这是用户在下拉框中明确选择后的代操作。定位失败时停在原生菜单，提示用户手动选择。

### D5 多账号三分类

| 类别 | CLI | 再登录已登录者 | 退出 |
|---|---|---|---|
| 单账号 | Codex、Claude、Qoder / Qoder CN、MiMo、Grok、Antigravity | 显示当前账号 +「切换账号」（自动退出后进入登录） | 自动退出 |
| 多服务商、每家一个 | OpenCode、Pi、Kimi、ZCode | 提示「会替换 <服务商> 的现有凭据」后继续 | 账号窗口逐个退出 |
| 同服务商多账号 | Hermes、OMP | 选「添加另一个账号」或「替换」 | 账号窗口逐个退出 |

切换账号会先完成退出，并经原生状态确认，然后才启动登录。若退出未确认，就停在结果页，不继续登录。

### D6 账号窗口与逐个退出

- **账号条目**：`AccountLogin` 增加以下字段：
  - `id`：Host 签发的不透明标识。它在本次 Host 运行内由服务商、来源、凭据序号派生，不含凭据内容。
  - `source`
  - `removable`
  - `group`：ZCode 两家共用一行。
- **退出流程**：
  - 行内「退出」会先确认，再调用 `accountStartWith(..., { action: 'logout', login: id })`。
  - Host 把它解析成该 CLI 的单项退出方式（映射表），在隐藏终端中按流程定义自动完成。
  - 确认标准是目标条目从原生状态中消失，或凭据数减少。
- **原生列表选择（`pick`）**：OMP 的 `/logout` 与 Kimi 的 Kimi Code 退出只能在原生列表中选。引擎每次只按一次 ↓，读取高亮行；只有高亮行能核对为目标（OMP 行的 `#<rowid>`、Kimi 的 Kimi Code 行）才按回车，重复行或超过 40 行即转原生终端。Kimi 列表不循环且 Kimi Code 恒为首行，故先按 40 次 ↑ 再核对。
- **列出范围**：Pi/OMP 只列任务实际使用的有效凭据，后加载位置覆盖同一服务商。OMP 的 `deleted by user`（OMP 自身退出）行视为不存在、不覆盖；其他原因停用的行（如续期失败）仍占有服务商，遮蔽较早位置的同名凭据，自身不列出。这一规则（`ownsProvider`）同时用于列表、快照（`credentialOwners`）、`mergeSources` 与共享续期缓存的 `owners`；2026-10-27 曾让停用行不覆盖，导致续期缓存的归属与快照不一致、模型目录读取失败，已统一。
- **画面静止仍未选中**：`pick` 步骤在画面静止（`flowQuietMs`）后仍未找到目标即转原生终端（单行列表按 ↓ 不变化、Kimi 的 ↑ 未生效等）。
- **MiMo**：`mimo auth logout` 没有服务商参数，列出全部凭据（`● Xiaomi (api)`）；按 `pick` 只在 Xiaomi 行回车，`Logout successful` 后核对状态。
- **不支持单项退出的 CLI**：该行显示「在原生终端中退出」，并展开终端。
- **兼容**：来源按钮（`accountStartForSource`）保留兼容，新 Client 不再使用。

### D7 成功判定与超时

登录和退出都以原生账号状态确认，与 Antigravity 相同：每 1.5 秒查询一次，登录最长 60 秒，退出最长 20 秒。多服务商时比较前后快照，只认目标的变化。

- Pi、OMP 授权后不退出：流程步骤带 `watches: 'login'`，Host 在等待授权时每 3 秒核对一次，最长 15 分钟。
- 超时：显示未确认，并给出「重新开始」和「显示原生终端」。
- 屏幕上的成功文字只用来提前开始核对，不作为依据。

### D8 无法识别时的后备

画面静止 8 秒（`flowQuietMs`），且没有命中任何规则、也没有在等待浏览器或设备授权时，窗口显示「请在原生终端继续」，并自动展开终端。此后不再自动写入任何内容，只保留状态核对。`manage` 始终是原生终端。

### D9 输入安全

- `secret` 和 `code` 只经 `accountRespond` 写入 PTY，不进入事件、日志、引导帧或 Client 持久状态。
- 原生终端会回显输入，但仍只存在于隐藏的 xterm 中，与原生行为一致。
- 链接只打开流程定义白名单中的 https 主机。

### D10 Windows Nous 目录查询（2026-10-30）

现场已安装 0.8.4 的 Nous 请求经过 `hostFetch` 和 WinINET 系统代理。原样只读路径中，账号接口为 JSON 200，模型接口为 Cloudflare HTML 403；在同一路径仅补 `User-Agent: node` 后，两接口均为 JSON 200，读出 6 个模型及强度。`https.request` 不像 Node fetch 自动提供 User-Agent，Windows 专用代理分支丢失该默认头是本次根因；`model.default: stealth/missingno` 不参与 Nous 目录查询。

`host-fetch.mjs` 仅在代理分支没有显式 User-Agent 时补 `node`，保留调用方的值（含显式空值）、认证头、取消和拒绝重定向规则；不增加请求、重试、磁盘状态或续期。Nous 的 HTML 403 与明确的 Cloudflare challenge 403 回执使用固定网络拦截提示，不读响应正文、不输出认证材料；JSON 401/403 继续作为权限拒绝。测试使用合成响应和凭据，Windows 新包 Desktop 验收单独保留。

## Per-CLI mapping（实测后回填，未实测项标「待实测」）

见 `tasks.md` 第 0 节与 `doc/tasks.md` 的探测记录。

## Risks

- **原生画面变更**：CLI 升级后画面可能变化，导致无法识别。D8 的后备保证不卡住；每个流程定义带版本说明和合成画面测试。
- **代选菜单**：在原生菜单中代选服务商，可能因列表顺序变化而选错。本次不做代选：只用 CLI 自身的服务商参数（OpenCode `-p`、Hermes `auth add <p>`）定位；没有参数的服务商在原生终端中由用户选择。
- **Kimi ↑ 键丢失**：若 40 次 ↑ 未生效，画面静止后转原生终端；插件不会在其他行按回车。
- **逐个退出能力差异大**：某些 CLI 只能在菜单中删除，按 D6 降级处理。
- **回退办法**：流程定义可按 CLI 关闭，关闭后回到原生终端（现行为）。
