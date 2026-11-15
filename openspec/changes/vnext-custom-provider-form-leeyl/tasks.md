# Tasks

## 1. 协议与 Host 原生写入 〔后端｜6h〕
- [x] 1.1 核实各 CLI（Pi、OMP、OpenCode、Hermes、Kimi、TRAE CN）自定义服务商的原生格式、位置与命令，design.md 记录证据与取舍
  - 2026-11-14：已核对六个 CLI；design.md 逐 CLI 记录安装路径、版本/源码 checkout、行号、隔离 HOME 帮助命令与官方标签源码。Pi 1.5.2、OpenCode 1.19.5、Hermes checkout 3b42157858 提供表单；OMP 18.20.0、Kimi Code 2.6.1、TRAE CN 0.215.0 的完整安全写入契约未核实，明确返回 null。
  - 调研只读源码及隔离 --help/--version；没有读取真实凭据、登录/退出或调用模型。Hermes 隔离 --version 返回依赖环境错误，保留源码证据，不当作运行成功。
- [x] 1.2 `src/shared/custom-provider.ts` 协议与 Host Remote：表单描述、提交、校验
  - src/host/index.ts 注册 customProviderForm / saveCustomProvider；协议 src/shared/custom-provider.ts 无修改。parent/CLI/执行权限/维护租约/清理暂停/账号 reservation 均受保护；token 绑定入口与 revision、父会话、目标，10 分钟失效，父会话和 Host 关闭清理。
  - tests/custom-provider-remotes.test.ts：9 项模拟通过，覆盖来源切换、互斥、禁用、规划、取消、父会话关闭、缓存失效与磁盘缓存失败，无真实账号/网络。
- [x] 1.3 各已核实 CLI 的原子写入、凭据保护与缓存作废，模拟测试覆盖成功、冲突、校验失败、写入失败回滚
  - src/host/custom-provider.ts 与 custom-provider-files.ts 实现各自字段、原生配置/凭据分离、输入/冲突校验、原格式增量编辑、临时文件 + fsync + rename、第二文件失败回滚、回滚失败保留私有备份。成功走统一缓存失效；不启动子进程、不改代理环境。
  - tests/custom-provider.test.ts：41 项模拟通过，三个支持 CLI 均覆盖成功、冲突、必填/URL/API/模型校验、暂存失败、第二次 rename 失败、取消及新文件回滚；补充 JSONC、外部编辑、原生账号锁、符号链接、凭据/名称冲突和密钥不回显、不记录日志。
  - 最终关联命令：pnpm_config_verify_deps_before_run=false corepack pnpm test --configLoader runner --no-cache --reporter=json --outputFile=.cache/custom-provider-tests.json tests/custom-provider.test.ts tests/custom-provider-remotes.test.ts tests/accounts.test.ts tests/settings-connection-cache.test.ts tests/cli-management-remotes.test.ts tests/settings-catalog-cache.test.ts；6 文件、227 项通过、0 失败（新增 50 项；accounts 141、cli-management-remotes 9、settings-connection-cache 10、settings-catalog-cache 17）。

- [x] 1.4 实机发现：读表单与账号窗口的状态刷新冲突，导致「其他服务商」始终退回原生终端
  - 2026-11-14 Mac Desktop（构建 7642cd9）：Pi「添加账号 → 其他服务商」两次均提示「无法读取图形化配置：此 CLI 的账号状态仍在读取」。原因是 `customProviderForm` 也占用账号 reservation，而添加账号打开时会同时刷新账号状态。
  - 修改：读表单不再占 reservation（仍做维护锁、启用检查与父会话追踪）；保存前用新增的 `AccountManager.settleQueries` 等待进行中的状态读取（最长 30 秒，可取消），再占 reservation 写入。
  - `tests/custom-provider-remotes.test.ts` 互斥用例改为新语义（读表单不受 reservation/查询影响；保存在查询结束前等待、结束后写入；reservation 被终端占用时保存拒绝）；`corepack pnpm vitest run tests/custom-provider-remotes.test.ts tests/custom-provider.test.ts tests/accounts.test.ts` 192 passed，typecheck 通过。
## 2. 通用表单模板与账号窗口接入 〔前端｜5h｜前置 1〕
- [x] 2.1 通用服务商表单模板（Host 描述驱动），样式与登录窗口一致，doc/settings-ui-design.md 补规则
  - 新增 `src/client/account-login/provider-form.tsx`（`ProviderForm` / `ProviderFormSpec` / `validProviderForm`）：text、url、secret、select、list 五种字段，必填「*」、placeholder、help 悬浮提示、逐字段与整表错误、保存中、成功结果页；secret 只存组件状态，返回、关闭或保存成功即清空。
  - 复用：`.cwn-accounts-window` / `.cwn-accounts-lead` / `.cwn-accounts-actions`、`.cwn-login-callout`、登录窗口 `Result`（改为导出）、设置页 `NativeChoice`、原生 Input（`.cwn-control-input` 36px）、Button md/sm 规范；`src/client/styles.ts` 只新增 `.cwn-provider-*` 字段排版与 `.cwn-login-callout[data-tone=error]`。
  - `doc/settings-ui-design.md` 新增「服务商表单模板」节，并把 `provider-form.tsx` 列入登录窗口按钮规范。
  - 同类菜单复用评估：`login-window.tsx` 的 `AnswerForm`（PTY secret 步骤）语义不同（回答原生终端、粘贴确认提示、无 Host issues），本次不替换，只在报告中列为后续候选；Hermes 多凭据为单选面板、WorkBuddy 为桌面引导，均非表单。
- [x] 2.2 「其他服务商」接入表单，保留原生终端备选；不支持的 CLI 保持原行为
  - `accounts-window.tsx` 的 `AddAccount` 打开时预取一次 `customProviderForm`；返回表单才把卡片改为「在本窗口中填写配置」，预取中与 null / 旧 Host / 读取失败（显示原因）保持原生终端；表单为同窗口下一步，「返回」回到卡片，`nativeFallback` 时左侧 outline「在原生终端中配置」走原 `onStart({ action: 'login' })`。
  - 提交调用 `saveCustomProvider(parentSessionId, cli, form.token, JSON.stringify(values))`；`ok:false` 字段级就近 + 顶部色块，`ok:true` 显示结果页并触发 `onProviderSaved`：`settings-dialog.tsx` 走既有 `onRefreshAccount(true)`（`refreshAccountStatus`，有快照时同时 `refreshCatalogForCli`），无快照时另强制下一次目录读取走 `refreshCatalogForCli`。
  - `src/client/workers.ts` 两个 Remote 声明为可选；新增中英文词条（`i18n-messages.ts` custom-provider-form 段）。未改 `src/host/**`、`src/shared/**`。
- [x] 2.3 前端模拟测试与 build:preview
  - 新增 `tests/provider-form.test.tsx`（12 项，全部模拟）：五种字段渲染、必填与 Host issues、保存中状态与提交值、关闭时中止、旧 Host / null / 读取失败回退终端、预取中继续、secret 不进 storage / console 且返回后清空、无备选、成功刷新与回到列表、Host 拒绝保持表单。`tests/settings-dialog.test.tsx` 新增 1 项：保存成功后 `refreshAccountStatus` 与 `refreshCatalogForCli` 均再次读取 Pi（去掉强制目录刷新后该项失败，已验证断言有效）；`tests/accounts-window.test.tsx` 原 6 项不改通过。
  - `corepack pnpm typecheck` 通过（worktree 缺 `lib/typert.remote-client.d.ts`，从 build:preview 产物复制到被忽略的 `lib/` 后执行）；`corepack pnpm exec vitest run` 9 个关联文件 531/531 通过；`corepack pnpm build:preview` 通过；`corepack pnpm spec validate vnext-custom-provider-form-leeyl --strict` 通过。
  - 全量 vitest（参考）：7108 通过 / 4 失败 / 14 跳过。`build-dependencies.test.ts` 2 项因 worktree 无完整 `lib/types/host/index.js` 构建产物失败（与本改动无关）；`native-agy-acp`、`native-bridge-time-limit` 各 1 项仅在全量并发下失败，单独运行通过。
  - 截图为模拟页面（真实 primitives 源码 + 插件 CSS + Harness 主题 token，Host 应答为夹具）：卡片页、表单页、校验错误态，存于会话 scratchpad，不入库。
  - 未执行：真实 Host（另一 worktree 并行实现）联调、Desktop 明暗主题与 480px 实机目视、英文界面目视、Windows。

## 3. 验收 〔测试｜2h｜前置 2〕
- [x] 3.1 typecheck、关联测试、全量 vitest、严格校验
  - 本次 Host 范围：pnpm_config_verify_deps_before_run=false corepack pnpm typecheck 通过（Host/Client，DSH 0.2.2-rc.3）；同环境 corepack pnpm build:preview 通过，产物 .cache/preview-package；同环境 corepack pnpm spec validate vnext-custom-provider-form-leeyl --strict 通过。git diff --check 通过。
  - 新 worktree 初次 typecheck 因缺少生成 Remote 声明失败；隔离 build:preview 后只把生成 lib 复制到此 worktree 的忽略目录，再运行 typecheck 通过。软链依赖触发 pnpm 的自动重装保护，因此按命令禁用依赖重检；Vitest 默认加载器写软链 node_modules 被拒绝，改用 runner 和 --no-cache，未改主仓库依赖。
  - 历史范围说明：早先 Host 最小验收不含全量 vitest，前端由另一 agent 实施；本次按用户授权补齐全量验收，结果如下。
  - 2026-11-15 全量稳定性修复（本隔离 worktree，基线 `6be8c75`）：使用参数数组执行；保留代理环境，Vitest 子进程统一设置 `KIMI_CODE_NO_AUTO_UPDATE=1`。沙箱外 `/bin/ps` 与 loopback 可用。依赖命令 `corepack pnpm install --frozen-lockfile --prefer-offline` 成功；`corepack pnpm build:preview` 后只将 `.cache/preview-package/lib/` 的生成产物复制到本 worktree 被忽略的 `lib/`，消除新工作树生成入口缺失；未修改 build-dependencies 测试或正式构建链路。
  - 当前基线首次完整 `corepack pnpm vitest run`：339 文件中 331 通过、4 失败、4 跳过；7761 项中 7743 通过、4 失败、14 跳过，113.51 秒。失败为 extended-integration 的错误类型夹具、两个 AGY Windows 环境旧断言、native-bridge 审批暂停时序。诊断过程另复现 AGY 探测竞态、Hermes 缓存扫描超时与一次高负载 WorkBuddy 波动；中间全量分别为 7742 通过/5 失败/14 跳过（241.40 秒）和 7746 通过/1 失败/14 跳过（217.13 秒），未将这些轮次算作通过。
  - 根因与修复：`native-bridge-time-limit.test.ts` 的 400/600ms 实时时限会早于模拟子进程写 PID、就绪或审批控制完成；新增 `tests/fixtures/clocked-native-bridge.mjs`，在真实管道就绪、idle 重置和控制确认事件之后推进模拟时钟，精确检查 400/1500/1600ms、审批暂停及实际子进程退出，并在异常时清理进程。`native-agy-acp.test.ts` 的 250ms 沙箱观察窗口同样与 OS 启动竞争；只冻结模拟探测时钟，等真实 init/警告/静默就绪后推进，保留未知状态保守降级与真实协议解析。
  - Pi/OMP：`pi-omp-adapter.test.ts` 的取消夹具原先先发布就绪、后注册 SIGTERM 处理器，并以短轮询等待文件；改为先注册处理器、监听文件事件后启动查询，就绪后再取消并验证退出/STOPPED。历史报告的其余 Pi 超时/退出码未逐项独立复现，不臆断同一根因；Pi/OMP 与 AGY 单文件串行复跑 176/176 通过，后续完整两轮覆盖全部用例。`cli-management-acceptance-fixes.test.ts` 在 6be8c75 已将旧的 Pi 1.5.2 拒绝断言改为 1.6.0；本次补充按 vnext-pi-1-5-adapt-leeyl 的 1.5.2 身份与路径解析成功断言，同时保留 1.6.0 拒绝。
  - 其他修复：`agy-background-environment.test.ts`、`authorized-catalog-windows-agy.test.ts` 精确验证新增的独立 TMP/TEMP、更新抑制变量作用域及退出后清理；`extended-integration.test.ts` 用实际 `ProcessCleanupUnconfirmedError` 模拟未确认退出而非通用 Error；`cli-management-hermes-residue.test.ts` 将 npm/pnpm 缓存观察根隔离到夹具（原先误扫描宿主缓存导致 15s 超时），保留合成缓存文件并断言不被删除。没有改生产代码、测试超时、默认并发或增加跳过。
  - 临时目录泄漏定位：模拟 Windows 未确认退出用例应保留目录，但测试未收尾。`authorized-catalog-windows-agy.test.ts` 复现新增 1 个；`windows-cli-resolution.test.ts` 复现新增 4 个；PID/测试文件映射定位 `cli-management-local-artifacts-windows.test.ts` 再新增 1 个，共 6 个。现在三文件只登记自己 spawn 的 TEMP，先断言未确认仍保留及 owner 标记，再由 afterEach 删除自身夹具；生产 keep-on-unconfirmed 规则不变。既有残留交主会话处理，本次未删除。
  - 关联验证命令：`corepack pnpm vitest run tests/native-bridge-time-limit.test.ts tests/task-time-limit.test.ts tests/extended-integration.test.ts tests/agy-background-environment.test.ts tests/authorized-catalog-windows-agy.test.ts tests/cli-management-acceptance-fixes.test.ts tests/build-dependencies.test.ts tests/hermes-nous-refresh-native.test.ts tests/hermes-renewal.test.ts tests/hermes-nous.test.ts tests/hermes-accounts.test.ts tests/hermes-integration.test.ts tests/hermes-installation.test.ts tests/custom-provider-remotes.test.ts tests/custom-provider.test.ts tests/provider-form.test.tsx tests/accounts-window.test.tsx tests/settings-dialog.test.tsx`：18 文件、612/612 通过，21.02 秒。
  - 独立复跑命令：`corepack pnpm vitest run tests/pi-omp-adapter.test.ts tests/native-agy-acp.test.ts --maxWorkers=1`：2 文件、176/176 通过；`corepack pnpm vitest run tests/cli-management-hermes-residue.test.ts tests/native-workbuddy.test.ts tests/native-agy-acp.test.ts --maxWorkers=1`：3 文件、135/135 通过。最终缓存隔离后 `corepack pnpm vitest run tests/cli-management-hermes-residue.test.ts`：51/51 通过，8.48 秒（测试执行 2.36 秒）。未对仅一次高负载出现、独立及最终全量均通过的 WorkBuddy 用例作无依据改动。
  - 泄漏关联复验命令：`corepack pnpm vitest run tests/cli-management-local-artifacts-windows.test.ts tests/windows-cli-resolution.test.ts tests/authorized-catalog-windows-agy.test.ts tests/probe-process.test.ts`：4 文件、149/149 通过，23.03 秒，`$TMPDIR/cliworker-probe-*` 24→24、新增 0、删除 0。
  - 最终验收：两轮均执行完整默认配置 `corepack pnpm vitest run`（子进程环境 `KIMI_CODE_NO_AUTO_UPDATE=1`，没有 maxWorkers/单文件过滤）；第一轮 172.79 秒，第二轮 196.51 秒。每轮均为 339 文件中 335 通过、0 失败、4 原有跳过；7761 项中 7747 通过、0 失败、14 原有跳过。
  - 两轮完整运行的 `$TMPDIR/cliworker-probe-*` 独立快照均为 24→24，新增 0、删除 0；同时记录 owner PID 与测试进程树，确认没有新增本轮归属残留。日志及前后快照在忽略目录 `.test-data/full-suite-stability/`：`stable-1.log`、`stable-2.log`、对应 `*-before.json` / `*-after.json` / `*-summary.json`；旧残留仍原样保留。
  - 最终两轮后 `corepack pnpm typecheck` 通过（Host/Client，DSH 0.2.2-rc.3）；`corepack pnpm build:preview` 通过，产物仅 `.cache/preview-package`。未运行正式 build、更新 Desktop、真实 CLI 更新、真实模型调用或推送。
  - 最终严格校验：`corepack pnpm spec validate v0.8.10-hermes-renewal-fix-leeyl --strict` 与 `corepack pnpm spec validate vnext-custom-provider-form-leeyl --strict` 均通过；`/Library/Developer/CommandLineTools/usr/bin/git diff --check` 通过。
- [ ] 3.2 Mac Desktop 实机：Pi 等已核实 CLI 的表单显示与写入（使用测试用服务商与测试密钥，不调用模型）
  - 2026-11-14 Mac Desktop（构建 44740eb）：Pi「添加账号」卡片显示「其他服务商（在本窗口中填写配置）」，继续后进入同窗口表单：服务商 ID*、服务商名称、Base URL*、API 协议*（OpenAI Chat Completions / OpenAI Responses / Anthropic Messages / Google Generative AI）、API Key*（可显隐）、模型 ID*；底部「在原生终端中配置」「返回」「保存」。空表单保存逐字段显示必填错误；返回、关闭均正常。
  - 未执行：真实保存写入（会改动用户 Pi 配置，待用户提供测试服务商或授权）、OpenCode/Hermes 表单、深色主题与英文界面、Windows。
  - （未执行：本次只做 Host 与临时 HOME 模拟验收；没有真实账号写入、模型调用、Desktop 或 Windows 验收。）
  - 2026-11-15 Mac Desktop（34133b9 构建）真实写入，使用虚构测试服务商（ID `cwn-test`、名称「CWN 测试服务商（模拟）」、Base URL `https://api.example.invalid/v1`、OpenAI Chat Completions、测试密钥、模型 `test-model`），不调用模型；写前备份，验后按摘要恢复原样。
  - Pi：保存后显示「已添加 CWN 测试服务商（模拟）· 已保存原生配置；密钥有效性与模型可用性尚未验证」。写入 `~/.pi/agent/models.json`（providers 只含 cwn-test，api openai-completions）与 `auth.json`（cwn-test 为测试密钥），权限均 600；已删除新建的 models.json、auth.json 按备份恢复（摘要一致）。发现：账号窗口当前账号显示「插件目录 · 只在 CLI Worker 中使用」（`~/.dsh/cliworker-now/accounts/pi/agent`），但表单写入的是原生 `~/.pi/agent`，插件目录两文件未变；需确认这是否为预期目标。
  - OpenCode：写入 `~/.config/opencode/opencode.json` 新增 cwn-test（OpenAI 兼容、测试 Base URL、test-model），`~/.local/share/opencode/auth.json` 只含测试密钥、权限 600；已恢复，配置摘要与原文件一致，新建 auth.json 已删除。
  - Hermes：保存失败，页面提示「保存失败，原生配置未更改；请检查文件格式、权限或原生账号锁」；`config.yaml` 与 `.env` 摘要未变，config.yaml YAML 解析正常。原因未查明：核对 `.env` 能否被插件解析需读取用户凭据文件，未获授权，未执行。
  - 仍未验证：Hermes 写入、深色主题与英文界面、Windows。本项保持未勾选。
  - 2026-11-15 Hermes 保存失败根因（经用户授权检查 `~/.hermes/.env` 格式，只输出键名、引号类型与长度，不输出值）：`.env` 11 个键均为普通 `KEY=value`，`parseHermesOwnEnvironment` 通过；`config.yaml` 无 YAML 错误或警告，但没有顶层 `providers`（Hermes 官方默认配置只有注释示例）。旧代码 `doc.set('providers', {})` 写入的是普通对象而非 YAML 节点，随后 `setIn` 抛出 `Expected YAML collection at providers`，被统一归为「保存失败」。原有测试夹具都自带 `providers` 映射或为空 HOME，漏掉该情形。
  - 修复 e096dd4：`providers` 缺失或为空值时改用 `doc.createNode({})` 新建；新增模拟用例「没有顶层 providers」「providers 为空值」先失败后通过；`tests/custom-provider.test.ts` 与 `tests/custom-provider-remotes.test.ts` 52 项通过；`corepack pnpm typecheck` 通过。用真实 `config.yaml` 的私有临时副本（`.env` 换成合成内容，验后删除）运行真实 `CustomProviders.save`：返回 ok，除新增 `providers.diagprov` 外其他键 JSON 一致，注释行 2034→2034。真实 `~/.hermes` 未写入；Mac Desktop 上 Hermes 表单的实机复测待新构建后执行。
- [x] 3.3 README、doc/design.md 同步
  - README.md、README.en.md、doc/design.md 同步 Host 支持范围、原生写入、回滚/凭据边界及前端独立验收状态；版本号未改，src/client/** 未改。

## 4. Pi 表单账号目录修复 〔后端｜2h｜前置 1〕
- [x] 4.1 核对 Pi 账号与 Worker 来源，修正表单目标并同步设计、规格和 README
  - 2026-11-15：已核对登录、provider 合并与 Worker 快照链路，修正目标和实际路径显示；新增全局重名保护。Hermes/OpenCode 的同类来源风险记录在 design.md，代码保持不变。
- [x] 4.2 临时 HOME 模拟覆盖私有目录、Worker 快照可见性、全局冲突和安全约束，执行类型检查、关联回归及隔离构建
  - 范围限制：不读取真实凭据、不更新 Desktop、不调用真实 CLI/模型；3.2 实机验收保持待办，变更不归档。
  - 2026-11-15：`KIMI_CODE_NO_AUTO_UPDATE=1 corepack pnpm vitest run tests/custom-provider.test.ts tests/custom-provider-remotes.test.ts` 最终 2 文件、61/61 通过（新增 9 项）；覆盖 Host 实际创建管理器传递 stateDirectory、空/已有私有目录保存、真实 snapshotPiOmpNative 函数读回合成配置与密钥、全局原文不变、两来源名称冲突、DSH_HOME/显式目录优先、票据来源变化、私有目录符号链接。原有锁、文件链接、回滚及 Hermes 缺失 providers 回归保持通过。
  - `corepack pnpm typecheck` 最终通过，Host/Client 对 DSH 0.2.2-rc.3。前两次因新 worktree 缺少 `lib/typert.remote-client.d.ts` 失败；`corepack pnpm build:preview` 成功后，复制本次 `.cache/preview-package/lib` 到被忽略的工作树 `lib/`，再跑原命令通过；没有改构建脚本或执行正式 build。
  - `corepack pnpm spec validate vnext-custom-provider-form-leeyl --strict --no-interactive` 与 `/Library/Developer/CommandLineTools/usr/bin/git diff --check` 通过。原变更 3.2 的 Desktop/Windows 等验收未完成，保持待办、不归档。
  - worktree 实际初始 HEAD 为 6c6db88，干净状态下快进到任务指定的 e096dd4 后实施；依赖按锁文件安装，未改版本号与锁文件。全部账号文件测试均使用临时 HOME 合成数据，没有读取真实凭据或 `.env`，没有访问真实 `~/.pi`，没有启动真实 CLI、调用模型或推送。

## 5. Hermes 与 OpenCode 表单账号目录修复 〔后端｜3h｜前置 4〕
- [x] 5.1 接入 Hermes 生效 HOME 选择器、OpenCode 私有来源及全局冲突保护，同步设计、规格与 README
  - 2026-11-15：Hermes 表单复用 effectiveHermesHome，展示实际路径，来源切换在保存及事务提交时拒绝/回滚；原生/私有 HOME 单选，因此不扫描未生效来源。OpenCode 使用账号登录共用的私有 data 与优先合并的私有 config，对全局 config.json/json/jsonc/auth 做冲突检查，票据绑定 XDG 检查路径。README 中英文、doc/design.md、增量 design/spec 已同步。
- [x] 5.2 临时 HOME 验证 Worker 启动配置读回、来源切换、重名和安全回归，完成类型检查及严格校验
  - 3.2 保持未勾选；真实 Desktop 验收交主会话执行。
  - 2026-11-15：`KIMI_CODE_NO_AUTO_UPDATE=1 corepack pnpm vitest run tests/custom-provider.test.ts tests/custom-provider-remotes.test.ts tests/hermes-accounts.test.ts tests/harness-opencode-accounts.test.ts tests/hermes-integration.test.ts tests/opencode-adapter.test.ts`：6 文件、146/146 通过，0 失败（本轮新增 23 项表单/Remote 模拟测试）。
  - 临时 HOME 下实际调用 prepareOpenCode，读回 Worker config 与 auth 快照；Hermes 调用 prepareHermes（仅模拟 executable 身份验证/命令组装，不启动 CLI），再经 assertHermesOwnAccounts 读回启动 HOME 的 providers/key_env 合成数据。覆盖 marker 新选中、账号删除不回落、旧票据、提交中途来源变化回滚、不安全 marker/祖先链接、独立 HOME 同名隔离、变量名冲突、OpenCode 合并顺序/全局各层冲突与 XDG 切换；现有 dotenv 子集、providers 新建、0600、锁与回滚回归继续通过。
  - `corepack pnpm typecheck`、`corepack pnpm build:preview`、`corepack pnpm spec validate vnext-custom-provider-form-leeyl --strict`、`/Library/Developer/CommandLineTools/usr/bin/git diff --check` 均通过。构建仅更新隔离预览包，没有正式 build、Desktop 更新或推送。
  - 未访问真实账号目录或凭据，未启动真实 CLI/模型；Hermes 自定义服务商 HTTP 执行仍受原有白名单限制，启动准备读回不作为该通路或远端服务可用性证据。3.2 保持待办、不归档。
