## 1. 修复项目目录与错误边界 〔后端｜3h〕

- [x] 1.1 核对真实日志与安装源码，实施 Pi/OMP cwd 和提示约束
  - OMP Worker cca7ca60 的 events.jsonl：seq 11/13 的 write 已显式指定仓库根绝对路径；seq 18/20 的 bash 参数 cwd 为仓库根；seq 131 相对 read 随后在 seq 134 失败。不是从 Bash 结果反推启动目录。
  - 只读分析本机 ~/.local/bin/omp 18.20.2 内嵌源码：cli/startup-cwd.ts 的 Cit 处理 --cwd；tools/bash.ts 使用显式 cwd 或 session.cwd；system-prompt.ts 以运行时 cwd 构造环境。没有发现此链路自动提升到 Git 根的证据。Pi 1.5.2 安装包 main.js 从 process.cwd()/sessionManager.getCwd() 初始化，core/tools/bash.js 与 core/system-prompt.js 沿用该 cwd，无 --cwd 选项。
  - pi-omp-bridge 原已设置 spawn cwd；现 OMP 额外传 --cwd，Pi/OMP 均设置子进程 PWD 和追加项目说明，明确祖先 Git 根不替代 Worker 目录。保留代理环境和原生权限，不引入操作系统沙箱；不改 stray rc0810 文件。
- [x] 1.2 实施工具错误文本与取消对象转换，补模拟回归
  - 修复前在现有 Harness AgentLoop 集成测试中真实复现模拟取消：结构化 { kind: user } 经 throwIfAborted、回执 catch 原样抛出，再由 DSH toolErrorMessage 的 String(error) 变成 Error: [object Object]。这是共享路径，不依赖 Pi/OMP 或 Claude normalizer。
  - OMP 的 seq 134（Path not found）和 seq 237（Command aborted）仍为原生 content 文本块；正常失败此前由 json(output) 包装为整段 JSON。新增 Host 工具错误提取、4096 字符/深度/节点上限和 AbortError 转换；成功结果和原始事件不变，legacy 投影采用相同文本规则。
  - 模拟覆盖嵌套且 gitignored 的含空格项目（首轮和续聊）、OMP 专属 argv、Pi 无不存在参数、PWD/提示一致性；覆盖 OMP/Claude 失败结构、legacy 投影、取消文案与 ABORTED 身份、未知 JSON/循环/超长/不可信 HTML 文本。
- [x] 1.3 执行关联 vitest、typecheck 与严格规格检查，同步 README 和设计
  - 所有 pnpm 命令设置 pnpm_config_verify_deps_before_run=false，保留代理环境，执行参数使用 argv。
  - 修复前定向回归 3 项均如预期失败（取消出现 object Object；两种失败回执显示 JSON）。修复后沙箱内 Pi/OMP 初跑因 listen EPERM 无法监听 loopback；没有改测试绕过限制，获准沙箱外重跑完整文件。
  - 完整 3 文件首轮：184 通过、1 跳过。最终新增 legacy 回归和加强取消身份断言后复跑相关 2 文件：50 通过、1 跳过。最终分别为 pi-omp-adapter 135/135，harness-conversation-stream 40 通过/1 跳过，tool-error-text 10/10，总计 185 通过、1 跳过。跳过项为缺少可选官方 turn-process 源码，不是本次回归。
  - corepack pnpm typecheck 两次通过（最终修改后复查 Host/Client，对 DSH 0.2.2-rc.3）。README、doc/design 已同步；变更严格校验与 git diff --check 通过。
  - Grok 按协调决定不改：既有 raw.jsonl 的 caa18f90 run 第 55 行与 c13d43cd run 第 38 行均返回 HTTP 402 personal-team-blocked:spending-limit。没有读取凭据值，没有真实模型调用，没有构建、更新 lib 或提交。
- [ ] 1.4 主会话统一构建后执行 Desktop 复验
  - 未执行：本次禁止构建和真实模型调用。需在嵌套项目重新验证 OMP/Pi 首轮、续聊的绝对写入路径和 Bash cwd；验证失败卡、停止卡、取消状态与退出清理。Windows Claude 原事件未获取，本次只通过共享路径模拟取消验证，不宣称 Windows 实机根因已直接证实。
  - 提示不是文件系统权限隔离；原生 CLI 仍可按用户明确指令跨目录。旧会话本身记录了错误目录或模型再次显式越界的情况需实机观察。保留本变更未归档。
