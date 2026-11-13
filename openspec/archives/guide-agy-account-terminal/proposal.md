## Why

用户 2026-10-26 在 macOS 实测 Antigravity 账号终端（`agy` 1.4.7）后提出：

- 退出登录要手动在终端输入 `/logout`，希望点击「退出登录」后由插件直接完成退出。
- 登录时需要先在菜单里选 Google OAuth，再到浏览器授权，把页面上的授权码粘贴回终端并按回车；终端里没有足够提示，别人不知道怎么做。粘贴完成后没有明显反馈，也没有提示要按回车；登录成功后终端里也没有明确的成功提示（用户是“乱按了一下回车”才确认成功的）。

本机探测（退出状态，只读，浏览器被替身拦截）：启动 `agy` 显示 `You are currently not signed in.` 与 `Select login method:` 菜单（`1. Google OAuth` / `2. Use a Google Cloud project`）；选择 Google OAuth 后显示 `Your browser should open automatically.`、授权链接，以及 `If you aren't automatically redirected, paste the authorization code below:` 和输入框 `authorization code...`。agy 没有退出登录子命令，只能在主界面输入 `/logout`。

## What Changes

- Antigravity「退出登录」：插件打开原生终端，确认 agy 主界面已就绪（已登录）后，由 Host 一次性写入 `/logout` 与回车；随后以钥匙串/原生账号状态确认已退出，显示「已退出 Antigravity」并自动关闭终端。启动即显示未登录时不输入任何内容，提示无需退出并关闭。未在限定时间内确认退出时停止自动操作，提示查看终端。只对该动作、只写这一条命令，不向任何 CLI 写入其他内容。
- Antigravity「登录」：Host 依据终端输出识别登录步骤，在终端上方显示分步引导：
  1. 选择登录方式：用 ↑/↓ 选「Google OAuth」后按回车；
  2. 在浏览器登录 Google 并授权，复制页面上的授权码，点击终端后粘贴（右键或 ⌘V / Ctrl+V）；
  3. 检测到粘贴后醒目提示「授权码已粘贴，按回车完成登录」；
  4. 按回车后以原生账号状态确认登录，成功时醒目显示「已登录 Antigravity，可以关闭终端」；限定时间内未确认则提示查看终端中的错误后重试。
- 引导文字全部由 Host 固定生成，不转发或渲染 CLI 输出内容；授权码不记录、不回显到引导、不离开终端输入通路。

## Capabilities

### Modified Capabilities

- `cli-connection-health`：新增「Antigravity 账号终端引导与自动退出」。

## Impact

- Host：`src/host/accounts.ts`（会话引导状态、自动退出写入、身份轮询）；新增 `src/host/agy-account-guide.ts`（输出标记识别，纯函数）。
- 共享协议：`AccountFrame` 新增可选 `guide`（旧 Client 忽略）。
- Client：`src/client/account-terminal.tsx` 显示引导横幅；样式按 `doc/settings-ui-design.md`；多语言词条。
- 原约束「账号终端不发送 prompt/斜杠命令」改为：仅 Antigravity 退出动作在确认主界面就绪后发送 `/logout`（用户 2026-10-26 明确要求）。

### 2026-10-26 修订：自制登录窗口

用户首次实测分步提示后反馈：样式难看；完成浏览器授权后提示仍停在第 1 步；没有醒目的“粘贴后回车”提示，也看不出在哪里粘贴。要求插件自己画一个分步登录窗口，后台仍运行原生登录终端。

原因（只读探测确认）：账号终端按弹窗尺寸（约 80×17 可见行）运行 agy，授权码输入提示被挤到 agy 自身滚动区之外，从未输出，引导无法前进。

修订内容：

- Antigravity 登录/退出改为插件绘制的窗口，原生终端默认隐藏，可随时「显示原生终端」作为后备。Host 以 200×60 的大终端运行隐藏的 agy，使全部提示都在屏幕内；终端显示前不按弹窗尺寸缩小。
- 登录窗口三步：①选择登录方式（「使用 Google 账号登录」按钮代用户在原生菜单按回车；如出现文件夹信任询问，由用户点「信任并继续」）；②在浏览器中授权（agy 自动打开浏览器；Host 从原生输出的 OSC 8 超链接取出登录地址，仅接受 `https://accounts.google.com`，提供「重新打开登录页面」「复制登录链接」）；③粘贴授权码并按回车（插件输入框，粘贴后醒目显示「授权码已粘贴，按回车键完成登录」，回车或「完成登录」以括号粘贴写入原生终端并回车）。确认成功后显示「已登录 Antigravity」并自动结束原生终端；未确认时提示并提供「重新开始登录」。
- 退出窗口：显示「正在检查登录状态 / 正在退出」，结果为「已退出」或「当前未登录，无需退出」。主界面就绪不再只依赖猜测的界面文字：画面停止变化（或最长 8 秒）后以原生账号状态判断，已登录才写入 `/logout`。
