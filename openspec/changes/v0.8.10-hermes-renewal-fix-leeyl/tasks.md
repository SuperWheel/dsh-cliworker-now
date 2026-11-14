# Tasks

## 1. Hermes 续期契约修复 〔后端｜2h〕
- [x] 1.1 只读核对当前原生接口及账号状态，定位 unavailable 分支
  - 证据：本机源码 commit `3b421578588243f920886e6fe79a6faa87ea026e`；签名探测确认 `_write_shared_nous_state` 必需 `renewal`，旧调用绑定 TypeError；插件既有读取路径返回 configured、expired=true、hasRefresh=true、poolCount=1，未输出凭据。
- [x] 1.2 实现新旧共享写入契约检查并以模拟回归验证根因与失败边界
  - 证据：新增 5 项明确标记「模拟」的测试；修复前 `corepack pnpm vitest run tests/hermes-nous-refresh-native.test.ts -t '模拟 Hermes 0.23.1'` 两项均以 unavailable 失败；修复后关联 6 文件 149 项通过（含 Python helper 40 项、Host 回执/取消/清理与账号路径回归）。
  - 命令：`corepack pnpm vitest run tests/hermes-nous-refresh-native.test.ts tests/hermes-renewal.test.ts tests/hermes-nous.test.ts tests/hermes-accounts.test.ts tests/hermes-integration.test.ts tests/hermes-installation.test.ts`。
- [x] 1.3 同步 README、doc/design.md 与增量规格，严格校验通过
  - 证据：README 续期说明、doc/design.md 版本依据与接口取舍已同步；`corepack pnpm spec validate v0.8.10-hermes-renewal-fix-leeyl --strict` 通过；`git diff --check` 通过。
  - 工具记录：依赖缺失时执行 `corepack pnpm install --frozen-lockfile --prefer-offline` 成功；`corepack pnpm spec:list` 因脚本内部裸 pnpm 不在 PATH 失败，改用等价 `corepack pnpm spec list` 成功，未改脚本或系统配置。

## 2. 集成与真实续期验收 〔测试｜1h｜前置 1〕
- [ ] 2.1 执行类型检查、相关 vitest、沙箱外全量 vitest 与隔离 preview，记录实际结果
  - 执行已完成，整体验收尚未通过，保留未勾选：`corepack pnpm vitest run` 沙箱外退出 1，314 文件中 305 通过、5 失败、4 跳过；7050 项中 7015 通过、21 失败、14 跳过，耗时 621.07 秒。
  - 全量失败分布：`pi-omp-adapter.test.ts` 14 项（主要超时、另有退出码/模拟文件缺失）；`native-bridge-time-limit.test.ts` 3 项（模拟 PID 文件缺失/控制通路关闭）；`build-dependencies.test.ts` 2 项（工作树缺生成入口）；`native-agy-acp.test.ts` 1 项（模拟记录文件缺失）；`cli-management-acceptance-fixes.test.ts` 1 项（Pi 1.5.2 路径已解析而测试期望拒绝）。不修改这些范围外文件。
  - `corepack pnpm typecheck` 首次因新工作树缺 `lib/typert.remote-client.d.ts` 失败；`corepack pnpm build:preview` 成功后，仅复制其生成声明到本工作树 lib，复跑类型检查通过（DSH 0.2.2-rc.3）。未运行正式 build，未更新 Desktop 链接。
  - 构建依赖复验：从 preview 复制两份生成 JS 入口到本工作树 lib 后，`corepack pnpm vitest run tests/build-dependencies.test.ts` 15/15 通过。未改源码或宿主链接。
  - 范围外独立复跑：`corepack pnpm vitest run tests/native-agy-acp.test.ts tests/cli-management-acceptance-fixes.test.ts tests/build-dependencies.test.ts tests/native-bridge-time-limit.test.ts --maxWorkers=1`（沙箱外）87 通过、8 失败；Antigravity 失败在不同探测用例间波动，不能声称稳定通过。
  - 基线对照：用 `git archive HEAD` 导出 f510f75 到忽略的临时目录，复跑 `Pi auto 迁移|stops a silent CLI|normal 规划始终`，1 通过、2 失败、77 跳过；Pi 路径断言和原生桥接 PID 缺失在基线也重现。基线单独跑 `零输入沙箱报告`，4 失败、41 跳过；只证明这些基线失败，不推定全部 21 项均为已知问题。
  - Pi/OMP 抽样复验：沙箱外 `corepack pnpm vitest run tests/pi-omp-adapter.test.ts -t 'rejects a model that disagrees after native selection' --maxWorkers=1` 为 2 通过、126 跳过，说明这两项全量超时未独立复现；其余 Pi/OMP 失败未逐项复验，不声明全部恢复。
  - 沙箱内首轮因 `/bin/ps` EPERM 与原生进程相关失败未得到完整总数，终止仅持有该测试日志的两个进程后沙箱外复跑；不把首轮算作完整验收。诊断/测试日志位于忽略目录 `.test-data/hermes-renewal-fix/`。
  - 严格规格全量校验：`corepack pnpm spec validate --all --strict --no-interactive` 37/37 通过。
- [x] 2.2 经插件路径执行一次真实续期并读回状态，确认到期时间和共享镜像；终止鉴权错误则停止并记录需重登
  - 证据：Mac 原生账号经 `ensureHermesNousFresh` → nativeProcessBackend/LocalSubprocessRuntime → 固定 helper 成功完成一次续期；脱敏结果 renewalState=ready、state=authenticated、expiryAdvanced=true、unexpired=true、launches=1、exitCode=0、rangeExited=true。
  - 独立读回：插件既有读取路径确认 state=authenticated、expired=false、poolCount=1；固定 helper 读取共享状态确认 sharedIdentityMatches=true、sharedOlder=false、pairMatches=true。未输出任何令牌、主体或邮箱。
  - 环境记录：沙箱内预尝试返回 unavailable，带禁止刷新/写入断点的脱敏追踪定位 `hermes-native-entry.py:43` 打开安装锁 PermissionError，尚未进入 OAuth 刷新。经提权在沙箱外执行上述唯一真实兑换；未取消或重试已发出的请求。诊断脚本首次释放 Context 使用了不存在的 dispose，已改为 SDK 的 fiber.dispose，原生进程此前已确认退出。

## 跟进
- 全量验收失败仍待负责模块处理，当前不归档，不以严格格式校验隐藏缺口；本地提交带指定共同作者，不推送。
- 未执行：Desktop UI、正式 build、Windows 实机、模型调用；用户限定本次不更新 Desktop，未授权模型选型。
