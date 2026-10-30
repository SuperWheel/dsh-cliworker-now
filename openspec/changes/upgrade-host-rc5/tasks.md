## 1. 差异核对

- [x] 1.1 确认 Mac 与 Windows Desktop 均为 0.2.1-rc.5；npm 上 rc.4/rc.5 已发布（rc.5 于 2026-10-29T14:15Z）；官方 tag `dsh-v0.2.1-rc.5` = `b830ec950faba0a46dda564be3e2d854afed94f1`。
- [x] 1.2 rc.3 → rc.5：388 个文件变化，四包中只有 `ui-chat`（推理显示文本、Body Slot `rawText`）与 `ui-conversation`（视图标签提示、更多视图文案）有源码变化，其余为版本号；Host 端引用的 SDK 包只有版本号变化。

## 2. 重建四包

- [x] 2.1 固定 checkout `.cache/dsh-host-source-021rc5`（HEAD = tag = `b830ec95…`，另取 rc.3 tag 供三方合并），`git apply --3way` 应用 rc.3 的 48 文件补丁：全部无冲突。`--export-patch` 导出 rc.5 补丁（SHA256 `83aa7068…f297`，48 文件），与 rc.3 补丁的增删行完全相同，只有上下文与索引行不同。补丁不涉及 rc.5 改动的 `ReasoningRow`、`ui-chat/contract/slots.ts`、`ConversationSession`，官方新行为原样保留。
- [x] 2.2 构建依赖：rc.3 冻结三文件只改 DSH pin（5 个）与 workspace 例外（追加 `|| 0.2.1-rc.5`），以 rc.3 锁文件为起点 `pnpm install --ignore-scripts`（独立 store `.cache/dsh-host-pnpm-store-021rc5`），package.json/workspace 未被改写；新锁 953 个包，第三方无增删、无版本变化，DSH 全部 rc.5。`generate-dependency-links.mjs` 生成 865 行清单（304 个 DSH 包为 rc.5，其余版本不变，无 rc.3 路径残留）；`--prepare-links` 通过；`check-client-types.mjs` 四包类型检查 session/conversation/subagent/chat 均为 0。
  - 未执行：上游四包 Vitest（在 rc.5 checkout 中运行被自动模式以「外部仓库代码」拦下，没有绕过）。
- [x] 2.3 `build-host-extension --target 0.2.1-rc.5` 构建并 `--verify`（222 个文件）；产物 `ui-chat` 含 `<signature>` 处理、`rawText` 与插件的 `externalTurnUsage` 扩展。`vendor-host-extensions --from …021rc5-data` 冻结 `runtime-host/`（4 包、205 个文件，均为 0.2.1-rc.5），无参数复核通过。

## 3. 插件

- [x] 3.1 开发 SDK 39 个 pin 与根 workspace 300 条发布期限例外改为 rc.5，`pnpm install --ignore-scripts` 重生根锁：855 个包，第三方无增删、无版本变化。`build-dependencies.mjs`、`build-host-extension.mjs`、`vendor-host-extensions.mjs` 加入 rc.5；选图测试增加 rc.5，未验证版本拒绝改用 rc.6；runtime-host 来源断言改为 rc.5 commit 与版本。
- [x] 3.2 `pnpm typecheck` 对 DSH 0.2.1-rc.5 通过；关联 `build-dependencies`、`host-runtime-package`、`market-install-peers`、`panel-layering`、`harness-conversation-official`、`harness-conversation`(tsx)、`panel`、`panel-native-composer` 共 8 文件 177 项通过（首次 1 项为预期的旧 rc.3 commit 断言，已改）；全量 `vitest run --maxWorkers=2` 248 个文件通过、4 个跳过，5283 项通过、14 项跳过、0 失败；`pnpm build:preview` 成功，预览包四包均为 0.2.1-rc.5，`ui-chat` 含 `<signature>` 处理，任务选项菜单层级为 100。
- [x] 3.3 文档：README（中英）宿主说明、`doc/native-conversation-host-extension.md`、`host-extensions/dsh-0.2.1-rc.5/README.md`、`doc/design.md` 已更新。

## 4. 安装与界面

- [x] 4.1 Windows rc.5 安装新预览包（用户 2026-10-30「解决完之后再来安装」）。
  - 包 `.test-data/windows-remote/desktop-audit/preview-20261030-192532.tgz`（版本号仍为 0.8.4，SHA256 `a6ba26c5…2ea6`，lib 725 个文件，runtime-host 206 个文件、四包 0.2.1-rc.5），由提交 `2e0ad72` 隔离构建；含 MiMo 缓存刷新与任务选项菜单层级修复。
  - 安装前只读门禁：`activeWorkers=0`、`workerReadErrors=0`、`accountReadyScopes=0`、账号 owner 与原生认证进程 0。经应用菜单正常退出原 Desktop（PID 17664），确认进程数为 0。
  - 原生安装器退出码 0；lib 725/725 个文件 SHA256 与清单一致；runtime-host manifest 摘要一致、四包版本均为 0.2.1-rc.5。
  - 交互桌面正常启动（新 PID 23288，5 个进程），启动后门禁仍为空闲，最近 5 分钟无崩溃日志。Windows Desktop 不写文本日志，插件模块按需加载、启动时也不写存储，因此无法从命令行确认插件已加载；界面未实测。
- [x] 4.2 Mac 界面（2026-10-30，Codex gpt-6.1-sol high 经 Computer Use 只读操作 rc.5 Desktop）：CLI Worker 面板加载，按 CLI 分组列出 Worker，未见错误；打开已完成的 `codex-1`（含「代码块」与 `MAC-TOOL-codex-OK`），展开「任务选项」后菜单完整盖在代码块标题栏右侧及复制、换行图标之上，未见代码块元素穿透菜单；再次点击同一按钮关闭菜单。
  - 限制：对话滚到底后代码块标题栏距面板标题约 300 像素，无法贴住顶部，结论只对应该位置；截图由 Codex 在其会话中查看，未另存文件。
- [ ] 4.4 未覆盖：Windows 界面；推理正文显示（rc.5 `rawText` 与 `<signature>` 去除）未专门核对。
- [x] 4.3 Mac Desktop 链接更新：确认 Host 无子进程、CPU 0.1%、2 分钟内无会话写入后 `pnpm build`（`lib/` 19:30 更新）；正常退出并按验收方法从命令行启动一次，启动输出没有插件、runtime-host 或 slot 错误（退出时有一条 Electron 到 Host 的连接被关闭，属关停顺序）。内置浏览器直连 Host Web 需要令牌，读取令牌被自动模式拦下，未绕过；改为 `--force-renderer-accessibility` 正常启动后交给 Codex Computer Use 核对界面。

## 5. rc.5 上的 CLI 实操验收（用户 2026-10-30：Mac 与 Windows 各跑 Claude、Codex 以外 10 个 CLI 的工具调用与退出登录，Codex gpt-6.1-sol high 驱动）

- [x] 5.1 Mac 工具调用派遣（Codex Computer Use 操作 rc.5 Desktop，工作区 `cliworker-isolation-test` 新会话，主对话 GLM-5.3-Flash · Max · 工作区内修改，未修改）。
  - 9 个通过：Worker 均为已完成，`cat` 核对 `cwn-mac-20261030-<cli>.txt` 内容为 `MAC-TOOL-<cli>-OK`、退出码 0，文件写入时间 19:44–20:02。
    - Antigravity：gemini-3.8-flash / Low。
    - MiMo：xiaomi/mimo-v2.6-flash / Low。
    - ZCode：GLM-5.3-Flash / Low。
    - Grok：grok-4.6 / Low。
    - OMP：glm-5.3-flash / 默认。
    - Pi：zai-coding-cn/glm-5.3-flash / Low。
    - Hermes：stepfun/step-3.7-flash:free / Low。
    - OpenCode：zhipuai-coding-plan/glm-5.3-flash / Low。OpenCode 的 `ls -la` 在本工作区内，选「允许一次」；其余 CLI 无审批卡。
    - Qoder：Qwen3.8-Flash（原生 qfmodel）/ 默认。列表只有 Qwen3.8-Flash 与 DeepSeek-Flash，价格未显示。
  - 时间线都有写、读、列目录三类步骤。Antigravity 本次 write_file 成功，10-29 的拒绝写入没有复现。
  - Kimi 未启动：`Kimi 登录凭据已过期或即将过期，请打开账号终端完成原生续期或重新登录`。按授权不重新登录，文件不存在（`cat` 退出码 1）。
  - 时间线只显示步骤名，未逐步展开成败；CLI 原生退出码不在界面上，以 Worker 状态加磁盘文件为准。证据：`.test-data/mac-desktop-20261030/report.json`、`summary.md`。
  - 异常：Desktop 运行约 34 分钟后（A 节结束时）窗口无法再被 Computer Use 绑定（先是 `-10005 element ID no longer valid`，然后是 `cgWindowNotFound`，再后来绑定超时）。当时主进程持续占用 75–145% CPU（R 状态），Host 下没有 CLI 子进程。`open -a` 无效。确认 Worker 全部结束后，经 AppleScript 正常退出（2 秒内退出），带 `--force-renderer-accessibility` 重开后绑定约 170 ms，9 个 Worker 均显示已完成。根因未确认，疑与长对话中频繁读取整棵无障碍树有关。
- [x] 5.2 Mac 账号检查与退出登录：Desktop 重启后另派 Codex 执行，未派遣、未重新登录，Codex 与 Claude 账号未碰。证据：`.test-data/mac-desktop-20261030/report-bc.json`、`summary-bc.md`。
  - 真实退出成功（结果页「已退出 …」，底部无「账号终端暂不可用」类小字，原生终端未自动展开）：
    - Antigravity、Grok Build、Qoder 国际版：没有单独的确认步骤。
    - Qoder CN：先在首次运行的文件夹信任提示里点「信任并继续」。
    - ZCode：确认文字为「BigModel 和 Z.AI 的登录会一起退出。」。
    - 以上五项现在等用户本人重新登录。
  - API Key 只到确认步骤，点「取消」后账号仍在：Pi、OpenCode、OMP 插件目录 Key，确认文字为「退出后会删除这条凭据，其他账号保留。」。OMP 外部配置显示「在原配置中管理」，未改。
  - MiMo API Key 未点退出：账号窗口里只有可删除的条目才弹确认，不可删除的条目直接调用 `signOut`（`src/client/account-login/accounts-window.tsx`）。MiMo、Antigravity、Grok、Qoder 都走这条路径。
  - [ ] 失败一：Hermes Nous 两次确认退出，都显示「原生终端已关闭，请重试。」和「该账号已不存在，请刷新后重试」。刷新后账号仍列出，复现一致，未退出。
  - [ ] 失败二：Kimi（凭据已过期）确认并信任空账号目录后，提示「无法识别当前步骤，请在原生终端中继续。」。原生菜单「Select a provider to log out」里没有可辨认的条目，按 Esc 取消，未退出。设置页改为显示「Kimi 当前账号剩余额度暂无法确认…」。
  - [ ] 偏差：ZCode 退出后账号列表为空，设置摘要仍是「已配置」，与 10-29 一致，见 `fix-windows-account-login-bridge` 4.3。
- [ ] 5.3 Windows：
  - 已完成：codex-bridge 0.3.0 不经模型直连可用（列窗口约 0.5 秒，绑定约 0.4 秒，截图约 0.9 秒）；Windows DSH 已带 `--force-renderer-accessibility` 重启，测试工作区为 `live-codex`。
  - 阻塞：Codex 子代理路线第一步就报 `sandboxCwd is not a local file URI: file:///Users/…`。中继把 Mac 工作目录原样转给 Windows 的 cua_repl，所以 10 个 CLI 都没有派遣，等待用户选择修复 codex-bridge 还是改由会话直接驱动。证据：`.test-data/windows-desktop-20261030/`。
