# Tasks

## 1. OMP 18.22.0 契约与表单启用门槛 〔后端｜4h〕

- [x] 1.1 对齐实际 OMP 入口、版本标签的完整字段 schema 和凭据解析，记录 `baseUrl`、`api`、`auth`、`models`、`apiKey`、服务商显示名称及文件选择的证据，圈定可确认的配置来源
  - 2026-11-19 门槛通过，改为实测证据，结果表见 [设计决定 1 实施核实结果](design.md#实施核实结果2026-11-19门槛通过)。隔离目录 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-19-omp-custom-provider/`（0700），临时 `HOME`、`PI_CODING_AGENT_DIR`、`PI_OFFLINE=1`，本机 `/Users/leeyl/.local/bin/omp`（`omp/18.22.0`）；未改用户 `~/.omp`、`agent.db`。
  - 字段：`providers.<id>` 的 `baseUrl`、`api`、`auth: apiKey`、`apiKey`、`models[{id,name}]` 可读；缺 `apiKey` 的任一服务商会使整份 models.yml 的自定义服务商全部失效（OMP 告警原文 `models.yml validation failed — custom providers disabled`）。服务商级 `name` 未核实，名称只存插件回执。
  - 文件选择：`models.yml` → `models.yaml` → 迁移 `models.json`；插件目录有后两者、设置了 `OMP_PROFILE`/`PI_PROFILE` 或 `PI_CODING_AGENT_DIR` 指向别处时表单返回 `null`。
- [x] 1.2 用隔离 HOME 和虚构配置回读原生模型目录，逐个确认拟提供的 API 值和最小模型条目；用合成密钥、环境及合成 `agent.db` 验证字面值、环境名同名、空库和同 ID 凭据优先级，并确认有效环境与 Host 读取规则一致
  - 在隔离路径采用默认 profile、关闭扩展及联网发现，仅记录退出状态、模型标识和凭据来源判断，不输出密钥、不登录、不发送提示或调用模型。`omp models ... --json` 可验证条目可见，API 与凭据优先级还须由版本源码或本地解析结果验证。
  - 实测：四种 API 的最小条目均出现在 `omp models --json --no-extensions`。凭据优先级用本机假端点 `127.0.0.1:18791`（记录请求头、一律回 401，脚本在会话 scratchpad，记录在 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-19-omp-custom-provider/requests.log`）验证：`omp -p --model <id>/<model>` 退出 1（假端点 401），OpenAI 两种与 Anthropic 为 `Authorization: Bearer <原值>`，Google 为 `x-goog-api-key: <原值>`；`${HOME}` 不插值。只有发往本机假端点的请求，未向任何真实服务商发请求，也未调用模型。
  - 环境名同名：小写标识符、带短横线的名字都会被进程环境、启动目录 `.env`、agent 目录 `.env`、`~/.omp/.env` 中的同名变量替换。合成 `agent.db` 同 ID 凭据的选择未单独实测，改为保存前查重拒绝所有已存凭据行 ID（不依赖优先级）。
  - 内置同名：`openai`、`deepseek`、`zai`、`kimi-code`、`openrouter`、`github-copilot`、`anthropic`、`google`、`amazon-bedrock`、`nanogpt` 与内置目录合并；`ollama`、`lm-studio`、`vllm`、`litellm`、`llama-cpp` 及全新 ID 只列出自定义模型。
- [x] 1.3 在设计与本任务记录启用结论、通过的 API 选项、配置来源和回退原因；未证明安全写入、可读回、可查重或凭据无歧义时，验收 Host 仍返回 `null` 并保留原生终端
  - 结论：启用。API 选项为 `openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai`，写入 `<stateDirectory>/accounts/omp/agent/models.yml`。密钥拒绝 `!` 命令、`$` 引用、占位符、`^[A-Za-z_][A-Za-z0-9_]*$` 形式与 Host 进程环境同名值；项目 `.env` 恰以该密钥为变量名属剩余风险（见 design.md 与 doc/design.md）。保存前读不到已有 ID 或内置探测失败时拒绝保存。

## 2. OMP 账号窗口和通用表单 〔前端｜3h｜前置 1〕

- [x] 2.1 在 Host 两个 Remote 与表单服务接入经过核实的 OMP 入口，沿用 `accounts-window.tsx`、`provider-form.tsx` 和共享协议；核对卡片文案、六个字段、实际目标及「在原生终端中配置」入口
  - `src/host/service-accounts.ts` 两处名单加入 `omp`；`src/host/custom-provider.ts` 的 `Supported`、`APIs` 与 `targets('omp')`。Client 与共享协议未改（表单描述驱动）。编译后 Host 实测：表单字段 `providerId, providerLabel, baseUrl, api, apiKey, models`，四个 API 值，`nativeFallback: true`，`target` 为插件 `models.yml`。卡片文案的界面核对留待任务 5 的 Desktop 验收。
- [x] 2.2 在 `provider-form` 和 `custom-provider-remotes` 关联测试中覆盖可用表单、版本或来源不明返回 `null`、旧 Host／无有效描述走原生终端、打开或取消无写入及过期票据拒绝
  - `tests/custom-provider.test.ts`：「模拟：OMP 表单列出六个字段和四种协议，打开表单不写入文件」「模拟：OMP 表单遇到 %s 返回 null，目录保持原样」（profile、`PI_CODING_AGENT_DIR` 指向别处、`models.yaml`/`models.json`、缺失入口）「模拟：OMP 使用选项时钟拒绝过期 token，目录保持原样」。`tests/custom-provider-remotes.test.ts` 两条原 null 名单移除 omp，并新增「模拟：OMP Remote 保存查询 Host 预留集，拒绝冲突后可用同一表单重试」「模拟：OMP Remote 预留查询失败返回 providerId 字段问题，释放租约且不写文件」。旧 Host／无效描述走原生终端沿用 `provider-form.test.tsx` 与账号窗口的通用路径，Client 未改。
- [x] 2.3 实施时按账号窗口规则更新 `doc/settings-ui-design.md` 与 OMP 用户操作说明，核对文案、中英入口及文件边界与实际表现一致
  - `doc/settings-ui-design.md`「服务商表单模板」新增 OMP 条目；README 中英「账号管理」行加入 OMP；`doc/design.md` 新增「2026-11-19：OMP 其他服务商」并标注 11-14 段的 OMP 回退已更新。

## 3. 插件目录写入与并发保护 〔后端｜5h｜前置 2〕

- [x] 3.1 实现目标绑定和 OMP 原生 YAML 映射，复用字段校验、账号 reservation、事务回读及归属回执；核对目标严格来自 `piOmpAccountDirectory('omp', stateDirectory)`，名称存为插件展示数据
  - 新增 `src/host/omp-custom-provider.ts`（密钥校验、YAML 新增与回读、内置 ID 探测）；`custom-provider-managed.ts` 回执增加可选 `labels`（增删与删除托管服务商时保留其他标签）；`pi-omp-native.ts` 新增 `piOmpConfiguredProviderIds`，托管 OMP 服务商卡片显示保存的名称（无名称时为 ID）；`accounts.ts` 新增 `ompProviderReservations`，在账号 reservation 内读取全局与插件的服务商及凭据行 ID、原生登录选项与内置探测结果。
  - 编译后 Host 端到端（虚构值，目录 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-19-omp-custom-provider/e2e/`）：已有服务商与注释保留（行尾注释前的多余空格被规整为一个），新增节点与回执均 `0600`，全局 `models.yml` 的 SHA-256 前后一致，返回值不含密钥；与全局 ID 冲突时返回 `providerId` 字段错误且不写入。真实 OMP 读该插件目录列出 `e2e-prov/m-new`、`e2e-prov/m-new-2`、`existing-one/m-existing`，向假端点发出的 `Authorization` 与写入的虚构密钥一致。内置探测实测 `openai`/`deepseek`/`zai` 为真、自定义 ID 为假，单次 2–4.5 秒。
- [x] 3.2 用临时夹具覆盖缺失或无效字段、无效协议、危险 URL、密钥解析歧义、重复模型 ID，以及插件／全局／内置 ID 或名称冲突，逐字段核对错误和目录无写入
  - 「模拟：OMP 拒绝缺失的预留集、Host 预留 ID 和 OMP 内置 ID，文件字节保持原样」「模拟：OMP 拒绝与本地或全局 ID、保存的显示名称冲突，返回对应字段」「模拟：OMP 拒绝%s，返回字段问题且文件字节保持原样」（名称冲突、协议、URL、重复模型、`!` 命令、`$` 引用、占位符、标识符形式与环境同名密钥、其他字段含密钥）「模拟：OMP 遇到含%s的 YAML 返回通用错误，文件字节保持原样」（重复键、别名）「模拟：ompLiteralKeyIssue 仅在 Windows 忽略环境变量名的大小写」。内置 ID 探测本身用真实 OMP 实测（见 3.1），单测以 mock 预留集代替。
- [x] 3.3 用临时夹具分别核对首次新建和追加写入的 YAML、回执、目录 `0700`、文件 `0600`，比对全局目录及新旧 `agent.db`、`.env`、其他服务商和已有凭据的写前写后状态，确认公开结果和日志不含密钥
  - 「模拟：OMP 首次保存写入精确 YAML 和私有回执，消费 token 且不输出密钥」（含 console 各方法监听、回执不含密钥、新建目录 0700）「模拟：OMP 追加服务商保留 CRLF、注释和旧配置，全局配置、agent.db 与 .env 字节不变」「模拟：addOmpProvider 初始化空 providers，按字面值回读，拒绝覆盖同 ID」；`custom-provider-managed.test.ts` 的 OMP 夹具改走真实保存路径，新增标签保留与非法标签两条。
- [x] 3.4 注入暂存、替换、回执及回读失败，验证旧文件恢复和新文件移除；覆盖外部并发编辑不被回滚覆盖、权限或来源变化拒绝、不安全链接和账号占用拒绝
  - 「模拟：OMP 提交 YAML 后取消（原配置存在=%s），恢复文件并清除暂存和备份」覆盖替换后失败的恢复与新文件移除。外部并发编辑不回滚、不安全链接、来源变化与账号占用沿用 `commitNativeFiles`／`readNativeFile`／reservation 的既有实现与其现有回归（Pi、Hermes、ZCode 用例），本次未为 OMP 单独重复。

## 4. 账号与模型目录生效 〔后端｜3h｜前置 3〕

- [x] 4.1 连接保存后缓存失效与窗口重读，确认账号状态、名称与精确模型标识来自实际文件；模拟刷新失败时保留已保存配置并显示重新刷新提示
  - 沿用 `saveCustomProvider` 成功后的 `invalidateSettingsDisplay` 与账号窗口 `onSaved` 重读；刷新失败提示为既有通用路径（`custom-provider-remotes.test.ts` 已有用例）。编译后 Host 实测 `inspectPiOmpNativeAccount` 读出 `omp:e2e-prov:plugin.config`、名称「E2E 测试服务商」、`managedConfiguration: true`，结果不含密钥。
- [x] 4.2 用 `pi-omp-native`／`pi-omp-adapter` 关联回归覆盖全局在前、插件在后、同 ID 的插件定义优先和无冲突条目并存，并确认 Worker 快照能读取新增条目、缓存和展示均无密钥
  - 合并顺序未改，既有 `pi-omp-*` 回归全部通过（见 4.3）。编译后 `snapshotPiOmpNative` 实测：快照 `models.yml` 含 `global-one`、`existing-one`、`e2e-prov`，真实 OMP 18.22.0 以快照为 `PI_CODING_AGENT_DIR` 列出四个模型。插件与全局同 ID 不会出现：保存时已拒绝。
- [x] 4.3 实施时运行关联回归、必要类型检查与隔离预览，记录调用范围和结果；核对 README 中英版及 `doc/design.md` 的 OMP 保存、刷新与原生终端回退描述
  - 2026-11-19（日志在 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-19-omp-custom-provider/`）：`corepack pnpm typecheck` 通过（DSH 0.2.2-rc.3；worktree 先运行 `node scripts/build.mjs --host-only` 生成 `lib/typert.*`）；vitest 16 个文件（custom-provider 三件、zcode-custom-provider、native-config-provider-delete、provider-form、native-login-providers、provider-login-status、全部 `pi-omp-*`、accounts*）611 通过 1 跳过；`corepack pnpm build:preview` 通过；`corepack pnpm lint` 0 error，改动源码逐文件告警数与 main 相同；`corepack pnpm format:check` 仍报的 12 个文件在 main 上本就未按 Prettier 格式化，按规定不整文件重排，新增的 `omp-custom-provider.ts` 与 `service-accounts.ts` 已通过。均设 `KIMI_CODE_NO_AUTO_UPDATE=1`，未移除代理变量。

## 5. Mac Desktop 服务商保存验收 〔测试｜3h｜前置 4〕

- [x] 5.1 建立隔离 Mac Desktop（DSH 0.2.2-rc.5）验收环境，用虚构服务商和不可用于真实服务的测试密钥；写前备份插件目标，记录文件存在性、权限和全局目录基线
  - 2026-11-20：用 Desktop 自带的 rc.5 `dsh`（`/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`）在隔离 `HOME`／`DSH_HOME`（`/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-19-omp-custom-provider/web-acceptance/`，0700）以 `--profile web` 启动 Web 界面，经内置浏览器操作，与 Desktop 同一 Host 与界面代码；插件为 `build:preview` 隔离包。未在用户真实 Desktop profile 中写服务商。
  - 插件写入目标在隔离 `DSH_HOME` 内，写前不存在，故无需备份；`backup/2026-11-19-omp-custom-provider/` 未建立。真实 `~/.omp` 与 `~/.dsh/cliworker-now/accounts/omp` 的 232 个文件写前做 SHA-256 基线（`real-baseline-before.txt`）。
  - 测试密钥为虚构字符串，服务商为 `api.example.com`（保留域名）与本机模拟服务商，不能用于真实服务。
- [x] 5.2 真实验收「添加账号 → 其他服务商」表单与原生终端备选，保存虚构服务商后查账号状态和模型目录；独立回读插件写入内容与权限，对比全局目录及已有凭据，验后恢复备份并复核恢复结果。保留脱敏界面和回读证据，全程不调用模型
  - 首轮发现缺陷：每次保存都报「表单已过期或 CLI 入口已变更」。原因是 Remote 客户端每次读 `api.cliworker.customProviderForm` 都返回新函数，账号窗口把它放进 `useEffect` 依赖，每次渲染都重新读表单并让 Host 新开票据，票据表满 256 后挤掉表单持有的那张（隔离 Host 临时诊断日志记录 `has:false, size:256`，诊断代码已随重装移除）。修复：`accounts-window.tsx` 用 `useRef` 保存读取函数，effect 只依赖「是否可读」；`tests/zcode-account-window.test.tsx` 新增模拟用例（每次读取都返回新函数，表单只读一次），修复前超时失败、修复后通过。
  - 修复后复测：保存「验收测试服务商」（`acceptance-test`，`https://api.example.com/v1`）成功；`models.yml` 与 `cliworker-created-providers.json` 均 0600、目录 0700，回执只含服务商 ID、SHA-256 指纹和名称。账号状态显示「验收测试服务商 API 登录」，模型目录为空：插件只列服务商 `/models` 只读接口确认的模型，虚构域名无法确认，保守不显示（既有设计，规格场景已写明）。
  - 再加第二个服务商「本机模拟服务商」（`acceptance-local`，指向 `mock-provider.mjs`，标注为模拟，只回答 `GET /v1/models`）：两条服务商并存，原条目保留；设置页模型下拉列出 `test-model-a`、`test-model-b`。模拟服务商全程只收到 4 次 `GET /v1/models`，没有任何模型调用请求。
  - 「在原生终端中配置」打开 OMP 原生 setup（服务商登录列表），未登录直接关闭。
  - 恢复：在账号窗口逐个「退出」两条服务商，`models.yml` 回读为 `{ "providers": {} }`，回执 `providers` 为空；删第一条后列表约数秒后才刷新，不影响结果。整个测试目录搜索虚构密钥无残留；真实目录 232 个文件写后 SHA-256 与基线一致，未新增文件。
  - 回归：`KIMI_CODE_NO_AUTO_UPDATE=1` 下关联 5 个测试文件 427 通过；`corepack pnpm typecheck` 通过（DSH 0.2.2-rc.5）；改动文件 eslint 无告警；两文件在 main 上本就未按 Prettier 格式化，未整文件重排。
  - 未验证：Windows；真实服务商与真实密钥（按要求不调用模型）。
