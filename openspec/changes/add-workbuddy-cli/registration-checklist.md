# 注册接线对照

以修改前 `grep -rn "qodercn" src scripts tests` 为清单；下表逐文件列出所有命中行号（行号为修改前），说明 WorkBuddy 对应入口或刻意省略理由。未修改 Qoder 的专属协议行为。`scripts/build.mjs` 未命中 qodercn，但已按 onboarding 补齐 WorkBuddy runner、bootstrap、outcome、key-helper 及声明目录所需资源。

| 原文件 | 原命中行 | 对应或省略 |
| --- | --- | --- |
| `src/host/adapters.ts` | 169, 312, 390, 471, 529, 571 | 新增应用包发现、原生桥前置 argv、目录分支及 legacy 拒绝；不复制 Qoder 的 PATH／npm 发现。 |
| `src/host/harness-turn-usage.ts` | 139, 166 | 刻意不追加：Qoder 专属积分、原生日志及上下文协议；WorkBuddy 没有已验证遥测，保持未知。 |
| `src/host/cli-account-binding.ts` | 349 | 追加自验证元数据绑定，不读取凭据文件；不能识别未公开的同站点账号主体。 |
| `src/host/native-qoder.mjs` | 14, 15, 30, 36 | 刻意不追加：WorkBuddy 使用已提交 native-workbuddy.mjs；不复用 Qoder 的 agentInfo、fork、积分或 durable 日志协议。 |
| `src/host/process.ts` | 77 | 追加两项 Executable 配置。 |
| `src/host/native-attachments.mjs` | 7 | 追加两个独立 CLI 入口；列表顺序置于 qodercn 后，原生运行资源由 scripts/build.mjs 打包。 |
| `src/host/routing.ts` | 28, 29, 158, 162, 181, 241 | 追加别名、泛称发现分流与 invocation guidance；显式国际版提示用 WorkBuddy AI。 |
| `src/host/windows-cli-installation.ts` | 33, 42, 59, 159, 237 | 刻意不追加：WorkBuddy 为应用内置 CLI，由 workbuddy-installation.ts 自带 Windows 候选及 product 身份核对；不走 PATH/npm/独立安装器规则。 |
| `src/host/settings-catalog-cache.ts` | 217 | 追加自验证发现；失败仍清空目录，不当作授权缓存。 |
| `src/host/qoder-accounts.ts` | 143 | 刻意不追加：使用已提交 workbuddy-variant／workbuddy-installation 与新的 workbuddy-metadata.ts；不借用 Qoder 账号或环境。 |
| `src/host/qoder-variant.ts` | 1, 5, 7 | 刻意不追加：使用已提交 workbuddy-variant／workbuddy-installation 与新的 workbuddy-metadata.ts；不借用 Qoder 账号或环境。 |
| `src/host/native-harness-injection.mjs` | 8, 47 | 只新增明确不可用理由；故意不加入执行就绪及注入列表。 |
| `src/host/runtime.ts` | 1421, 1671, 1808, 2609 | 刻意不追加：此处各分支为 Qoder 环境、积分与无规划限制；WorkBuddy 环境由已有 runner 处理，规划开放，通用原生桥经 prepareNativeWorker 接线。 |
| `src/host/account-guide/flows.ts` | 16 | 刻意不追加：没有插件登录或退出操作，不使用引导登录窗口。 |
| `src/host/account-guide/single-account.ts` | 79 | 刻意不追加：没有插件登录或退出操作，不使用引导登录窗口。 |
| `src/host/telemetry.ts` | 282, 286, 287, 294, 774, 782, 787, 795, 796 | 刻意不追加：Qoder 专属积分、原生日志及上下文协议；WorkBuddy 没有已验证遥测，保持未知。 |
| `src/host/qoder-durable-context.mjs` | 24 | 刻意不追加：Qoder 专属积分、原生日志及上下文协议；WorkBuddy 没有已验证遥测，保持未知。 |
| `src/host/authorized-catalog.ts` | 46, 54 | 追加单次元数据作用域，合并 binding/catalog 握手；无原生账号 ID，不复制 Qoder 凭据快照。 |
| `src/host/native-bridge.mjs` | 15 | 追加两个独立 CLI 入口；列表顺序置于 qodercn 后，原生运行资源由 scripts/build.mjs 打包。 |
| `src/host/native-supplemental-context.ts` | 99, 109, 112, 131 | 刻意不追加：Qoder 专属积分、原生日志及上下文协议；WorkBuddy 没有已验证遥测，保持未知。 |
| `src/host/accounts.ts` | 123, 125, 127, 128, 179, 430, 438, 856 | 追加原生元数据状态与桌面端指引；不复制 PAT、login/logout 终端逻辑。 |
| `src/host/qoder-durable-context.d.mts` | 1, 2 | 刻意不追加：Qoder 专属积分、原生日志及上下文协议；WorkBuddy 没有已验证遥测，保持未知。 |
| `src/host/index.ts` | 161, 276, 1067, 1068, 1094, 2597, 2654 | 追加配置、泛称安装分流、宿主问题与 selfVerifiedDiscovery；Qoder 分流行为保留。 |
| `src/host/cli-native-capabilities.mjs` | 190 | 追加两个独立 CLI 入口；列表顺序置于 qodercn 后，原生运行资源由 scripts/build.mjs 打包。 |
| `src/host/native-worker.ts` | 28 | 追加两个独立 CLI 入口；列表顺序置于 qodercn 后，原生运行资源由 scripts/build.mjs 打包。 |
| `src/shared/conversation-features.ts` | 36, 51 | 追加 expectedTransport 和不支持分支理由，不复制 Qoder fork 能力。 |
| `src/shared/types.ts` | 27, 49, 66 | 追加两个独立 CLI 入口；列表顺序置于 qodercn 后，原生运行资源由 scripts/build.mjs 打包。 |
| `src/shared/worker-permissions.ts` | 64, 116 | 追加 ASK/AUTO；规划和 view-only 使用默认规则，不加入 Qoder 的 plan 排除。 |
| `src/shared/account-links.ts` | 12, 42, 49 | 只追加 SINGLE_ACCOUNT_CLIS；不追加 GUIDED_ACCOUNT_CLIS／ACCOUNT_LOGIN_HOSTS。 |
| `src/shared/native-usage-report.ts` | 22, 26, 51 | 刻意不追加：Qoder 专属积分、原生日志及上下文协议；WorkBuddy 没有已验证遥测，保持未知。 |
| `src/client/conversation-timeline.tsx` | 127 | 刻意不追加：Qoder 专属积分、原生日志及上下文协议；WorkBuddy 没有已验证遥测，保持未知。 |
| `src/client/telemetry.tsx` | 175 | 刻意不追加：Qoder 专属积分、原生日志及上下文协议；WorkBuddy 没有已验证遥测，保持未知。 |
| `src/client/worker-process.tsx` | 371 | 刻意不追加：Qoder 专属积分、原生日志及上下文协议；WorkBuddy 没有已验证遥测，保持未知。 |
| `src/client/harness-telemetry-data.ts` | 52, 55, 56 | 刻意不追加：Qoder 专属积分、原生日志及上下文协议；WorkBuddy 没有已验证遥测，保持未知。 |
| `src/client/icons.tsx` | 42, 53 | 追加两版彩色本地应用图标及光学参数；不反色。 |
| `tests/cli-account-binding.test.ts` | 329 | 文件凭据夹具排除 WorkBuddy；其自验证登录、站点隔离、失败传播由 workbuddy-registration.test.ts 的模拟原生探测覆盖。 |
| `tests/worker-fork.test.ts` | 23, 140 | 保留 Qoder 专用协议／PAT／积分／fork／npm／Windows 夹具；WorkBuddy 对应注册、路由、目录、权限与 UI 覆盖新增测试，核心引导与平台发现沿用现有 workbuddy 测试，不套用 Qoder 行为。 |
| `tests/windows-cli-installation.test.ts` | 257, 259, 288, 290, 332, 341, 342, 351, 353, 355 | 保留 Qoder 专用协议／PAT／积分／fork／npm／Windows 夹具；WorkBuddy 对应注册、路由、目录、权限与 UI 覆盖新增测试，核心引导与平台发现沿用现有 workbuddy 测试，不套用 Qoder 行为。 |
| `tests/windows-cli-resolution.test.ts` | 507, 508, 512, 513, 515, 516, 522, 567 | 保留 Qoder 专用协议／PAT／积分／fork／npm／Windows 夹具；WorkBuddy 对应注册、路由、目录、权限与 UI 覆盖新增测试，核心引导与平台发现沿用现有 workbuddy 测试，不套用 Qoder 行为。 |
| `tests/qodercn-accounts.test.ts` | 16, 23, 34, 73, 75, 76, 77, 93, 94, 107, 113, 151, 155, 156, 173, 176, 201, 211, 212, 232, 235, 242, 244, 245, 246 | 保留 Qoder 专用协议／PAT／积分／fork／npm／Windows 夹具；WorkBuddy 对应注册、路由、目录、权限与 UI 覆盖新增测试，核心引导与平台发现沿用现有 workbuddy 测试，不套用 Qoder 行为。 |
| `tests/qodercn-integration.test.ts` | 11, 14, 15, 19, 20, 21, 22, 23, 24, 32, 33, 34, 35 | 保留 Qoder 专用协议／PAT／积分／fork／npm／Windows 夹具；WorkBuddy 对应注册、路由、目录、权限与 UI 覆盖新增测试，核心引导与平台发现沿用现有 workbuddy 测试，不套用 Qoder 行为。 |
| `tests/account-terminal.test.tsx` | 1195 | 保留 Qoder 专用协议／PAT／积分／fork／npm／Windows 夹具；WorkBuddy 对应注册、路由、目录、权限与 UI 覆盖新增测试，核心引导与平台发现沿用现有 workbuddy 测试，不套用 Qoder 行为。 |
| `tests/native-fork.test.ts` | 68 | 保留 Qoder 专用协议／PAT／积分／fork／npm／Windows 夹具；WorkBuddy 对应注册、路由、目录、权限与 UI 覆盖新增测试，核心引导与平台发现沿用现有 workbuddy 测试，不套用 Qoder 行为。 |
| `tests/native-harness-tools.test.ts` | 251 | 保留 Qoder 专用协议／PAT／积分／fork／npm／Windows 夹具；WorkBuddy 对应注册、路由、目录、权限与 UI 覆盖新增测试，核心引导与平台发现沿用现有 workbuddy 测试，不套用 Qoder 行为。 |
| `tests/native-qoder.test.ts` | 109, 128, 184, 477, 484, 485, 494, 506, 514, 521, 527 | 保留 Qoder 专用协议／PAT／积分／fork／npm／Windows 夹具；WorkBuddy 对应注册、路由、目录、权限与 UI 覆盖新增测试，核心引导与平台发现沿用现有 workbuddy 测试，不套用 Qoder 行为。 |
| `tests/qodercn-telemetry.test.ts` | 14, 17, 24, 40, 48, 49, 61, 67, 69, 70, 74, 82, 88, 91, 115, 117, 118, 126, 127, 131, 136, 140 | 保留 Qoder 专用协议／PAT／积分／fork／npm／Windows 夹具；WorkBuddy 对应注册、路由、目录、权限与 UI 覆盖新增测试，核心引导与平台发现沿用现有 workbuddy 测试，不套用 Qoder 行为。 |
| `tests/windows-accounts.test.ts` | 139, 143, 194, 195 | 文件凭据／原生退出夹具排除 WorkBuddy；桌面端账号指引、自验证目录及失败由 workbuddy-registration.test.ts 模拟覆盖，Windows 应用安装由已有 workbuddy-installation.test.ts 模拟覆盖；未宣称 Windows 实机验收。 |
| `tests/fixtures/legacy-runtime.ts` | 10 | 追加 WorkBuddy 原生 transport；两版均不存在 legacy 通道，其余旧协议夹具行为保留。 |
| `tests/qoder-routing.test.ts` | 22, 28, 42, 102, 103, 107, 110, 126, 127, 130, 166, 197, 207, 224 | 保留 Qoder 专用协议／PAT／积分／fork／npm／Windows 夹具；WorkBuddy 对应注册、路由、目录、权限与 UI 覆盖新增测试，核心引导与平台发现沿用现有 workbuddy 测试，不套用 Qoder 行为。 |
| `tests/worker-permissions.test.ts` | 580 | 保留 Qoder 专用协议／PAT／积分／fork／npm／Windows 夹具；WorkBuddy 对应注册、路由、目录、权限与 UI 覆盖新增测试，核心引导与平台发现沿用现有 workbuddy 测试，不套用 Qoder 行为。 |

另增：settings-dialog 的试验性及桌面端指引、worker-card 标注、cli-executable-settings 路径说明与 i18n；文档及图标来源见本 change tasks.md。

通用 CLI_IDS 测试另做必要适配：routing.test.ts 用显式 WorkBuddy AI 验证国际版；runtime-account-isolation.test.ts 在已替换账号／目录的夹具中也替换 WorkBuddy 路径，避免发现真实应用；settings-dialog.test.ts 将 WorkBuddy 纳入不显示登录／退出入口的断言。
