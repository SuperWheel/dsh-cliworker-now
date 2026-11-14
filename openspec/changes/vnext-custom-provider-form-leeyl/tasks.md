# Tasks

## 1. 协议与 Host 原生写入 〔后端｜6h〕
- [ ] 1.1 核实各 CLI（Pi、OMP、OpenCode、Hermes、Kimi、TRAE CN）自定义服务商的原生格式、位置与命令，design.md 记录证据与取舍
- [ ] 1.2 `src/shared/custom-provider.ts` 协议与 Host Remote：表单描述、提交、校验
- [ ] 1.3 各已核实 CLI 的原子写入、凭据保护与缓存作废，模拟测试覆盖成功、冲突、校验失败、写入失败回滚

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
- [ ] 3.1 typecheck、关联测试、全量 vitest、严格校验
- [ ] 3.2 Mac Desktop 实机：Pi 等已核实 CLI 的表单显示与写入（使用测试用服务商与测试密钥，不调用模型）
- [ ] 3.3 README、doc/design.md 同步
