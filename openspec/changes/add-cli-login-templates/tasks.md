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

## 6. 2026-10-29 Mac 实测后的修正

- [x] 6.1 退出流程（13 个 CLI，含按位置交给原生菜单的退出）默认隐藏原生终端：无法识别画面时不再自动展开，提示用户点「显示原生终端」接手；出结果后也不展开。登录流程的后备展开保持不变。
- [x] 6.2 结果页不显示终端状态小字；启动成功后的连接中断不再套用「账号终端暂不可用…」的启动失败提示。Host 账号 watch 修正收尾竞态：消费方停在 `yield` 时追加的关闭帧先发完再结束，窗口不再错过 closed 帧。
- [x] 6.3 Hermes：「登录到」补 Nous，以 `hermes auth add nous --type oauth` 在原生终端完成设备码授权（已在本机 Hermes 源码 `auth_commands.py` 核对该参数）。当前选用其他推理服务商时已保存的 Nous 登录仍计入账号；凭据池尚未初始化的有效 Nous 登录不再因续期预检报错；空服务商声明与 Copilot `gh_cli` 占位不再算作「已配置」；来源异常或续期失败时登录菜单仍列出全部服务商。
  - 子 agent 已核对：以上为源码与模拟复现确认的缺陷，用户实际终端登录命中哪一条需真实登录后确认。选定插件私有 Hermes 目录后不回退读取普通终端默认目录的隔离规则保持不变。
- [x] 6.4 自动检查：账号窗口 `account-terminal`、`accounts`、`account-logout`、`account-guide-flows` 4 个文件 268 项通过、1 项跳过（Windows 专属）；Hermes `hermes-accounts`、`hermes-nous`、`hermes-renewal`、`account-guide-flows`、`hermes-models`、`native-hermes-binding`、`hermes-integration` 7 个文件 148 项通过；`pnpm typecheck` 通过。新增夹具均标注模拟。
  - 2026-10-29 合并四处修复后：全量 `pnpm test` 243 个文件通过、3 个跳过，5212 项通过、13 项跳过；`pnpm typecheck` 通过；`pnpm build:preview` 隔离包构建成功。未执行 `pnpm build`，Desktop 链接未更新。
- [x] 6.6 Hermes Nous（用户 2026-10-29 反馈「无法退出」「登录时菜单下出现终端确认」，要求直接确认并隐藏终端）：
  - 退出：原先 `auth remove nous <条目>` 只删本地凭据，`<目录>/shared/nous_auth.json` 保留，Hermes 下次启动会重新采用（`auth.py` logout_command 注释、`anon_auth.py` `_reconcile_and_provision`）；凭据池不是恰好一条时 Nous 行也没有可退出的标识，只能走原生菜单。改为 Nous 行始终带标识（无池条目时 `hermes:nous:oauth`），退出执行 `hermes logout --provider nous`，同时清除 providers、凭据池与共享登录。
  - 登录：`Import these credentials? [Y/n]` 由插件回答 `y`；无共享登录或导入失败时按 `To continue` / `enter code` 显示设备码与 `portal.nousresearch.com` 链接并后台确认；`Imported` / `Saved nous OAuth … credentials` 进入确认。依据 `auth_commands.py`、`auth_nous.py`、`auth_device_flow.py` 源码。
  - 自动检查：`account-guide-flows`、`hermes-accounts`、`hermes-nous`、`hermes-renewal`、`accounts`、`account-terminal`、`account-logout`、`hermes-models` 8 个文件 382 项通过、1 项跳过；`pnpm typecheck` 通过；已正式构建并重启 Mac Desktop。真实登录与退出待用户核对（见 6.5）。
- [ ] 6.5 真实验收：用户在 Desktop 中重新登录 Hermes Nous，核对菜单出现 Nous、登录后账号窗口显示已登录；任选单账号与多账号 CLI 各退出一次，核对终端保持隐藏、结果页无小字。
  - 2026-10-29 Mac Desktop（证据 `.test-data/mac-desktop-20261029b/`）：
    - Hermes「登录到」列出 Nous（共 15 项，含「其他服务商（在原生终端中选择）」）；未登录，登录后的状态待用户亲自登录后核对。
    - Pi、OpenCode、OMP 的 API Key 条目：先出现「退出后会删除这条凭据，其他账号保留。」，原生终端未展开、无多余小字，取消后账号保留。
    - Antigravity 真实退出一次：终端默认隐藏，结果页「已退出 Antigravity」「需要时可在设置中重新登录。」，底部无小字，设置随后为未登录。
    - 未覆盖：「请点击「显示原生终端」…」提示分支本轮未出现。
    - 发现：设置页单账号 CLI 的「退出」按钮没有确认，点击即真实退出（MiMo API Key 因此被删除）；账号窗口条目上的「退出」有确认。属既有行为，未改。

## 7. 2026-10-30 Mac 实操后的修正（用户「修这两个」）

- [x] 7.1 Hermes Nous 单条退出失败。现象：两次确认退出都显示「原生终端已关闭，请重试。」和「该账号已不存在，请刷新后重试」，账号仍在（证据 `.test-data/mac-desktop-20261030/summary-bc.md`）。
  - 根因：启动退出时先 `reserveHermesAccount` 保留账号目录，再用 `assertLogin` → `readStatus` 复核。对 Nous 账号，`readStatus` 会先调用 `ensureHermesNousFresh`；目录已被保留，续期报 `busy`，状态读取只能返回不带账号行的「不可用」，复核因此必然失败。
  - 修复：Hermes 分支在保留目录后改用 `readHermesAccount` 只读本地原生状态核对目标，不触发续期。
- [x] 7.2 Kimi Code 退出停在「无法识别当前步骤」。现象：原生菜单停在「Select a provider to log out」，引导未选中 Kimi Code 行。
  - 根因：当前模型属于 Kimi Code 时，Kimi 在该行后追加 `CURRENT_MARK`（`← current`），`kimiOAuthRow` 读到的标签是「Kimi Code ← current」，与「Kimi Code」不等。列表本来就停在首行，40 次「↑」不触发重绘，画面静止后转原生终端。
  - 复现：在隔离 HOME / `KIMI_CODE_HOME`、模拟凭据、`KIMI_CODE_NO_AUTO_UPDATE=1`、代理指向不可达端口的条件下，录 Kimi Code 2.4.1 的 `/logout` 列表三份：只有托管登录；当前模型为 Kimi Code；另加 API 服务商。真实安装的大小与修改时间探测前后一致。
  - 回放进插件引导：后两份在修复前停在原生终端；修复后三份在不同分片位置下都只在 Kimi Code 行按一次回车。原始输出只留在会话临时目录，不入库。
  - 修复：识别高亮行时去掉行尾的 `← current`；仍须下一行是完整的「OAuth login」说明才按回车。
- [x] 7.3 自动检查：
  - 新增 `kimi-account-window`「模拟 2.4.1：…← current…」及 `kimiOAuthRow` 断言；新增 `hermes-renewal`「模拟 Nous 单条退出…」，其中目标不存在时仍拒绝。两项在旧代码上均失败，修复后通过。
  - `pnpm typecheck` 通过；`kimi-account-window`、`kimi-accounts`、`hermes-renewal`、`hermes-accounts`、`hermes-nous`、`accounts`、`account-terminal`、`account-logout`、`account-guide-flows` 共 9 个文件，450 项通过、1 项跳过。
- [x] 7.4 Mac Desktop 真实复测（2026-10-30 正式构建 `ef4e3ae` 后重启，Codex gpt-6.1-sol high 经 Computer Use 操作；证据 `.test-data/mac-desktop-20261030/retest-logout.json`、`retest-logout.md`）：
  - Hermes Nous：账号窗口 1 行。确认退出后，结果页「已退出 Hermes」「需要时可在设置中重新登录。」；底部无小字，原生终端未展开，未出现交给原生终端的提示。之后账号窗口「尚未登录 Hermes Agent 的任何账号。」，设置页「未登录」。
  - Kimi Code（凭据已过期）：确认退出，在空账号目录信任提示里点「信任并继续」，结果页「已退出 Kimi」；底部无小字，原生终端未展开。之后账号窗口「尚未登录 Kimi 的任何账号。」，设置页「未登录」，提示「Kimi OAuth 尚未登录或已退出，请打开账号终端登录」。
  - 上一轮的「原生终端已关闭，请重试。」「该账号已不存在…」「无法识别当前步骤…」都未再出现。两项均未重新登录，等用户本人登录。

## 8. 2026-10-30 Hermes Nous 重新登录后未确认、模型不加载（用户反馈）

- [x] 8.1 登录确认失败。现象：账号窗口 Nous 登录后提示「未能确认登录。请重新开始登录，或查看原生终端中的提示。」
  - 根因：登录窗口保留 Hermes 账号目录，挡住 Nous 续期；核对登录时 `readStatus` 先调用 `ensureHermesNousFresh`，报 `busy` 后只能返回不带账号行的「不可用」，新登录因此无法被证明。上一轮退出能确认，是因为退出后已无 Nous 行，不会触发续期。
  - 修复：账号窗口内的核对改用 `readStatus(..., { renew: false })`，只读原生账号存储；窗口外的状态读取仍先续期。
- [x] 8.2 模型和思考强度不加载。现象：设置页模型、强度为空，提示「Hermes Agent 无法确认当前自身账号…」。
  - 根因（只读诊断插件目录与 Hermes 源码）：Hermes 原生 `logout --provider nous` 在配置选用 Nous 时把 `model.provider` 重置为 `auto`，并把 `model.base_url` 改为 OpenRouter（`auth.py` `_reset_config_provider`）；`auth add nous` 只保存登录，不恢复服务商。插件的模型查询与账号绑定都只接受明确的服务商，`auto` 不被猜测。
  - 修复：Nous 登录确认后，插件账号目录的服务商为 `auto` 或未设置时，以 Hermes 原生 `config set model.provider nous` 选定 Nous，再报告登录成功；已明确选择的服务商不变，用户自己的 Hermes 目录不改。Nous 模型列表不再要求已有默认模型（新账号目录登录后没有默认模型）。
  - 原生行为核对：在只含模拟配置、无任何凭据的临时 `HERMES_HOME` 中，经插件原生入口运行该命令，退出码 0，输出「Cleared model.base_url (https://openrouter.ai/api/v1) — that route belonged to auto, not nous」，配置变为 `provider: nous`、保留默认模型、不含 `base_url`。
- [x] 8.3 自动检查：
  - 新增 `hermes-renewal`「模拟 Hermes 退出 Nous 后服务商为 auto：重登 Nous…」及两个服务商已明确时不改动的用例；新增 `hermes-nous`「模拟新账号目录登录 Nous 后…尚无默认模型」。把核对改回先续期后，前三项均失败。
  - `pnpm typecheck` 通过；`hermes-nous`、`hermes-adapter`、`hermes-renewal`、`accounts`、`kimi-account-window`、`cli-account-binding*`、`windows-cli-account-status`、`qoder-accounts` 共 8 个文件，407 项通过。
- [ ] 8.4 Mac Desktop 真实复测：用户本人在账号窗口登录 Nous，确认窗口显示已登录，设置页加载 Nous 模型与思考强度。

