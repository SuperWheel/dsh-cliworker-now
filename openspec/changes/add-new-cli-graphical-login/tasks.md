# Tasks

初始轮授权仅为知识库文档与 OpenSpec 规划；2026-11-07 后续授权实施设计 §1–§3，并在隔离 HOME 中采集授权前屏幕。未读取用户真实凭据、未提交授权、未执行模型任务或更新 Desktop；§4 WorkBuddy 由另一工作树负责。以下勾选只代表对应产物/检查实际完成，全部规划产物存在不代表功能完成。

## 1. 文档与方案

- [x] 1.1 阅读项目约定、设置规范、接入流程及账号相关源码/协议，交付带路径依据的 `doc/knowledge/cli-integration/graphical-login.md`。
  - 2026-11-07：静态核对 `accounts.ts`、guide 引擎与各 flow、两类窗口、共享合同、CodeBuddy/TRAE/WorkBuddy 账号模块及协议。标明默认 logout 证明较宽、TRAE 状态解析未核对退出码、WorkBuddy 无主体 ID 等现状限制；没有重跑历史真实验证。
- [x] 1.2 在知识库索引增加一行，并在接入流程账号阶段/附录 B 增加指针；以文件差异核对只触及约定段落。
- [x] 1.3 创建本 change 的 proposal/design/spec/tasks，逐 CLI 写明入口、模板、命令、状态来源、回退与 C/T/W 采集清单；核对规格与设计一致。
  - 使用 `PATH="$PWD/.cache/bin:/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now/.claude/worktrees/v088-integration/.cache/bin:$PATH" pnpm spec new change add-new-cli-graphical-login` 创建骨架，CLI 同时生成 `.openspec.yaml`；项目根由 `pnpm spec context --json` / `list --json` 确认为当前工作树。
- [x] 1.4 执行本 change 严格校验与文档链接/差异检查，在本任务下记录输出；只检查本轮文档，不代替源码或 Desktop 验收。
  - 2026-11-07：`PATH="$PWD/.cache/bin:/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now/.claude/worktrees/v088-integration/.cache/bin:$PATH" pnpm spec validate add-new-cli-graphical-login --strict`，退出 0，输出 `Change 'add-new-cli-graphical-login' is valid`。
  - 对本轮 7 个 Markdown 文件进行只读链接/行尾空白检查：93 个本地链接全部存在，无行尾空白；`/Library/Developer/CommandLineTools/usr/bin/git diff --check -- doc/knowledge/cli-integration/README.md doc/knowledge/cli-integration/new-cli-onboarding.md` 退出 0。
  - 没有执行 Vitest、typecheck、preview/build、真实账号/模型调用、真实屏幕采集或 Desktop/Windows 验收；文档格式通过不证明这些行为通过。

## 2. 真实画面采集（需要真实 CLI 会话，不提交授权）

2026-11-07 已按本轮授权执行 CodeBuddy/TRAE macOS 授权前采集，详见 [采集记录](capture-2026-11-07.md)。按指南隔离 HOME/CLI 配置根与 Windows 用户目录，空工作目录、私有输出、无真实凭据继承；不提交授权码、PAT、浏览器授权或模型 prompt。C/T/W 定义见 `design.md`。受首次 trust/条款或登录门槛阻断的画面保持缺失，不能为补齐任务偷偷登录；授权后成功/退出链另列第 6 组。

- [x] 2.1 采集 CodeBuddy C1–C3：首屏、允许到达的输入就绪/`/login` 补全、四站点菜单完整行与高亮重绘；记录版本、平台、argv、200 × 60 尺寸、脱敏画面及阻断点。
  - 首轮止于 C1；同日追加授权后仅接受隔离 HOME 内空项目的文件夹信任，C2 空编辑器、一次 `/login`、C3 完整四站点菜单及箭头局部重绘均已采集。没有条款屏或授权提交。
- [x] 2.2 采集 CodeBuddy C4–C5：中国/国际授权前 URL 主机及等待/回填/设备码形态、企业/iOA 原生回退边界；逐条核对白名单，不提交任何凭据或授权。
  - 后续 C4 取得 `copilot.tencent.com/login`、`www.codebuddy.ai/login` 与 `Waiting for auth...`，无回填框，使用 browser；C5 企业 endpoint 首提示、iOA 带 ioa 参数的浏览器等待均采集并取消。
- [ ] 2.3 采集 CodeBuddy C6–C7：允许取得的未登录 `/logout`、补全/确认菜单、取消/未知屏/关闭；有效账号退出前后无法无提交取得时明确列入 6.2，不能勾成已覆盖。
  - 后续 C6 已到达：空 HOME 中 `/logout` 一次 Enter 返回登录菜单，无二次确认。两个采集进程均退出 0、HOME 删除、pgrep 无残留；C7 Windows 与有效账号退出仍未执行，本组合任务保持未勾。
- [x] 2.4 采集 TRAE T1–T2：个人登录的特性/套餐提示、授权前画面、URL、完整码/回调输入边界和取消；据真实画面选模板，不预填 marker。
  - T1/T2：0.213.1 个人授权链接 `https://www.trae.cn/authorization` 与完整回调 URL 提示已记录；Ctrl-C 退出 1，无授权提交，全部隔离 HOME 已删除。
- [x] 2.5 采集 TRAE T3–T5：SSO 首屏、无 PAT 环境变量的 stdin 提示、未登录 logout/status 输出与退出码；不查看 PAT 值、不输入 PAT，企业授权后画面保留待验收。
  - T3 企业 SSO 链接/回调首屏已采；T4 无 PAT 的 PTY **直接报缺少环境变量/stdin 并退出 1，没有输入提示框**，按实际行为记录；T5 status=`Not logged in`/1，logout=`Not logged in`/0。没有有效账号退出或 PAT 输入证据。
- [ ] 2.6 在 Windows 真实安装中复核 C7/T6 的分帧、中文、CR+CUP、OSC、完整高亮行及清理；明确记录不支持安装或无法取得的画面。
- [ ] 2.7 核对 WorkBuddy W1–W2 的两版应用身份与账号入口/手动打开指引；只观察可安全取得的桌面画面，不采造 CLI marker，无隔离桌面环境时记为阻塞。

## 3. Host flows 与协议（实施时同步关联测试/文档）

- [ ] 3.1 实现 CodeBuddy flow 与注册：完整就绪屏一次 `/login`、当前菜单 choice、已核实授权模板、自动 `/logout` 和未知屏回退；同时补模拟分帧/重绘/不重复写键测试，按 C1–C7 核对 marker 注释与协议记录。
  - 2026-11-07：已注册独立原生回退 flow；C1 仅提示用户自行处理信任，不代确认。C2–C6 缺失，所以未实现自动 /login、自动 /logout 或站点菜单，任务保持未完成。
- [x] 3.2 收紧 CodeBuddy 引导状态证据，区分不存在/退出标记与读取拒绝/非法文件，建立动作前基线；用模拟状态证明 success 文本、mtime、零退出码、读取失败均不能假报退出或换号，认证内容仍只投影 `auth.domain`。
  - 2026-11-07：`readCodebuddyLoginState` 区分 ENOENT、普通退出标记、读取拒绝、ENOTDIR、目录及符号链接；`readCodebuddyAccount` 只复用 auth.domain 投影确认 JSON 可读。PTY 分配前保存基线；同为 authenticated、未知基线、零退出码和状态读取错误均不能证明新登录。
- [x] 3.3 实现 TRAE flow，沿用三种原生 argv，个人模板按 T1–T2 接入、SSO/PAT 固定原生回退；同时测试 provider 拒绝、特性开关仅用于本次个人登录、没有插件 PAT 收集，更新 TRAE 协议指引。
  - 2026-11-07：`traecn-flow.ts` 只对已记录的个人链接/回调提示显示 browserCode；SSO/PAT 固定原生，不提供 secret 表单。原 argv、provider 拒绝和仅本次个人特性开关继续覆盖。
- [x] 3.4 实现 TRAE 状态文本与退出码联合确认及自动 logout；以模拟状态/退出/清理测试覆盖未知、套餐限制、矛盾回执与退出失败不启动新登录。
  - 2026-11-07：完整 `Logged in using Trae`/0 或 `Not logged in`/1 联合解析，矛盾保持 unknown；logout 以原生退出 0 + 状态 unconfigured 确认。增加 manager 自动 logout、状态矛盾、基线查询清理失败阻止 PTY 分配及 Client 清理失败阻断的模拟测试。
- [ ] 3.5 增加 WorkBuddy 桌面管理能力与独立观察会话/Gateway，Host 验证 CliId/父会话/固定动作/安装身份；以模拟打开器测试正确版本、拒绝任意路径/命令、旧 accountStart 仍拒绝 WorkBuddy。
- [ ] 3.6 实现 WorkBuddy 串行观察与周期内元数据复用：15 秒完成后间隔、5 分钟/20 次预算、25 秒单轮外层时限、手动刷新合并、停止清理；用模拟计时/认证错误验证无 prompt、无并发查询、无同站点换号假成功、无桌面端终止；将通用 -32000/403 等拒绝与明确认证缺失分开，无法核实缺失时不报告退出成功。
- [ ] 3.7 在新能力中落实权限、同 CLI 互斥、父会话结束、卸载、迟到分配/查询和清理保护；以 Host/Gateway 模拟测试验证拒绝与取消后无写键/无观察，清理不明不放行。
  - 2026-11-07：CodeBuddy/TRAE 复用现有父会话/权限/互斥/取消路径；新增基线查询清理屏障与退出清理回归已覆盖。WorkBuddy 新观察生命周期不在此工作树，整项暂不勾。
- [x] 3.8 按采集证据更新精确登录主机与 Host 固定文案，补相似域/子域/userinfo/非 HTTPS 的模拟拒绝测试；同步 guide 与协议文档，不能把站点分类通配当作授权白名单。
  - 2026-11-07：CodeBuddy 没有已采授权主机，表置空；TRAE 仅 www.trae.cn。测试拒绝近似域、额外子域、userinfo、HTTP、裸 trae.cn 与企业主机；固定文案经既有 hostText 字典映射，marker 不翻译。

## 4. Client（实施时同步 UI 测试与文档）

- [x] 4.1 提取两列卡片共用呈现，接入 TRAE 单账号方式选择；补模拟 UI 测试验证取消不启动、无无效“其他服务商”、已有多账号添加/替换/逐项退出不回归。
  - 2026-11-07：提取 `ProviderCards`，多账号 AddAccount 与 `LoginMethodPicker` 共用两列 radio 卡片及方向键/Home/End。TRAE 未选不启动、无“其他服务商”、取消不启动、过期/旧 Host 不默认登录；原添加/替换/逐项退出回归覆盖。
- [x] 4.2 接入 CodeBuddy/TRAE 当前账号卡与切换顺序；模拟测试验证查看不启 PTY、确认退出且清理完成才进下一向导，失败保留可重试状态。
  - 2026-11-07：两者已登录只显示灰色账号卡，无 PTY；CodeBuddy 文案明确原生 /logout。TRAE 自动退出成功后仍等待 accountStop 清理，再展示全新未选方式；清理失败显示可重试警示，禁止下一次登录。
- [ ] 4.3 接入 WorkBuddy 桌面管理页，复用 choice/waiting/result 与账号卡；补模拟 UI 测试证明没有假终端/自动退出承诺、状态与刷新按钮同排、打开失败可手动继续、旧 Host 只留指引。
- [ ] 4.4 补 `i18n-messages.ts` 与 `hostText` 的标题/plan/选项/状态/错误映射；验证中文/英文、长文案、480px、淡色提示、灰卡、右对齐操作及原生回退焦点，更新设置规范中相关行为与确实变动的样式参数。
  - 2026-11-07：中文/英文组件渲染及回退焦点有模拟覆盖；两 CLI 作用域内操作右对齐、TRAE 长标题换行，保持 480px、主题 token 与原同排底栏。已同步设置规范；Desktop 明暗/实际窄窗口目视未执行，整项暂不勾。
- [ ] 4.5 同步 README、usage、架构/协议文档及关联活动变更的 WorkBuddy“无入口”与模板“下拉框”旧表述；逐条核对为“桌面管理引导但无 CLI 登录/退出”和实际卡片选择，本轮不提前修改这些文件。
  - 2026-11-07：本工作树同步中英文 README/usage、CodeBuddy/TRAE 协议、架构和图形登录指南；WorkBuddy 及其他活动 change 的对应文案由集成方协调，整项暂不勾。

## 5. 测试与集成自动检查

本组承接第 3/4 组随实施新增的测试，执行跨模块验证；新增 fixture 清楚区分“实采稳定文本摘录”与模拟路径、参数和状态，无真实 nonce、code、token 或账号输出。

- [ ] 5.1 运行受影响的 flow/账号/Client 回归（`tests/account-guide-flows.test.ts`、`accounts.test.ts`、`traecn-accounts.test.ts`、`account-terminal.test.tsx`、`accounts-window.test.tsx` 及新增 WorkBuddy 观察测试）；核对实际用例数与失败，不把模拟状态称作真实登录。
- [ ] 5.2 运行受影响的 WorkBuddy 安装/原生元数据与 Windows 终端关联测试；覆盖 W3/W4 的模拟打开/取消、ConPTY DA/分片、同站点身份缺失，明确平台测试边界。
- [x] 5.3 执行 `pnpm typecheck`、`pnpm build:preview` 与本 change 严格校验；记录命令/结果/隔离产物路径，不执行正式 build 或更新 Desktop 链接。

### 2026-11-07 本工作树自动检查

所有 pnpm 命令均从本工作树运行并加 `PATH="$PWD/.cache/bin:$PATH"`，测试加 `TMPDIR=/tmp`；未执行正式 `pnpm build`、真实模型或 Desktop 更新。私有完整日志在 `.cache/login-capture/`。

- `pnpm typecheck`：最终源码通过，Host/Client 对 DSH 0.2.2-rc.1 类型检查退出 0（`typecheck-final.log`）。
- `pnpm build:preview`：最终源码通过，隔离产物 `.cache/preview-package`（`build-preview-final.log`），没有更新主工作树或 Desktop 链接。
- `pnpm spec validate add-new-cli-graphical-login --strict`：退出 0，`Change 'add-new-cli-graphical-login' is valid`；`git diff --check` 通过。
- 最终关联回归：`pnpm test tests/new-cli-account-flows.test.ts tests/login-method-picker.test.tsx tests/codebuddy-account.test.ts tests/codebuddy-integration.test.ts tests/traecn-accounts.test.ts tests/account-terminal.test.tsx tests/accounts-window.test.tsx tests/accounts.test.ts tests/account-guide-flows.test.ts`，9 文件、450 用例全部通过，19.77s（`related-final.log`）。初轮 8 文件 432/432 通过，随后补 CodeBuddy 注册与基线清理用例；不重复累加为总数。
- 首次完整 `pnpm test`（沙箱内）：18 文件失败、256 通过、4 跳过；348 用例失败、5704 通过、14 跳过（6066 总数），192.12s。明确出现 `listen EPERM: operation not permitted 127.0.0.1` 等限制，不能判成代码全量验收。旧受限进程最终自行结束；请求结束它曾被拒绝，没有强制终止。
- 沙箱外完整 `pnpm test`：3 文件失败、271 通过、4 跳过；4 用例失败、6049 通过、14 跳过（6067 总数），219.89s（`full-test-unsandboxed.log`）。包含运行期间修复的 TRAE 基线清理错误类型，以及未改动文件中的 Antigravity 探测/原生桥时限断言；不宣称全量通过。
- 沙箱外串行 `pnpm test tests/native-agy-acp.test.ts tests/native-bridge-time-limit.test.ts tests/traecn-accounts.test.ts --maxWorkers=1`：3 文件中 1 通过、2 失败；72 用例通过、3 失败，53.55s。TRAE 29/29 通过；仍失败的是 `native-agy-acp.test.ts` 的 account-auto/normal 两个 `--dangerously-skip-permissions` 断言，以及 `native-bridge-time-limit.test.ts` 的审批暂停空闲计时用例（原生引导通路已关闭或尚未准备）。这些文件及相关原生实现均未修改；原因仍待独立核查，不能声称已证明只是机器负载。
- 中英文 React 渲染是组件模拟验收，不是 Desktop 实机视觉证据。没有 Windows、有效账号退出/重登、CodeBuddy C2–C6 或完整企业 SSO/PAT 授权证据；WorkBuddy 跨工作树合并尚未验证。

## 6. Desktop 验收（不以采屏或模拟代替）

- [ ] 6.1 使用隔离 preview 包核对三类窗口在明暗主题、中英文、窄窗口下的步骤/卡片/状态同排/右对齐/焦点/关闭；保留截图或可核查 UI 文本及未验平台。
- [ ] 6.2 在用户指定可测试账号与退出/重登范围的会话中核验 CodeBuddy 中国/国际正常授权、自动退出和切换，补 C6/C7 中授权后缺失的屏幕；检查本地状态转换与进程退出，不读 token，不调用模型。
- [ ] 6.3 在明确范围内核验 TRAE 个人登录/自动退出/切换及企业原生接手；检查 status 输出与退出码、清理和菜单选择。企业账号/套餐不可用时保留未完成，不用个人账号代替企业验收。
- [ ] 6.4 核验 WorkBuddy 两版打开正确应用、外部登录/退出后的自动刷新、同站点换号限制、观察预算与关闭不影响桌面端；记录空会话副作用，不执行模型任务。
- [ ] 6.5 在 Windows 实机完成对应登录、ConPTY、桌面打开与清理验收；国际版/平台/真实账号未执行项逐一保留，不因 macOS 或模拟通过而勾选。

## Workflow follow-up

- 全部必要实现、规格与验收证据核对后才同步主规格并归档；先协调相关活动 change 的条款，保留缺屏、真实账号和平台阻塞。
- 2026-11-07 实施授权允许本分支阶段性本地提交；不 push、stash、reset、切分支或正式构建。WorkBuddy §4 由另一工作树实施，本工作树不勾选其任务。
