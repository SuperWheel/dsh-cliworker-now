## 1. 排查

- [x] 1.1 Windows 只读排查各 CLI 登录界面、网络连通与 Codex 模型目录。
  - 证据（私有）：`.test-data/windows-remote/desktop-audit/zg-*.json`、`zcode-chain-report-20261030.json`、`zcode-fallback-report-20261030.json`、`other-login-audit/summary.json`。
  - 结论：WinINET 代理开启、无代理环境变量、WinHTTP 直连；`auth.x.ai`、`chatgpt.com` 直连超时、经代理可达，DeepSeek 与 BigModel 直连正常。Grok 在打印网址前即连接超时；Codex Host 目录查询 8 秒超时；OMP 首屏约 21 秒，经代理约 12 秒。
  - 未读取或输出任何凭据、授权网址、验证码、邮箱或终端正文。

## 2. 实现

- [x] 2.1 Windows 系统代理继承：`windows-system-proxy.ts`（读取、解析、TTL、例外判断）、`native-process.ts` 注入、`index.ts` 仅在 win32 创建并在释放时复位。
- [x] 2.2 Host HTTPS 查询走系统代理：`host-fetch.mjs`；`account-models.mjs`、`grok-models.ts`、`hermes-nous.ts`、`kimi-oauth-models.ts` 默认改用 `hostFetch`。Pi/OMP 桥子进程在 Windows 上读注入的代理变量；`host-fetch` 登记进 `scripts/build.mjs` 与 `scripts/package-release.mjs` 的辅助文件清单（首次预览构建因缺这一项失败）。
- [x] 2.3 撤回 Codex 模型目录「只读本地缓存」的子任务改法（`git checkout src/host/codex-models.ts tests/codex-models.test.ts`），保留规格要求的远端目录核验。
- [x] 2.4 登录引导改用有界 VT 屏幕，链接与设备码只取当前屏幕完整值；启动结果返回 Host 终端尺寸，客户端隐藏终端按此初始化，尺寸变化同步给引导。
- [x] 2.5 Windows 账号终端：Toolhelp 快照校验父进程；Host 回应 ConPTY 首个设备属性查询并从回放中去掉。
- [x] 2.6 登录流程：Grok（浏览器、回调网址、新版设备码、网络错误）、OMP 18.x、OpenCode（方式菜单、浏览器/设备码、退出来源、XDG 路径）、Hermes（Key 后问名称）、Kimi（整行设备码）、ZCode（绑定未确认文案）。
- [x] 2.7 OpenCode、Hermes Nous 登录域名登记到 `ACCOUNT_LOGIN_HOSTS`（此前客户端会过滤其链接）；Grok 回调输入框改为「回调网址」并补英文文案。

## 3. 自动检查

- [x] 3.1 新增/扩展模拟测试：`windows-system-proxy`（解析、决定、合并、TTL、注入、Host 查询例外与 CONNECT 隧道）、`hermes-api-key-flow`、`zcode-grok-windows-regression`、`opencode-windows-login`、`windows-account-owner`、`windows-account-terminal`、`account-guide-flows`、`omp/pi/kimi-account-window`、`account-terminal`（Grok 回调文案、OpenCode/Hermes 链接）。
  - 2026-10-30：`pnpm typecheck` 通过；全量 `pnpm test` 247 个文件通过、4 个跳过，5277 项通过、14 项跳过。
  - 加入子进程代理读取与构建清单后：关联测试通过；全量两次各有时序失败——一次与其他测试并发跑，10 项（agy、ZCode、时限）超时；一次无并发，仅 `native-primary-runners` 的「antigravity never promotes native failure…」超过 10 秒上限。这些文件单独重跑全部通过；该用例单独耗时约 8.8 秒，接近上限，属既有的时序余量问题，与本变更文件无关，未修改。
- [x] 3.2 Windows 终端启动模拟测量（同一 Windows，模拟 CLI，各 3 次；`.test-data/windows-startup-20261029/`）：启动到首屏中位数 7.58 秒 → 1.50 秒；子进程、owner 与临时目录均清理。
- [x] 3.3 `pnpm build:preview` 隔离构建。
  - 2026-10-30 成功（`.cache/preview-package`）；核对 `lib/host-fetch.mjs`、`lib/types/host/host-fetch.mjs` 存在，主包中 `hostFetch`、`probeAccountModels`、`WindowsSystemProxySource` 各一份，`lib/account-models.mjs` 与 `lib/pi-native-catalog.mjs` 可在 Node 中加载。未执行 `pnpm build`，Desktop 链接未更新。

## 4. 真实验收（待用户）

- [x] 4.0 Windows 安装新预览包（用户 2026-10-30 确认「现在安装」）。
  - 包 `.test-data/windows-remote/desktop-audit/preview-20261030-003734.tgz`（版本号仍为 0.8.4，SHA256 `0531c9c1…7ccc2`，lib 725 个文件，含 `host-fetch.mjs`），由提交 `1eab75f` 的工作区隔离构建。
  - 安装前只读门禁：`activeWorkers=0`、`workerReadErrors=0`、`accountReadyScopes=0`、账号 owner 与原生认证进程 0。经应用菜单正常退出原 Desktop（PID 31748），确认进程数为 0。
  - 原生安装器 `dsh.cmd plugin --profile desktop add --save-exact` 退出码 0；正式插件 lib 725/725 个文件 SHA256 与清单一致，无多余文件。
  - 交互桌面正常启动（新 PID 29808，5 个进程）；启动后门禁同样为空闲，插件存储文件在启动后写入。界面加载与登录未实测。
- [ ] 4.1 在开启系统代理的情况下：Grok、OMP、Pi（添加账号选服务商）、OpenCode（OpenAI 浏览器/设备码/API Key）、Kimi 各完成一次登录，核对窗口步骤与登录后状态；登录由用户本人完成。
- [ ] 4.2 Windows Codex 设置页刷新模型，核对模型与思考强度列出。
- [ ] 4.3 ZCode：新包上重新登录，记录 CLI 退出码与插件凭据目录文件是否变化（不读内容），确认「已配置」根因。
- [ ] 4.4 Windows 打开登录窗口的实际耗时（真实 CLI），对照 3.2 的模拟结果。
- [ ] 4.5 关闭系统代理 15 秒后新开登录窗口，核对 CLI 不再带代理变量。

## 5. 文档

- [x] 5.1 README 常见问题新增 Windows 系统代理说明；`doc/design.md` 新增本次设计记录。
- [x] 5.2 `doc/usage-details.md` 与 `doc/design.md` 补 MiMo 缓存刷新说明。

## 6. MiMo 模型缓存过期（2026-10-30 用户追加）

- [x] 6.1 Windows 只读定位（`.test-data/windows-remote/desktop-audit/mimo-catalog-diagnostic.mjs`，调用已安装插件自身代码，只输出模型 ID、档位、状态）：`debug paths` 与插件推算目录一致；`models --verbose` 只有 `xiaomi/mimo-v2.5`、`v2.5-pro`、`v2.5-pro-ultraspeed`（另有无凭据的 `mimo/mimo-auto`），各有 low/medium/high；账号目录 `supported`，返回 `mimo-v2.6-flash/pro/pro-ultraspeed` 及 ASR/TTS，交集为空。直连与经代理访问模型接口均在 1 秒内返回 401（未带凭据），`hostFetch` 经代理同样正常，与代理无关。
  - Windows 的 `~\.cache\mimocode\models.json` 修改时间 2026-06-19，不含 v2.6；Mac 的同一缓存为 2026-10-05，含 v2.6。Mac 用空的临时缓存目录实测：同版本无缓存时内置列表含 v2.5 与 v2.6；`MIMOCODE_DISABLE_MODELS_FETCH=1` 下显式 `models --refresh` 仍会刷新（约 2 秒），之后只列 v2.6。
  - 排查中为确认 v2.6 出现在哪，曾对两台机器的 `auth.json` 做过字符串计数（只输出次数 0，未输出内容）；之后未再触碰凭据文件。
- [x] 6.2 实现 `discoverMimoModels`：账号目录可读且交集为空时运行一次 `models --refresh`（同一可执行文件 10 分钟内最多一次），清空 MiMo 元数据缓存后重读；仍不一致时报「MiMo 本地模型列表与当前账号可用模型不一致…」。`discoverFirstPartySources` 新增 `unmatched` 结果。
- [x] 6.3 模拟测试 `tests/first-party-models.test.ts`「MiMo stale native model cache」三项：过期刷新一次后列出 v2.6 与原生档位；账号 401 或已有交集时不刷新；刷新失败报告不一致且 10 分钟内不重试。`first-party-models` 与 `first-party-capability-cache` 共 92 项通过；`pnpm typecheck` 通过。
- [x] 6.4 Windows 实测（新包 `preview-20261030-005543.tgz`，SHA256 `c84265e8…cf70`，解压到私有目录 `mimo-fix-20261030`，未改动已安装插件）：首次读取交集为空 → `models --refresh` 退出码 0、约 4.3 秒 → 重读列出 `xiaomi/mimo-v2.6-flash`、`v2.6-pro`、`v2.6-pro-ultraspeed`，强度 default/low/medium/high，总耗时约 17.6 秒；MiMo 缓存更新为 2026-10-30。验证后先移除联接点再删除私有目录，Desktop 插件依赖完好。
  - 这次刷新更新了 Windows 上 MiMo 自己的模型缓存，已安装的旧包此后也能读到 v2.6；新包尚未安装到 Desktop，界面未实测。

## 7. 任务选项菜单被代码块盖住（2026-10-30 用户追加）

- [x] 7.1 定位：子 Agent 对话页右上角「任务选项」菜单 `.cwn-action-menu` 是 `z-index:5`；Harness 原生代码块标题栏（`dsh-client-ui-primitives` 的 `CodeBlock.module.css` `.bannerWrap`）是 `position:sticky; z-index:6`。两者在 `.cwn` 同一层叠上下文里（用户截图只有标题栏压住菜单，正文没有，与此一致），标题栏因此盖在菜单上。插件「回到最新」按钮 `.cwn-jump` 是 8，也比菜单高。
- [x] 7.2 修复：菜单改为 `z-index:100`，与 Harness 就地菜单（`Menu.module.css` `.list`）同层；面板其他浮层（`.cwn-worker-menu`、`.cwn-stat-panel` 经 portal 为 1100）不变。
- [x] 7.3 新增 `tests/panel-layering.test.ts`：合并客户端全部样式，断言菜单层级高于已安装 Harness 的代码块标题栏与「回到最新」按钮；改回旧值 5 时该测试失败（`expected 5 to be greater than 6`）。`pnpm typecheck` 通过；`panel-layering`、`panel`、`panel-native-composer` 共 130 项通过；`pnpm build:preview` 成功，`lib/client.js` 只含新层级。
- [x] 7.4 Windows 预览包 `.test-data/windows-remote/desktop-audit/preview-20261030-185933.tgz`（版本号仍为 0.8.4，SHA256 `fb5ba716…189b1f`，lib 725 个文件，含 MiMo 修复与本条修复），尚未安装。
- [ ] 7.5 界面实测：打开含代码块的子 Agent 对话，展开「任务选项」，确认菜单完整盖住代码块标题栏。Mac Desktop 链接未更新（未执行 `pnpm build`，用户正在使用 Desktop，未重启）。
