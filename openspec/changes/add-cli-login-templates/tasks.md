## 0. 调研与实测

- [x] 0.1 静态源码调研 12 个 CLI 的登录/退出流程（`scratchpad/login-research.md`）。
- [x] 0.2 隔离目录真实 PTY 探测（不碰真实账号，只按回车/方向键，不提交授权码或密钥），回填映射表与 `doc/tasks.md`：Codex、Claude Code、Qoder / Qoder CN、MiMo、ZCode、Grok、OpenCode、Pi、OMP、Hermes。OpenCode 与 Hermes 的单条退出用隔离目录中的模拟凭据实测。
- [x] 0.3 2026-10-27 在隔离目录补测 Kimi（2.1.1 与自动升级后的 2.3.3）设备码登录、`provider remove`、`/logout` 列表；Pi 1.0.4 单服务商退出；OMP 16.4.4 `/login`、`/logout` 非空列表与软删除（模拟凭据）。仍未捕获：Qoder 已登录 TUI 与 `/logout` 画面、Kimi `/logout` 分页（>8 行）、OMP Moonshot / MiniMax 登录画面、Copilot 企业版。

## 1. 实现：引擎、协议与模板（阶段 A）

- [x] 1.1 `src/shared/accounts.ts`：`AccountGuide.template/plan/stage/code/options`、`AccountLogin.id/source/group`、`AccountActionDescriptor.providers`。可单独退出以是否带 `id` 表示，没有另设 `removable`。
- [x] 1.2 `src/host/account-guide/engine.ts`：通用引擎；Antigravity 迁入并保持现有测试通过。
- [x] 1.3 Gateway：`accountRespond`、`accountStartWith`（兼容 `accountStartForProvider/Source`）。
- [x] 1.4 `src/client/account-login/`：登录窗口与模板、「账号」窗口；`account-terminal.tsx` 改为通用；样式、词条。
- [x] 1.5 无法识别画面的后备（D8）。

## 2. 实现：各 CLI 接入

- [x] 2.1 单账号：Codex、Claude Code、Qoder/Qoder CN、MiMo、Grok —— 登录模板、自动退出、切换账号。
- [x] 2.2 ZCode：「登录到」BigModel / Z.AI，账号窗口中两家合为一行一起退出。OpenCode：「登录到」常用服务商（API Key），每个服务商单独退出。
- [x] 2.3 Hermes：「登录到」API Key 服务商，同服务商「添加另一个凭据 / 替换」（先确认新凭据再移除旧凭据），每条凭据单独退出。
- [x] 2.5 2026-10-27 用户反馈修正：OMP 停用行归属统一（修复模型目录读取失败与已失效 xai 显示）；OMP/Pi OAuth 行显示可安全显示的邮箱；MiMo 退出选中 Xiaomi 行；`pick` 静止后转原生；账号窗口改卡片、位置组名改为「<CLI> 原生目录 / 插件目录」并加说明；「登录到」页收紧留白、改为卡片面板 + 右对齐操作。
- [x] 2.4 Kimi、Pi、OMP：「登录到」下拉框（Kimi 按区域、Pi 16 家、OMP 10 项）与逐条退出（Kimi `provider remove` / `/logout` 中的 Kimi Code 行，Pi 单服务商退出，OMP `/logout` 按凭据编号选中）；OMP 同服务商添加/替换；Pi/OMP 账号行按原生目录 / 插件目录分组；授权后不退出的 Pi/OMP 在后台核对最长 15 分钟。

## 3. 自动检查

- [x] 3.1 每个流程定义的合成画面测试（标注模拟）：步骤推进、回应翻译、退出写入范围、确认条件、白名单链接。
- [x] 3.2 窗口组件测试：各模板、下拉框、切换账号、账号窗口逐行退出与确认、替换顺序。
- [x] 3.3 全量测试、类型检查、OpenSpec 严格校验、隔离构建。

## 4. 真实验收（用户本人登录）

- [ ] 4.1 至少每类一个 CLI 真实登录与退出（单账号、多服务商、同服务商多账号），记录原生状态证据。
  - 2026-10-29 核对：单账号类已有真实证据。Antigravity：macOS 经插件窗口真实登录与退出（2026-10-26，钥匙串条目新建/消失，无残留进程），Windows 真实退出（2026-10-27，用户确认条款后完成）。多服务商（OpenCode/Hermes/Pi/OMP/Kimi）与同服务商多账号的真实登录、退出与切换未执行。
  - 2026-10-29 Mac Desktop 实操（Codex Computer Use）经插件账号窗口真实退出：单账号 Antigravity、Grok、Qoder；ZCode（确认文字「BigModel 和 Z.AI 的登录会一起退出。」）；Kimi Code（先确认信任空账号目录，终端显示 `Logged out from Kimi Code.`）；Hermes Nous（原生终端 Remove credential）；同服务商多账号 OMP 两个 OpenAI 登录逐个退出，API Key 保留。Pi、OpenCode 的 API Key 点「退出」后出现「退出后会删除这条凭据，其他账号保留。」，取消后仍在。Codex、Claude 官方与 MiMo 未点退出。重新登录由用户本人完成，尚未验证。异常：ZCode、Hermes 退出后设置摘要仍显示「已配置」；ZCode、Grok 退出完成窗口同时提示「账号终端暂不可用…」；OMP 中途提示「无法安全保存账号续期…」。证据在 `.test-data/mac-desktop-20261029/`（不入 Git）。
- [ ] 4.2 其余 CLI 列出未实测项。

## 5. 文档

- [x] 5.1 `doc/settings-ui-design.md`（模板与账号窗口规则）、`doc/usage-details.md`、`doc/design.md`、README、`doc/tasks.md`。
