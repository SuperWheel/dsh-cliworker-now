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

- [ ] 4.1 Windows 安装新预览包（需用户确认无活动任务后再装），在开启系统代理的情况下：Grok、OMP、Pi（添加账号选服务商）、OpenCode（OpenAI 浏览器/设备码/API Key）、Kimi 各完成一次登录，核对窗口步骤与登录后状态；登录由用户本人完成。
- [ ] 4.2 Windows Codex 设置页刷新模型，核对模型与思考强度列出。
- [ ] 4.3 ZCode：新包上重新登录，记录 CLI 退出码与插件凭据目录文件是否变化（不读内容），确认「已配置」根因。
- [ ] 4.4 Windows 打开登录窗口的实际耗时（真实 CLI），对照 3.2 的模拟结果。
- [ ] 4.5 关闭系统代理 15 秒后新开登录窗口，核对 CLI 不再带代理变量。

## 5. 文档

- [x] 5.1 README 常见问题新增 Windows 系统代理说明；`doc/design.md` 新增本次设计记录。
