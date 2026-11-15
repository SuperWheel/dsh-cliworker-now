# Tasks

## 1. 变更与规格 〔产品｜1h〕
- [x] 1.1 创建变更，交付 proposal、三份增量规格、design 并严格校验
  - `corepack pnpm spec new change --version next --topic zcode-custom-key --creator leeyl --creator-name Leeyl --title "ZCode 自定义 API Key"` 创建 `v0.8.10-zcode-custom-key-leeyl`（全局没有 pnpm，用 corepack）。
  - 增量规格三份：cli-model-discovery（新增 1 条、修改「按账号与执行路由筛选」）、custom-provider-config（新增 3 条）、cli-native-features（新增 1 条）。
  - `corepack pnpm spec validate v0.8.10-zcode-custom-key-leeyl --strict`：首次因两条要求正文超过 500 字报警告（exit 1）；把细节移入场景后结果为 valid。

## 2. ZCode 0.17.1 运行偏好兼容 〔后端｜3h｜前置 1〕
- [x] 2.1 静态判定已安装入口的工作流字段位置，Host 经私有环境变量交给桥接，桥接在启动 CLI 前删除
  - 新增 `src/host/zcode-schema-probe.ts`。`cli-native-capabilities.mjs` 新增 `consumeZcodeWorkflowSurface`、`zcodeRuntimePreferences`、`zcodeSessionWorkflow`。`native-zcode.mjs` 的两处答复与 `zcode-resume.mjs` 的元数据答复改用这些函数，session/create 与 resume 按判定附带工作流字段。
  - 本机静态读取（不运行 CLI）：`/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`（0.17.1）判为 `session`，约 39ms；插件缓存的 0.16.9 判为 `none`。
- [x] 2.2 模拟覆盖新旧 schema
  - `tests/native-zcode.test.ts`（标明模拟）：模拟 CLI 按 REPLY_SCHEMA 严格拒绝未知键（exit 24）。覆盖旧 schema + preferences、0.17.1 三种工作流模式、未知 schema 省略字段、旧式答复遇 0.17.1 schema 导致派遣失败，并确认判定变量未泄漏给 CLI。单独运行 55 passed。
  - `tests/zcode-schema-probe.test.ts`：合成片段分类、按文件身份缓存与重读、答复构造，以及本机两个入口的静态读取。与 zcode-resume 一起 24 passed。

## 3. 自有 API Key 服务商目录 〔后端｜3h｜前置 1〕
- [x] 3.1 404/405 未核实候选、401/403 隐藏、请求头镜像、显示名称
  - `zcode-adapter.ts`：`standard-personal` + `api-key` 在 404/405 时列出 personalModelIds，标签为「（名称 · 本机配置，未核实）」，cost 为 unknown；denied 计入 rejected。`zcodeRouteHeaders` 校验请求头后作为 `extraHeaders` 传入，`account-models.mjs` 按同名覆盖合并。新增 `safeZCodeProviderName` 与重名回退。
  - 已知边界：`/models` 返回 200 但缺少某个声明模型时，该模型仍隐藏（保持原行为）。
- [x] 3.2 模拟覆盖目录放行与拒绝
  - `tests/zcode-adapter.test.ts` 新增 describe「ZCode own API-key providers without a subscription」：404/405 未核实；401/403、500、非 standard-personal 分组、Coding Plan 隐藏；显示名称，重名或不安全名称回退为 ID；请求头镜像，`Host` 头跳过路由。
  - zcode-adapter、zcode-account-models、account-models 三个文件共 91 passed。

## 4. 账号窗口「其他服务商」 〔后端｜5h｜前置 1〕
- [x] 4.1 Host：表单、模板、写入、查重、回滚、账号行与删除
  - 新增 `src/host/zcode-custom-provider.ts`。`custom-provider.ts` 接入 zcode（只写 `<zcodeAuthDirectory>/.zcode/v2/provider_config.json`，票据 10 分钟有效）。`accounts.ts` 和 `index.ts` 允许删除 zcode 的 `plugin.config`。`zcode-grok-accounts.ts` 新增 `withZCodeProviderRows`。
  - 共享协议新增可选的 `CustomProviderForm.presets`；`managedProviderReceiptRemoval` 供删除时更新归属记录。
- [x] 4.2 Client：模板预填、ZCode 卡片与删除、只读行、中英文词条
  - `provider-form.tsx` 新增「从内置模板预填」；`accounts-window.tsx` 中 ZCode 的「其他服务商」只在 Host 返回表单时出现，插件条目显示「删除」，桌面端条目只读并标「在 ZCode 桌面端管理」；`i18n-messages.ts` 补英文。
  - 设计参数写入 `doc/settings-ui-design.md`「账号」窗口段与「服务商表单模板」。
- [x] 4.3 模拟测试：写入、冲突、回滚、删除、界面
  - `tests/zcode-custom-provider.test.ts`（11 passed）覆盖：
    - 模板只含 api-key 且未停用的模型。
    - 只写插件文件（0600），全局文件逐字节不变，结果与归属记录不含密钥，票据只能用一次。
    - 与全局、内置、插件三处重名时拒绝。
    - 逐字段校验，以及误填在公开字段中的密钥。
    - 票据过期或入口变化时拒绝。
    - 归属记录 rename 失败时回滚。
    - 精确删除插件条目及其模型规则；被改动的条目、外来句柄和全局条目拒绝删除。
    - `withZCodeProviderRows` 的状态合并。
  - `tests/zcode-account-window.test.tsx`（6 passed）覆盖：
    - 模板只填公开字段，选择不提交。
    - 没有模板时不显示选择。
    - 桌面端行只读；插件行删除时调用 `deleteAccountConfiguration`。
    - 订阅行保持引导式退出。
    - 有表单时显示「其他服务商」且无原生终端备选；旧 Host 和返回 null 时只列两家。
  - `tests/zcode-grok-accounts.test.ts` 的 personal-api 退出后用例：期望值改为包含只读 API 行（这是新行为），50 passed。

## 5. 文档与验收 〔测试｜2h｜前置 2,3,4〕
- [x] 5.1 同步 README、README.en、doc/design.md、doc/settings-ui-design.md
  - README / README.en 新增「订阅过期后使用自己的 API Key」段；doc/design.md 新增本变更小节；settings-ui-design 的账号窗口段和「服务商表单模板」补充 ZCode 行、删除确认与内置模板参数。`git diff --check` 无输出。
- [ ] 5.2 隔离构建、类型检查与关联回归（整组并行仍有偶发失败未排除，暂不勾选）
  - `corepack pnpm build:preview`：exit 0，隔离包在 `.cache/preview-package`，其中 Host 与 Client 的 tsc 均通过。
  - `corepack pnpm typecheck`：工作树没有 `lib/`，首次因缺 `dsh-cliworker-now/remote` 声明失败（exit 1，与改动无关）。把预览包生成的 `typert.remote-client.*` 临时复制到被忽略的 `lib/` 后通过（exit 0，「Host/Client typecheck passed against DSH 0.2.2-rc.3」），随后删除 `lib/`。
  - 单独运行全部通过：zcode-custom-provider 11、zcode-account-window 6、zcode-grok-accounts 50、native-zcode 55。表单与账号窗口相关的 10 个文件 225 passed（provider-form、accounts-window、accounts-window-managed、client-i18n、custom-provider、custom-provider-managed、native-config-provider-delete、pi/omp-account-window、zcode-account-window）。
  - 全部引用 ZCode 的 63 个测试文件整组并行跑了 3 次：
    - 第 1 次：10 failed / 2591 passed。其中 native-zcode 账号类用例 9 项，另 1 项是 zcode-grok-accounts（期望值已按新行为更新）。
    - 第 2 次（与构建同时运行）：8 failed，涉及 native-zcode、accounts、native-harness-tools。
    - 第 3 次（空闲时）：2 failed / 2599 passed，涉及 native-zcode 1 项、settings-dialog 1 项。
    - 每次失败的用例都不同，也包括与本次改动无关的文件。
  - 对照：`git archive HEAD` 导出的干净副本，同组 60 个文件跑 1 次，2566 全部通过。
  - 排查：native-zcode 单独运行时，本分支和 HEAD 的账号用例耗时都约 75–117ms，远低于用例的 600ms 时限。在 10 核全部占满（`yes` ×10）的压力下，本分支 55/55、HEAD 50/50 各跑 2 次也全部通过。
  - 结论：失败像是多个 vitest 并行进程下 600ms 时限导致的偶发超时，但没有完全排除本分支整组负载更高的可能，需要主会话在合并后的统一回归中复核。
  - 未执行：沙箱外全量 vitest、Windows 平台检查。
- [ ] 5.3 真实 Desktop 验收：订阅过期 + 自有 API Key，分别走 headless 与 app-server 派遣
  - 未执行：需要用户另行授权真实模型调用。本次没有登录、没有调用模型，也没有运行真实 ZCode CLI。
  - 验收时应检查：0.17.1 不再因答复字段失败；目录 404/405 时出现未核实候选；Worker 实际使用所选自有服务商（事件、退出状态与产物）；全局 `~/.zcode/v2/provider_config.json` 未被修改。

## 6. 复测问题修复 〔后端｜2h｜前置 5〕
- [x] 6.1 0.17.1 授权请求重发导致审批循环：按 requestId 合并，补模拟测试
  - 证据：复测原始流 `~/.dsh/cliworker-now/8db3254a-….de56417b-….raw.jsonl` 中 17 条 `interaction/requestPermission`（server-3…server-19），requestId 均相同；插件对应生成 approval-1…approval-17。
  - 0.17.1 源码：`kLt` 设置 `reannounceIntervalMs: tMc`（tMc=1e3），`requestClient` 按间隔翻倍重发，上限 `KBc=1e4`；`resolveClientRequest` 按任一已登记 id 结束同一请求。答复 schema `V4` 未变。
  - 修改 `src/host/native-zcode.mjs`（按 requestId 合并；回复最新 id；迟到的重发用同一结果答复）；增量规格 cli-native-features 新增「ZCode 重发的授权请求只转交一次」；design 决定 7。
  - `tests/native-zcode.test.ts`（模拟）新增「re-announces」两项（allow-once 与 deny）：模拟 CLI 以 server-3/4/5 重发、在答复后再发 server-9。断言只有 1 张审批卡，server-5 与 server-9 得到相同决定且不含 permissionUpdates。临时换回修复前的桥接代码时这两项失败（2 failed），恢复后通过。
  - `pnpm_config_verify_deps_before_run=false`：native-zcode、zcode-resume、zcode-schema-probe、native-approval-relay、worker-permissions、zcode-adapter 共 6 个文件 231 passed；typecheck 借用主检出 `lib/typert.remote-client.*` 后 exit 0（随后删除临时 `lib/`）。
  - 未执行：真实 Desktop 复测，需由主会话在合并后重新运行。
- [x] 6.2 核查下拉框与派遣卡只显示模型 ID
  - 证据：设置目录缓存 `settings-catalogs/44bd599b….json` 中，Host 标签为「deepseek-v4-flash（deepseek · 本机配置，未核实）」，目录提示为「当前账号可用模型；2 个自定义服务商未提供模型目录，所列模型来自本机配置，可用性与费用未核实」。说明 `/models` 返回 404/405、未核实，Host 标注已按设计生成。
  - 只显示 ID 是因为 Client 的 `displayModelName`（`src/shared/model-presentation.ts`）按既有规格「简化名称与模型去重」去掉 provider 前缀与全部括号附注，所有 CLI 都这样处理。本次不改这个共享展示层；是否在菜单中保留「未核实」标注需要用户决定，属于后续事项。
