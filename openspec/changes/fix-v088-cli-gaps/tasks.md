## 1. 用量与积分（CodeBuddy、WorkBuddy CN、WorkBuddy）

- [x] 1.1 新增 `src/host/codebuddy-durable-usage.mjs`：按会话、用户消息、请求 ID、cwd 与模型定位本轮，按 `messageId` 去重汇总 token 与积分；有子 Agent 或缺积分时积分为未知。
- [x] 1.2 `native-codebuddy.mjs` 与 `native-workbuddy.mjs` 用 `codebuddyUsageOnResult` 在 `end_turn` 后读取并发出 `cliworker.codebuddy_usage` 回执；WorkBuddy 用安装探测得到的配置根。
- [x] 1.3 `telemetry.ts` 白名单与提取：回执的 CLI、来源、会话、模型须与本 Worker 一致；token 不当积分。`CREDIT_BILLED_CLIS` 统一显示积分的 CLI；TRAE CN 继续显示 token。
- [x] 1.4 WorkBuddy 两版补 `usage_update` 上下文统计。
- [x] 1.5 `scripts/build.mjs` 打包新资源与类型声明。

## 2. 分支

- [x] 2.1 CodeBuddy、WorkBuddy 两版仍不支持分支，理由改为实测结论（CodeBuddy ACP `session/fork` 返回 Method not found；WorkBuddy 内置 CLI 未实现）。TRAE CN 已支持，未改。

## 3. Desktop 验收问题

- [x] 3.1 拒绝审批结束的结果说明作为“本轮结果说明”行投影到 Worker 窗口。
- [x] 3.2 设置页左栏 WorkBuddy CN 与 WorkBuddy 名称下加“试验性”，同步 `doc/settings-ui-design.md`。
- [x] 3.3 WorkBuddy 桌面管理复开：`start()` 等上一会话停止与该 CLI 的状态查询结束；Client 显示已知 Host 原因。页脚按钮不折行、说明可换行。
- [x] 3.4 派遣与续聊结果写明本轮实际权限档位及来源（受理时确定），档位规则不变。

## 4. 自动检查（2026-11-08，macOS）

- [x] 4.1 新增或修改的回归测试（均为模拟数据）：
  - `tests/codebuddy-usage.test.ts`：25 项，覆盖汇总去重、免费积分为 0、缺积分与子 Agent、7 类拒收、项目键（含超长路径）、私有文件读取与等待落盘、runner 钩子、积分/token 呈现划分、来源交叉拒收、WorkBuddy 版本隔离与上下文、白名单脱敏、分支理由。
  - `harness-conversation-stream`（结果说明行）、`settings-dialog`（试验性标记）、`workbuddy-desktop`（停止中复开、等待状态查询）、`workbuddy-desktop-window`（已知原因中英文、页脚样式）、`worker-permissions`（权限回执）、`sibling-dispatch`（派遣结果附档位）。
  - 分支理由文字同步更新于 `codebuddy-integration`、`workbuddy-registration`。
- [x] 4.2 关联回归 47 个文件：1382 项通过、1 项跳过、0 失败（codebuddy/workbuddy/traecn/qoder 全部、telemetry 系、harness-conversation 系、harness-turn-usage、native-acp、settings-dialog、client-i18n、sibling-dispatch、worker-permissions 等）。
- [x] 4.3 `corepack pnpm build:preview` 通过，产物 `.cache/preview-package`。
- [x] 4.4 类型检查：本 worktree 无 `lib/`，直接 `corepack pnpm typecheck` 时 Client 报 11 条错误，均源于自引用包 `dsh-cliworker-now/remote` 无法解析（环境问题）；在隔离包内 `node scripts/build.mjs --typecheck-only` 退出 0（Host 与 Client 均通过）。
- [x] 4.5 `corepack pnpm spec validate --all --strict --no-interactive`：62 项通过、0 失败；`git diff --check` 通过。
- [x] 4.6 未运行全量 vitest 与 `pnpm build`（Desktop 链接主仓库，按要求不跑）。

## 5. 未验证

- [ ] 5.1 改动后的真实端到端运行：未用 `hy4free` 跑 CodeBuddy/WorkBuddy 新版插件确认积分行显示（只在改动前做过一次 CLI 直接探测）。
- [ ] 5.2 付费模型的积分数值：实测仅有 `hy4free`（credit 为 0），非零积分的汇总只由模拟用例覆盖。
- [ ] 5.3 拒绝审批结束的轮次不读取用量（只在 `end_turn` 读取），这类轮次的积分显示为未知。
- [ ] 5.4 Desktop 复看：试验性标记、桌面管理复开与英文页脚、结果说明行、派遣结果档位均未在运行中的 Desktop 复看（按要求不动运行中的 DSH Desktop）。
- [ ] 5.5 桌面管理复开失败的根因为代码推断（状态读取或上一会话停止未完成导致 `reserve()` 拒绝），未在 Desktop 上复现确认。
- [ ] 5.6 Windows、WorkBuddy 国际版、CodeBuddy 国际站均未验证。
