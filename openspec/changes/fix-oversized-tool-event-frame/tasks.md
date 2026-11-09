## 1. 实施

- [x] 1.1 修复共享出站降级，核对其他 runner 覆盖及 assistant 边界。
  - 仅修改 `native-transport.mjs` 的 output() 分支：所有 toolCall 字符串按 cutBytes 裁剪；仍超限则白名单摘要、缩小 text、最后尝试最小摘要。实际帧检查含换行和 JSON 转义。
  - `rg -n 'command:' src/host/native-*.mjs` 与源码核对：Codex 的 item.command、Claude 的 block.input.command、Antigravity 的 info.parameters.CommandLine、native-session-http 的 state.input.command 均可能无界；后者供 OpenCode/MiMo 使用。native-bridge 统一创建 createNativeIO，均受本修复保护，不改各 runner。
  - assistant 维持原有帧错误：不静默改变回复正文或造成流式内容与最终 response 不一致。未改变入站上限、权限、生命周期和 CLI 失败处理。
- [x] 1.2 添加超大 command、多字符串、小预算、最小帧和 Codex 模拟协议回归。
  - `tests/native-transport.test.ts` 新增 6 项（5 个测试名称，其中小预算参数化为 2 项）：
    - `summarizes an oversized tool command without failing the turn`
    - `bounds every string in oversized tool metadata without splitting UTF-8 characters`
    - `reduces escaped tool events to a summary within a %i-byte frame`（256、4096）
    - `emits the smallest summary when it fits and rejects only a smaller frame budget`
    - `keeps ordinary tool frames intact and retains the assistant frame guard`
  - `tests/native-output-budget.test.ts` 新增 1 项：`keeps Codex running after an oversized command event and preserves its native tool failure`。模拟 1,269,672 字节命令开始、失败完成及后续 assistant 回复，验证工具 FAILED、终态 SUCCESS、command 有界前缀和最大实际帧字节数。
- [x] 1.3 同步 README、设计文档并评估图片摘要影响（不实施）。
  - README.md 增加超长命令/元数据摘要说明；doc/design.md 在输出预算章节增加逐级降级和 assistant 边界；保留两文件已有其他修改。
  - 图片评估：`native-codex.mjs` 的 publicTool 将 item.result 原样投影为 toolCall.output；toolDetail 已移除 result，io.native 已对大字符串保留大小，公开 output 仍经展示预算裁至约 256 KiB。因此可在 Codex imageGeneration 完成投影处改为小对象（原生实际提供的 savedPath + 图片 bytes），不影响完成/失败判断，也无需改共享预算。
  - savedPath 必须来自核实的原生字段；本仓库现有图片夹具只有 result/status/failure，尚不能证明当前 CLI 总会提供 savedPath。缺失时应明确路径未知并只保留大小摘要，不能猜路径或声称已落盘。大小需区分 base64 文本字节与解码后的图片字节，依据完整原始结果在截断前计算；无需为计数分配完整解码 Buffer。
  - 影响链：Codex 投影、模拟图片协议用例、public-tool-projection 兼容旧 detail 的路径（如需同样处理历史）、events.jsonl 新记录及 Host/Client 工具回执显示。现有 output 支持对象，可复用通用 JSON 展示；专门的路径按钮/图片预览才需要额外 UI 与文件访问边界设计。已有日志不会自动缩小；写图文件与历史迁移不应并入这一小修复。本次未实现图片摘要，也未读取真实图片日志核验字段。

## 2. 自动检查

- [x] 2.1 运行关联 Vitest，记录命令及通过/失败数量。
  - 修复前：`corepack pnpm vitest run tests/native-transport.test.ts -t 'summarizes an oversized tool command|bounds every string|reduces escaped tool events|emits the smallest summary|keeps ordinary tool frames'`：5 失败、1 通过、18 未选中；5 个失败均复现 Native bridge frame exceeds limit。
  - 修复后：`corepack pnpm vitest run tests/native-transport.test.ts tests/native-output-budget.test.ts tests/native-primary-runners.test.ts tests/native-harness-tools.test.ts tests/native-fork.test.ts tests/codex-run-usage.test.ts`。
  - 沙箱首次运行：4 文件通过、2 失败；231 项通过、34 失败、2 个未捕获错误。native-harness-tools 的 32 项为 listen EPERM 127.0.0.1，native-output-budget 的 2 个 HTTP/SSE 用例因同一监听错误超时；没有修改测试规避沙箱。
  - 获准沙箱外执行同一命令：**6 文件、265 项通过，0 失败、0 跳过**，43.96 秒（2026-11-06，本机 macOS）。全部使用模拟进程/协议/本地服务，未启动真实 CLI 或调用模型。矩阵覆盖所有直接引用 native-codex 的现有测试文件。
- [x] 2.2 运行 typecheck，区分本修复与其他未提交修改的错误。
  - `corepack pnpm typecheck`：退出 0；Host/Client typecheck passed against DSH 0.2.2-rc.1。无本修复或其他工作区类型错误；仅 typecheck-only，没有生成 Desktop 构建。
- [x] 2.3 运行变更 status、严格 spec:check 与限定文件差异检查。
  - 环境：直接 `pnpm spec new change fix-oversized-tool-event-frame` 失败（pnpm 不在 PATH）；通过已安装 Corepack 调用缓存的项目锁定 pnpm 11.25.0，`corepack pnpm spec new change fix-oversized-tool-event-frame` 成功。后续使用 `corepack pnpm` 或仅当前命令的 Corepack shim PATH，不安装依赖或更改系统设置。
  - `corepack pnpm spec instructions design --change fix-oversized-tool-event-frame --json`：成功读取设计规则；`corepack pnpm spec status --change fix-oversized-tool-event-frame`：4/4 规划产物齐全（不代表真实验收）。
  - `corepack pnpm spec:check` 首次失败：脚本内部调用 pnpm，PATH 中没有命令。随后仅给当前命令加入现有 Corepack shim：`PATH=/opt/homebrew/lib/node_modules/corepack/shims:$PATH pnpm spec:check`，严格 `validate --all --strict --no-interactive` **53 通过、0 失败**。另有现存 release-v078-latest-install 的重复 ADDED 归档提示，非本变更错误，未修改。
  - `/Library/Developer/CommandLineTools/usr/bin/git diff --check -- src/host/native-transport.mjs tests/native-transport.test.ts tests/native-output-budget.test.ts README.md doc/design.md`：退出 0。
  - 最终文档核对后 `corepack pnpm spec validate fix-oversized-tool-event-frame --strict --no-interactive`：退出 0，变更有效；限定文件 diff --check 再次通过。

## 3. 未执行验证

- [x] 3.1 真实 Desktop / CLI / 模型复验超大命令降级路径（部分完成，超大帧路径仍未真实触发）。
  - 2026-11-09：用户决定按已完成关闭；本项没有补做上文所列的真实验收，原记录保留。
  - 修复前实测（2026-11-06，Mac，Codex 0.162.1，gpt-6-luna low，Worker `70f3e734…`）：两次 imageGeneration 成功后，模型发起 1,269,672 字节的 commandExecution，插件抛 `Native bridge frame exceeds limit`，整轮 failed。
  - 修复后实测（Desktop 加载正式构建，Worker `441c232a-0f11-48b8-a85c-4f9763db6d4a`）：两次 imageGeneration 后模型改用 `cp` 复制，命令 exitCode 0，终态 completed；`blue-square.png` 950490 字节、PNG 1254×1254，与 savedPath 原图逐字节一致。本轮命令不超长，降级路径未被真实触发，仍只有模拟回归覆盖。
- [x] 3.2 隔离构建、正式构建、Desktop 链接更新及其他平台复验（Mac 部分完成，其他平台未执行）。
  - `corepack pnpm build:preview`、`corepack pnpm build`（先退出 Desktop）均完成，两份产物均含新降级代码；Desktop 以 link 加载后正常启动。Windows 未复验。
  - 不提交、不修改版本号；保留活动变更，未验证项不勾选、不以归档隐藏。
  - 2026-11-07（v0.8.7 发布验收，主会话）：本修复随提交 13fe940 进入 0.8.7。Windows 远程隔离 run b85f6939（79756f7）preview、冻结依赖、typecheck、17 个 Windows CI 文件 308 通过 / 1 跳过与 Host 加载通过；GitHub CI 42228929297 通过。正式构建 747 个程序文件与隔离构建一致；发布包（SHA256 `b270308a…46ae`）经原生安装器装入 Mac 隔离 profile 与 Windows Desktop，文件逐字节一致，两端 Desktop 只读界面核对通过。3.1 仍未执行（真实 CLI 未触发超大帧路径）。
