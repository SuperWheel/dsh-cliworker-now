# Tasks

## 1. 元数据协议与来源契约 〔后端｜1h〕

- [x] 1.1 核对官方新旧 SDK 协议并补齐 proposal、双品牌增量规格及 design，逐项保留出处
  - 已只读检查 qsdk53/qsdk59 类型与 qsdk59 dist/index.js，并对本机 1.1.89 二进制认证策略作静态核对；结论见 design.md。

## 2. 新旧元数据查询与生命周期 〔后端｜3h｜前置 1〕

- [x] 2.1 实现私有 daemon、版本分流与最多一次协议回退，关联模拟测试覆盖握手、模型、账号、旧 worker 与清理
  - `src/host/qoder-accounts.ts` 支持官方 SDK 1.0.59 daemon / 1.0.53 worker；保留品牌根、.env 拒绝、自定义模型、停用过滤与强度。取消同时清理失败优先保留 ProcessCleanupUnconfirmedError。
  - `corepack pnpm vitest run tests/qoder-accounts.test.ts tests/qodercn-accounts.test.ts` 最终 2 文件、144 项通过；初始旧回归为 117 项，新增 27 项模拟检查。中间 140、141、142 项运行均通过。证据：`.cache/cli-update-research/H-related-final.log`。
  - 模拟覆盖：握手/账号/模型、官方包版本 1.1.73/1.1.80/1.1.81/1.2.0/2.0.0、跨品牌包名拒绝、两向单次回退、双方协议拒绝、提前退出/结束拒绝/坏帧/错误握手/输出超限/尾帧/abort/15与30秒预算、PAT payload 0600、清理未确认及 .env 拒绝；已有 worker 来源绑定回归保持通过。
- [x] 2.2 同步 README、README.en 与 doc/design.md 中的元数据方式并核对差异
  - 已同步两版协议分流、私有查询、结束确认与 ACP 边界；`git diff --check` 通过（使用项目指定 Git 路径）。未修改 Client、CLI 管理模块、版本号。

## 3. 实机只读兼容与交付校验 〔测试｜2h｜前置 2〕

- [x] 3.1 用插件路径验证两版 1.1.89 与 Qoder 1.1.73 元数据，记录脱敏数量、强度、账号和用户目录 mtime 比对
  - 已执行真实只读查询：`corepack pnpm exec tsx .cache/cli-update-research/H-live.ts` 两次（首次操作级快照 3 个进程，第二次独立账号/模型 6 个进程）；ACP 脚本为取得原生已报告模型 ID 另查 2 次。共 11 个元数据进程，全部范围退出确认，私有目录残留 0；其中 9 个退出码 0，2 个由 Host 收尾至 SIGKILL。
  - Qoder 1.1.89：账号已识别，Free；原生模型 16，启用 0、停用 16，其中 13 个声明强度；插件按既有规则拒绝空可用目录。
  - Qoder CN 1.1.89：账号已识别，Free；原生模型 13，启用 1、停用 12，其中 11 个声明强度；插件返回 1 个可用模型，该模型有强度。
  - Qoder 1.1.73：账号已识别，Free；原生模型 16，启用 0、停用 16，其中 13 个声明强度；旧 worker 正常结束，但可用模型目录同样被拒绝。
  - 三轮目录清单均为 1,155 项，新增 0、mtime/大小/模式变化 0、缺失 0。仅比较文件元信息，不输出邮箱、凭据或机器标识。证据：H-live-result.json、H-live-detail-result.json、H-acp-result.json（均在 `.cache/cli-update-research/`）。
  - 首次脚本在写完查询与清理证据后，错误调用 `ctx.dispose()`，退出 1；改用项目现有 `ctx.fiber.dispose()` 后第二次退出 0。此错误不属于 CLI 查询或清理失败，保留首次证据。
  - 尚未完成：国际版新旧入口的“可用模型目录”实机成功验收；当前原生返回全部停用，不能证明可用模型查询成功，不放宽过滤、不更改账号、不移除代理。该项保持不勾选，变更不归档。
  - 2026-11-14 主会话 Desktop 实机（`corepack pnpm build` 后从终端启动 DSH Desktop 0.2.2-rc.3，保留宿主代理变量，内置浏览器直连 Host Web UI）：「CLI 连接」Qoder CN 显示「已登录」、默认模型 Qwen3.8-Flash、强度「默认」，此前的「原生账号查询暂不可用」「原生模型目录暂不可用」消失；Qoder 显示「已登录」，模型区为「Qoder 未公开可用的结构化模型目录」，与上面原生目录全部停用一致。主会话复核：`corepack pnpm typecheck` 通过；`tests/qoder-accounts.test.ts tests/qodercn-accounts.test.ts tests/authorized-catalog.test.ts tests/windows-accounts.test.ts` 4 文件 199 项通过。
  - 国际版可用模型为 0 在 1.1.73 旧入口同样出现，属账号/服务端返回，不是本次协议改动所致；待账号有可用模型后再补这一项。
  - 2026-11-14 11:30 复查：复用原 H-live.ts（仅改相对 import 与证据落点，命令 `corepack pnpm exec tsx .cache/gaps-qoder-live.ts`），退出 0。Qoder 1.1.89 / 1.1.73 仍各 16 个原生模型、启用 0、停用 16、13 个声明强度；账号已识别、Free，插件仍拒绝空可用目录。Qoder CN 1.1.89 为 13 个原生模型、1 个启用，插件返回 1 个带强度模型。本次 6 个元数据进程：3 个退出 0，3 个 Host SIGKILL 收尾，waitForExit 全 true；私有目录残留 0。用户目录 1,161 项前后无新增、缺失或 mtime/大小/模式变化；没有 session/new 或 prompt，没有清除代理。证据 `.cache/gaps-live/H-live-detail-result.json`、/tmp/gaps-qoder-live.log。国际版可用目录仍无法验收，3.1 保持未勾选。
  - 2026-11-15 用户确认此项按现状验收并勾选；上面记录的未执行真实验证照旧保留，不当作已实测。

  - 2026-11-15 本轮复核（macOS，基线 `e096dd4`）：工作树初始实际为 `6c6db88` 且无修改，先 `git merge --ff-only e096dd4` 对齐指定基线。检查 `qoder-variant.ts`、`qoder-accounts.ts`：国际版与 CN 分别绑定 `.qoder` / `.qoder-cn`、`QODER_` / `QODERCN_`、`global` / `cn`；1.1.89 使用 SDK 1.0.59 的私有 stdio daemon，1.1.73 使用 SDK 1.0.53 worker，不复用全局 daemon 或另一品牌端点。模型来自 `daemon.get_models.models`（`fetchStrategy: live`、原生账号 uid）或旧 `initialize.models`，仅 `isEnabled === false` 被过滤，本次未发现插件读取缺陷，未改产品代码或放宽过滤。
  - 本轮命令：`corepack pnpm --config.verify-deps-before-run=false exec tsx .cache/qoder-zero-models/probe.ts`，退出 0。脚本复用既有 H-live.ts，直接调用当前工作树的 `queryQoderAccountInfo` / `discoverQoderModels`；观察解析前原生 stdout，仅投影模型 ID、启用布尔值、强度、字段名和脱敏账号摘要。stdin 白名单仅允许 initialize/account_info/get_models/shutdown/end_session；会话创建、prompt、登录、退出账号、切换账号均 0。探测脚本不自行读取凭据文件内容，认证仍由插件既有路径和原生 CLI 完成；不保存原始响应、邮箱、uid、token、cookie 或机器标识。
  - 本轮结果：Qoder 1.1.89 / 1.1.73 均为已识别 Free 账号，内存比较 uid 相同（仅记录布尔结果）；两入口各返回 16 个模型，启用 0、停用 16、13 个声明强度。16 个 ID、启用标记和 efforts 数组逐项完全一致：`auto, ultimate, fast, efficient, smodel, cmodel, qmodel_latest, qmodel_38max, qfmodel, kmodel_latest, kmodel, gmodel, gfmodel, dmodel, dfmodel, mmodel`。原生 `supportsDisabled` 为 true 的数量新版 13、旧版 5；这是原生版本的强度元数据差异，不影响两版所有模型停用的结果。
  - 本轮 CN 1.1.89：已识别 Free 账号，原生 13 个模型、启用 1、停用 12、11 个声明强度。唯一启用模型 `qfmodel` 原生 efforts 为 `xhigh/low/medium`、`supportsDisabled: true`，插件返回 `default/none/low/medium/xhigh`；其余原生 ID 为 `auto, fast, qmodel_latest, qmodel_38max, dmodel, dfmodel, gmodel, gfmodel, kmodel_latest, kmodel, jmodel, mmodel`。
  - 结论证据：国际版在插件解析前即全部明确停用，CLI 元数据请求本身成功，没有字段缺失、协议失败或启用模型被插件误删；新旧入口结果相同，支持账号侧原生可用性限制，而非本次 daemon 适配缺陷。两版 daemon 模型响应顶层均只有 `models`，模型字段未提供停用原因码；Free 本身不足以断言额度耗尽或必须付费，具体套餐/额度/服务端权限原因仍待官方账号页或支持确认。用户需在 Qoder 国际版确认当前账号的模型使用资格，待原生至少一个模型启用后再刷新插件、补验国际版可用目录；3.1 保持未勾选，不归档。
  - 本轮生命周期及只读证明：6 个元数据进程（4 daemon、2 worker）均退出码 0、signal null、waitForExit true；私有查询目录残留 0。遍历用户 HOME 下 `.qoder*` 根，1,206 项前后相同，新增 0、缺失 0、mtime/大小/模式变化 0，仅 lstat/readdir 比较元信息。代理变量没有覆盖或移除；本次启动环境的常见代理变量原本均未设置，前后保持一致，不冒称验证了“有代理”场景。
  - 本轮证据位于此工作树 `.cache/qoder-zero-models/`：`probe.ts`、`H-live-detail-result.json`、`H-mtime-detail-before.json`、`H-mtime-detail-after.json`（目录元信息清单含本地路径，仅本地保留）。结果 JSON SHA-256：`64516d8b04d25494d74ca211da839bee30a8230026f8cbe0c1c7ecd110b579f7`；脚本 SHA-256：`4c7ef25550c655e10733c814ade00d9e30e1eb3d737a79333442d8ab78cb1308`。
  - 本轮回归：`KIMI_CODE_NO_AUTO_UPDATE=1 corepack pnpm --config.verify-deps-before-run=false vitest run tests/qoder-accounts.test.ts tests/qodercn-accounts.test.ts`，2 文件、145 项通过，均为已有模拟测试；包括全部停用目录、混合启停目录、双品牌、新旧协议与清理。无产品代码修改，不新增模拟夹具；本轮未跑 typecheck、构建、Desktop、真实推理或其他平台。临时复用主仓库 node_modules；pnpm 默认依赖检查因跨根链接拒绝自动安装，显式关闭运行前依赖检查后继续。tsx IPC、Vitest 配置缓存及 Git 元数据写锁在沙箱内被拒绝，相关命令经沙箱外执行完成，未修改实现来绕过测试。`corepack pnpm --config.verify-deps-before-run=false spec validate v0.8.10-qoder-sdk-daemon-leeyl --strict --no-interactive` 与指定 Git 的 `diff --check` 均通过。

- [x] 3.2 两版 1.1.89 ACP initialize 冒烟，记录回执与退出，不建会话不发 prompt
  - `corepack pnpm exec tsx .cache/cli-update-research/H-acp.ts` 退出 0；两版均使用 `workerArguments(..., nativeTransport=true, access=read-only)` 的 ACP/permission-mode/model 参数数组，模型 ID 来自该版原生返回（国际版无启用模型，只验证 initialize，不提交选型/会话/模型任务）。配置与 cwd 均为私有目录。
  - 各发送 1 个 initialize，协议版本均为 1、品牌身份均匹配；session/new 与 prompt 均 0。两进程经 Host SIGKILL 收尾，waitForExit 均 true，私有目录删除均确认。用户目录 1,155 项无变动；证据 `.cache/cli-update-research/H-acp-result.json`。
- [x] 3.3 执行 typecheck、相关测试、沙箱外全量 vitest、build:preview 与严格规格校验，记录确切数字与失败边界
  - `corepack pnpm typecheck`：通过（最终证据 H-typecheck-final.log）；`corepack pnpm build:preview`：通过，隔离包 `.cache/preview-package`（H-preview-final.log）；未运行 `pnpm build`，未更新 Desktop。
  - `corepack pnpm vitest run tests/qoder-accounts.test.ts tests/qodercn-accounts.test.ts`：最终 2 文件、144 项全部通过，27 项新增模拟；证据 H-related-final.log。
  - `corepack pnpm vitest run` 首轮沙箱内：2 文件失败、307 通过、4 跳过；2 项失败、6,976 通过、14 跳过（总 6,992）。失败为 native-process 的 `/bin/ps EPERM` 与 storage-lock 的宿主所有权判断，未修改相关代码，随后按授权沙箱外重跑。
  - 沙箱外首轮：309 文件通过、4 跳过；6,979 项通过、14 跳过（总 6,993），退出 0。最后补充 PAT 与禁止清理失败回退检查后，沙箱外最终：309 文件通过、4 跳过；6,981 项通过、14 跳过（总 6,995），退出 0，125.16 秒。证据 H-full-outside.log / H-full-outside-final.log。两轮均未出现 CodeBuddy 未处理拒绝。
  - `corepack pnpm spec validate v0.8.10-qoder-sdk-daemon-leeyl --strict`：通过。首次发现任务职能“研发”和“前置 无”不合法，修正为项目枚举“后端”与省略无前置后通过；不以校验通过代替 3.1 的业务验收。
  - `/Library/Developer/CommandLineTools/usr/bin/git diff --check`：通过。最终用 Node lstat 与首次清单作精确字符串比对：1,155 项，新增 0、缺失 0、mtime/大小/模式变化 0（H-mtime-final-summary.json）。
  - 日志均在 `.cache/cli-update-research/`；仅脱敏摘要落盘，未打印真实邮箱、令牌、机器标识，代理环境保持继承；未提交 Git，未修改禁止目录。

## 跟进

- 按本次完整证据判定归档条件，任何未完成项保留可见。
- Desktop、模型调用及其他平台不在本次真实验收范围。
