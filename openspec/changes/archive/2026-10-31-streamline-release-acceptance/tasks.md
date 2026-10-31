# Tasks

## 1. 收敛发布验收

- [x] 1.1 Windows CI 定向文件由 7 个扩到 17 个（新增本轮 Windows 账号、进程、CLI 解析、Codex 启动、系统代理、OpenCode/ZCode/Grok、agy 目录、ACP 与账号引导测试），同步远程脚本、工作流与 `doc/windows-remote-testing.md`。
  - `pnpm exec vitest run tests/windows-remote.test.ts`：28 通过。
- [x] 1.2 更新 development-workflow 规格、发布模板、`doc/openspec.md` 与 `AGENTS.md` 中的验收与版本描述。
  - 已改写规格要求与三个场景，删去写死的 v0.8.1；`pnpm spec validate streamline-release-acceptance --strict` 通过。
- [x] 1.3 按新范围完成 v0.8.5 发布验收并记录结果（2026-10-31，用户批准以 v0.8.5 发布到 GitHub 与 npm）。
  - macOS（`a5359fb`）：`typecheck` 通过；全量 `pnpm test` **250 文件通过、4 跳过；5415 通过、0 失败、14 跳过**；`spec:check` 51/51；`git diff --check origin/main` 通过（排除 rc.5 原样引入的 `source.patch`，其中行尾空格属于补丁内容）。
    - 第一轮全量（`cc67cfb` 之前）有 1 项超时：`native-primary-runners` 的 Antigravity「不把失败提升为成功」组合单独运行就要 9.1 秒，原因是每个场景先跑一次 `--help` 模式探测，进程数是 Codex/Claude 的两倍；时限改为 20 秒（只改测试）。
    - `a5359fb` 第二轮全量与 Windows 远程验收在本机并发，3 项依赖时序的模拟进程用例失败；这 3 个文件单独连跑 3 次均 56/56 通过，远程验收结束后的第三轮全量全部通过（即上面的数字）。
  - Windows 远程（`test:windows:remote`）：run `37bf3040`（`22c1c62` 同源）与 run `9259c211`（`a5359fb`）均为隔离 preview、冻结依赖、typecheck、17 个 Windows CI 文件 **302 通过、1 项 POSIX 跳过**、包检查与 Host 加载通过，success/cleanup.confirmed/cleanup.lockReleased 为 true，modelCalls 0。
  - macOS Desktop（正式构建，Codex Computer Use gpt-6.1-sol high 操作）：通用设置四项与 13 个 CLI 页齐全。Antigravity 在 `cliworker-isolation-test` 新会话经 ACP 真实派遣（Gemini 3.8 Flash · Low），`pwd` 与写文件后续聊读回，两轮 SUCCESS，事件有「Antigravity ACP 原生模型已确认」；磁盘文件内容与回复一致。Mac 上 Worker 为「自动审批」，命令在原生沙箱内执行，没有审批卡。OpenCode 页在 Host 刚启动、13 页并发识别时报一次「The operation was aborted due to timeout」，点「刷新模型」后恢复（GLM-5.3、GLM-5.3-Flash）；原生 `opencode models` 1.5 秒。
  - Windows Desktop（原生安装器，726/726 个 lib 文件匹配）：
    - `22c1c62` preview：Antigravity 两条命令在主对话页弹审批卡，续聊时在子会话原生审批面板弹出，均「允许一次」后执行；续聊 `session/load` 同一 ACP 会话；产物核对一致。发现审批卡命令显示两遍（标题与正文相同）。
    - 修复为 `a5359fb`（标题即命令时不再重复正文，只改 `native-acp.mjs`，新增单测，撤掉修复时单测失败）。`a5359fb` preview 复查：主页面审批卡只显示一次命令，`Set-Content` 写出的文件核对一致。
    - 其余观察，不是插件缺陷：PowerShell 5.1 的 `>` 写出 UTF-16LE，agy 自带 `read_file` 读失败一次后自行改用 `Get-Content`；续聊轮的 `session/load` 回放两次历史（`selectAgyAcpModel` 先 load、set_model 后再 load 回读），没有转成重复事件。
  - 打包：`scripts/package-release.mjs` 生成公开清单，系统 npm `--ignore-scripts` 打包为 `dsh-cliworker-now-0.8.5.tgz`，937 个文件、18719301 字节，SHA256 `5cf1957e59e3a35c4511a0fdb278161b5ce6179ecbce90416f1e8d7858223848`。扫描未发现私人路径、IP、`doc/local/`、`.test-data/` 或账号标识；repository/homepage/bugs 指向 `SuperWheel/dsh-cliworker-now`，无 scripts/devDependencies。官方 dsh 0.2.1-rc.5 隔离 profile `plugin add`：exit 0，版本 0.8.5，`lib/index.js`、`lib/native-acp.mjs`、`lib/client.js` 与正式构建逐字节相同。
  - 未验证：其余 CLI 没有在最终包上重跑真实调用，沿用发布前逐项修复时的真实记录；换到另一个账号后的续接；`a5359fb` 后子会话原生审批面板和其他 CLI 的 ACP 审批卡；Windows 隔离 HOME/TEMP 全量 vitest（已不作为发布门槛）。
