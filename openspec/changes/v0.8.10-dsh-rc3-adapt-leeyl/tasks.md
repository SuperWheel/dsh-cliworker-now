# Tasks

## 1. 差异核对与依赖升级 〔后端｜2h〕

- [x] 1.1 核对 rc.3 是否真实发布并固定来源
  - npm `@deepseek-ai/dsh@0.2.2-rc.3` 发布于 2026-11-13T08:05:45Z，dist-tag `next` = 0.2.2-rc.3，`latest` 仍为 0.2.2-rc.1。本机 `/Applications/DeepSeek Harness.app` 的 CFBundleShortVersionString 为 0.2.2-rc.3，自带 `runtime/cli/bin/dsh --version` 为 0.2.2-rc.3。
  - 官方 tag `dsh-v0.2.2-rc.3` = `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`（从 GitHub 拉取到 rc.2 源码仓库），是 rc.2 的后代，`rc.2..rc.3` 共 6 个提交：`68f83cc992`（CI bubblewrap 缓存）、`bbad94f927`、`ac904e118e`（Windows 安装器重启状态 cwd）、`b8c33a1504`（实验性导入 DeepSeek 官网对话导出）、`4c1cf20cb1`（发版）、`38a6a5c965`（合并）。
- [x] 1.2 rc.2 → rc.3 差异对插件的影响
  - 源码：全仓 515 个文件；四包（ui-session、ui-conversation、ui-subagent、ui-chat）只有 `package.json` 版本号变化；ui-primitives 只新增 `upload-outline` 图标。
  - 已安装 npm 包逐包 `diff -rq`（主仓库 rc.2 安装 vs 本 worktree rc.3 安装，排除 package.json、CHANGELOG、map、README 与 `.bin` 路径垫片），实际变化只有：
    - `dsh-client-ui-primitives`：新增 `IconUploadOutlineRegular`／`IconUploadOutlineMedium`（`lib/index.js`、`types/icons/*.d.ts`）。
    - `dsh-client-ui-workspace`：新增 `workspace.picker` 组件工厂（`SlotFactoryMap`）、`workspace.picker.directoryFlow` 孔位、`WorkspacePickerInput` 类型导出，`DirectoryFlowSlotName` 扩为三项（全部为新增）。
    - `dsh-api-session-controller`：`lib/typert.host.js` 的 `RemoteErrorDetailsMap` 新增 `'deepseekChatImport/owner-only'`。
    - `dsh`：仅 docs（capability-seams、config-catalog、persistence）。
  - 源码另见 ui-sidebar 新增 `sidebar.session.action`（HOC）扩展点、目录选择器与 session-log-export 的内部改动、official-bundles 加入可选的 `dsh-deepseek-chat-import`；插件不依赖这些包。
  - Gateway、Remote、主题 token、ui-slots/renderer、subagent、session、Cordis（仍 4.1.0）无变化。插件对 ui-workspace 只有 `import type {}` 的 SlotMap 合并，新增内容不影响；插件不使用新增扩展点，Host 与 Client 源码无需改动。
- [x] 1.3 开发 SDK pin 升到 0.2.2-rc.3
  - `package.json` 39 个 `@deepseek-ai/dsh*` 精确版本 0.2.2-rc.2 → 0.2.2-rc.3；cordis、schemastery、peer 范围与插件版本 0.8.9 不变。`pnpm-workspace.yaml` 的 339 条发布期限例外改为 rc.3，pnpm 安装时自动补入 1 条 `@deepseek-ai/dsh-deepseek-chat-import@0.2.2-rc.3`。
  - `corepack pnpm install --ignore-scripts --config.confirmModulesPurge=false` 退出 0（27s）。锁文件 `packages:` 段非 DSH 包集合 544 项与改前逐项相同；DSH 系 351 → 352 项（新增 deepseek-chat-import）。
  - `scripts/build-dependencies.mjs` 加入 `'0.2.2-rc.3': '.cache/cliworker-build-deps-022rc3'`。

## 2. 重建随包四包 〔后端｜3h｜前置 1〕

- [x] 2.1 （Codex gpt-6-astra high 实施，主会话复核）在 rc.3 tag 上重建四包
  - 在本 worktree `.cache/dsh-host-source-022rc3` 建 detached worktree（HEAD = `38a6a5c9…`），3-way 应用 rc.2 的 48 文件补丁：0 冲突。导出补丁与 rc.2 逐字节相同（主会话 `cmp` 复核），SHA256 `f4e0b86507dc0d6282427aef46ed7a008779e8b491c9546f029eed4e040832b4`。
  - 独立依赖 `.cache/dsh-host-build-deps-022rc3`（store `.cache/dsh-host-pnpm-store-022rc3`）`install --ignore-scripts` 后 `--frozen-lockfile` 复核通过（991 项供应链策略检查）。非 DSH 变化只有 zod：rc.2 锁同时有 4.6.6 与 4.6.7，rc.3 只保留固定的 4.6.6。依赖链接清单 864 行，0 新增、0 删除。
  - `--prepare-links` 成功，`check-client-types` 四包均退出 0；构建与 `--verify` 通过 630 个文件；vendor 与无参数复核通过 4 包、217 个文件。主会话改 README（去掉绝对路径、修复表格）后重跑 `build-host-extension --target 0.2.2-rc.3 --verify`（630）与 `vendor-host-extensions`（217）均 verified。
  - 主会话复核：`runtime-host` 四包 `package.json` 均为 0.2.2-rc.3；无 `useAnchoredPosition` 引用、无 `.map` 与 `src`；`client.js` 差异仅在压缩行内（构建产物随版本变化）。Codex 审计报告 202 个继承 Host/声明文件与官方 npm rc.3 逐字节一致，ui-chat 鲸鱼图片 21,631 字节保留。
  - rc.2 目标 `--verify` 仍通过 630 个文件；旧 vendor 在独立夹具内通过。
  - 构建脚本 `scripts/build-host-extension.mjs`、`scripts/vendor-host-extensions.mjs` 加入 rc.3 目标（vendor 默认 rc.3）；测试 `tests/build-dependencies.test.ts`、`tests/host-runtime-package.test.ts`、`tests/clean.test.ts` 改为 rc.3，未支持示例移到 rc.4：3 文件 37 项通过。
  - 过程中 2 次 Git 写元数据与 2 次隔离安装因沙箱权限／DNS 失败，相同命令重试成功，详见 `host-extensions/dsh-0.2.2-rc.3/README.md`。
  - （未执行：上游四包 Vitest。）

## 3. 插件验证与文档 〔后端｜2h｜前置 2〕

- [x] 3.1 类型检查
  - 新 worktree 初次 `corepack pnpm typecheck`：Host 通过，Client 报 12 条错误，根因是 worktree 尚无 `lib/`，插件自引用的 `dsh-cliworker-now/remote` 类型不存在（与 rc.3 无关）。在 worktree 内 `corepack pnpm build` 生成 `lib/` 后，`corepack pnpm typecheck` 通过：「Host/Client typecheck passed against DSH 0.2.2-rc.3」；四包重建后再次通过。
- [x] 3.2 全量回归（沙箱外，`--maxWorkers=2`）
  - 四包重建与测试更新后：313 个文件中 309 通过、4 跳过；6970 项中 6956 通过、14 跳过、0 失败（241.93s），无未处理拒绝。
  - 基线（四包未重建时）：313 个文件中 307 通过、2 失败、4 跳过；6970 项中 6953 通过、3 失败、14 跳过。失败 2 项为 `host-runtime-package` 预期的版本不一致；另 1 项 `native-bridge-time-limit`「stops a silent CLI on the idle window…」报 pid 文件 ENOENT（模拟 CLI 未及写入），单独连跑 3 次均 4/4 通过，判定为满载偶发。
- [x] 3.3 隔离预览包
  - `corepack pnpm build:preview` 退出 0，预览包内四个 runtime-host 均为 0.2.2-rc.3。在 `.cache/preview-package` `pnpm pack` 得到 1142 个文件的 tgz，SHA256 `d17ec2b5ac7d150acfce3e43cc2e8655249462af96cd17e8e1bfd2b202e4ffb4`（tgz 放在会话临时目录，未入库）。
- [x] 3.4 文档
  - README 中英文宿主版本行改为 0.2.2-rc.3，验证范围指向本变更；`doc/design.md` 新增 2026-11-14 一节；`doc/native-conversation-host-extension.md` 开头加 rc.3 说明；`runtime-host/README.md` 由 vendor 脚本更新为 rc.3；`host-extensions/dsh-0.2.2-rc.3/README.md` 记录重建过程。AGENTS.md 只有历史发布描述，未改。

## 4. 实机验收 〔测试｜1h｜前置 3〕

- [x] 4.1 隔离 DSH_HOME 端到端（rc.3 宿主）
  - 用 Desktop 0.2.2-rc.3 自带的 `runtime/cli/bin/dsh`，临时 `DSH_HOME`（会话临时目录）执行 `dsh plugin --profile web add --save-exact <预览 tgz>` 退出 0，再 `dsh --profile web --no-open --host 127.0.0.1 --port 0` 启动。`--dump-config` 显示 `cliworker-ui-session/conversation/subagent/chat` 四行均指向该 profile 内插件的 `runtime-host/*/lib/index.js`。
  - 内置浏览器直连：主界面（侧栏、空白会话输入栏）正常；右侧栏「CLI Worker」面板打开显示筛选与空状态；齿轮打开「CLI Worker 设置」，通用页与 17 项 CLI 导航正常；「更新 CLI」页列出 Antigravity、Codex、Claude Code、Kimi、MiMo、ZCode 等版本状态；插件页「已安装插件」显示 dsh-cliworker-now 已启用。全程无白屏，控制台 0 条消息；Host 日志只有启动地址一行，无插件报错。
  - 只做查看，未点击任何更新、登录或派遣；后台预加载为只读探测。结束后停止 Host，`ps` 确认无残留进程；启动日志中的 token 未写入任何文件或记录。
- [x] 4.2 正式 Mac Desktop 加载验收
  - 2026-11-14 主会话：分支合并入 main（`3cca31d`，随后 `930de2e`），`corepack pnpm install --frozen-lockfile` 后 `corepack pnpm build` 退出 0；构建前确认 Desktop Host 无 CLI 子进程，`osascript` 退出 Desktop。Desktop profile 的 `node_modules/dsh-cliworker-now` 软链指向主仓库，构建即生效。
  - 以验收参数启动正式 Desktop 0.2.2-rc.3，内置浏览器直连 Host Web UI：主界面、右侧栏 CLI Worker 面板、「CLI Worker 设置」通用页与 17 项 CLI 导航正常；「更新 CLI」页列出已安装 16 项、全部「已是最新」、未安装 1 项；Claude Code 页显示「Claude 官方账号未登录」（预期，见 vnext-plan-exit-agy-background 7.5），Antigravity 页已登录、默认 Gemini 3.8 Flash／Low。启动日志无插件报错。
  - 真实派遣：主对话（DeepSeek-V4.1-Flash；GLM-5.3-Flash 返回 429 余额不足后切换）派遣 Antigravity 生成 `agy-bg-test/cat.png`，问题卡片选型、终态 completed、文件为 1024×1024 PNG；续聊同一 Worker 生成 `dog.png`（证据见 vnext-plan-exit-agy-background 5.2）。
- [x] 4.3 其余未覆盖项
  - 2026-11-14 Windows 基础部署与启动验收：官方 win-x64 nightly 清单的 rc.3 安装包大小与 SHA-512 均匹配，安装器退出 0，安装后 FileVersion 为 0.2.2-rc.3；安装前确认活动 Worker、账号进程与 Desktop 下 CLI 子进程均为 0。按用户授权只清空 pip Cache，C 盘空间达到 2.5 GiB 门槛后才安装。
  - 将 main `e03db09` 的现有正式构建冻结打包，通过原生 `dsh plugin --profile desktop add --save-exact` 安装；修改前备份 profile 配置及旧插件。独立读回 1142/1142 文件 SHA-256 一致，lib 文件数 918/918，Host SHA-256 为 `d6734ad59b097895ce4894278245f19f79ea36c7f2f7095d1dcc5186b0318ab0`。安装后的汇总脚本因 PowerShell 保留变量名报错，随后独立只读校验通过，未重复安装。
  - 用四个指定验收参数在用户交互会话启动 Desktop，窗口可响应，原生 UI Automation 确认「CLI Worker Now」面板可见；Host stdout 出现 `dsh web:`，无错误或 431，stderr 为空。日志保留 Windows 用户私有 ACL，仅回传端口与安全投影，未取回 token。安全证据位于本地忽略目录 `.test-data/windows-remote/desktop-audit/rc3-e03db09-20261114/`；Desktop 保持运行，未派遣模型任务。
  - Windows 真实派遣受阻：经 SSH 隧道进入 Windows Desktop Web UI 后，主对话只有 zai-coding-cn 的 GLM 系列可选；GLM-5.3 强度「默认」返回 400（始终思考模型），改为 Low 后返回 429「余额不足或无可用资源包」，主 Agent 未能派遣 Worker。用户随后在 Windows DSH 登录 DeepSeek，改用 DeepSeek-V4.1-Flash 后真实派遣 Antigravity（后台子 Agent、5 次审批）与 Claude Code 规划模式均通过，证据见 vnext-plan-exit-agy-background 5.1／5.2。
  - （未执行：Windows 完整界面与权限验收、审批、停止、运行中动画与 Stop、上游四包 Vitest。真实派遣与续聊已在 4.2 用 Antigravity 覆盖一次。）
  - 2026-11-15 Windows 实机（DSH 0.2.2-rc.3，插件 ad2f07f 隔离包；经 SSH 端口转发在 Mac 内置浏览器操作 Windows Host Web UI，主模型 DeepSeek-V4.1-Flash High，标准模式）：新会话要求派遣 Codex 执行 `Start-Sleep -Seconds 120` 命令。主页面先弹出选型卡片「是否沿用 GPT-5.6-Luna · Low · 不使用角色预设？」，选「沿用」提交后，CLI Worker 面板出现 codex-1（gpt-5.6-luna · Low · 运行中），详情页显示 Worker 收到的任务、「已完成分析」、正在调用 powershell 工具及「深度求索中，用时 38 秒」计时。08:03:49 点 Worker 面板停止，Worker 显示「已停止」，主 Agent 回报「运行约 45 秒后收到用户侧停止请求被中断，未跑满 120 秒」；08:03:59 远端复核无 `rc3-stop-check` 命令进程、无新 codex.exe，Host activeWorkers 为 0。Codex 在该权限档位下未触发审批；Windows 审批转交已在 vnext-plan-exit 的 Antigravity 真实派遣（5 次审批）覆盖。
  - 仍未执行：上游四包 Vitest；Windows 上 Codex 审批弹窗（本次命令未触发）。本项保持未勾选。
  - 2026-11-15 Windows Codex 审批弹窗（同一 ad2f07f 隔离包与 SSH 端口转发；主模型 DeepSeek-V4.1-Flash High）：新会话把主对话访问模式设为「仅可查看」，要求派遣 Codex 新建 `rc3-approval-check.txt`（内容一行 `approval ok`），Worker 不单独选档。选型卡片选「沿用」（GPT-5.6-Luna · Low）后，codex-1 状态为「等待审批」，主页面出现「CLI 授权 · codex-1（Codex）请求授权 · 修改文件 · 工作目录 C:\Users\admin\cw081f1\live-codex」卡片，选项为允许一次／本会话始终允许／拒绝。选「允许一次」提交后 Worker 完成。经 SSH 独立核对：文件 12 B，内容 `approval ok\n`，修改时间 11:32:33，近 15 分钟内工作区只改了这一个文件；剩余 9 个 codex 相关进程均属 Codex 桌面应用（ChatGPT.exe）与 Computer Use 中继，没有 DSH 或插件启动的进程。
  - 发现：Worker 的收尾回复说「未能确认文件创建成功：当前工作区权限为只读」，与磁盘实际结果不符（主 Agent 也据实际文件纠正了）。推测是「询问」档下 Codex 以只读沙箱运行、写入经审批提权完成后，它回读判断有误；没有影响产物，暂未处理。
  - 2026-11-15 上游四包 Vitest（主会话在主仓库 `.cache/dsh-rc3-upstream-vitest-20261115/` 建 rc.3 tag 的 baseline 与 patched 两棵树，按 rc.3 锁文件 `--ignore-scripts --frozen-lockfile` 安装；Node 24.22.1；临时配置只排除会清除代理的 `scripts/test-proxy-environment.ts`，`--maxWorkers=2`）。修正前：baseline 四包 122 个文件、2081 项全过（ui-session 30、ui-conversation 914、ui-subagent 121、ui-chat 1016）；patched 128 个文件中 2 个失败，2216 项中 2211 通过、5 失败、0 跳过（ui-session 36、ui-subagent 122 全过；ui-conversation 964 中 3 失败；ui-chat 1094 中 2 失败），失败全在补丁自带用例。四包源码与 rc.2 补丁树除 `package.json` 版本外逐字节相同，判定 rc.2 上同样失败（未另建 rc.2 树运行）。
  - 根因：(1) ui-conversation `input-bar.client.spec.tsx` 3 项为用例过时：上游提交 sink 第 5 个参数是受理回调 `accept`（`input/hub.ts`，上游同文件用例均断言 `expect.any(Function)`），补丁用例只写 4 个参数；实现已正确传递回调，Worker 子会话输入栏的主按钮位置、父会话不可用时保留输入、忙时 Enter/点击投递不受影响。用例补第 5 个参数，其余断言不变。(2) ui-chat「uses one optional proven answer…」的「无证明时答案隐藏」断言过时：上游新增「收起后显示的回复」且默认「全部回复」，默认档答案本就不折叠；夹具 `useProjection` 为普通函数而 `ChatFlow` 为 memo，重渲染前须重新 `setProjection`（同文件 externalRequest 用例的写法；产品中为订阅式钩子）。用例改为显式「仅最终回答」档并在重渲染前重新发布投影。(3) ui-chat 两个顺序断言为实现缺陷：上游把空的 `cliworker-continuation` 提示与答案之后的推理归入同一过程分组，`externalTurnAnswerEntries` 只移动成员全为推理的分组，分组停在答案下方。用户影响：有回答证明的 Worker 回合（插件 Host 仍会注入续接提示）展开过程时，后续推理显示在最终回答之后而非之前；仅显示顺序，不丢内容，默认档答案可见性不受影响。
  - 修复：`external-turn-answer.ts` 允许成员均为本轮推理或解析器已接受的空续接提示、且至少含一条推理的分组整体移到答案前，只有提示的分组不动；新增单元用例。仅改用例、不改实现时 3 项失败（两个顺序用例与新单元用例），证明实现修正必要。修正后（插件工作树内 APFS 克隆的两棵树，同一配置与 Node）：patched 128 个文件、2217 项全过（ui-chat 1095、ui-conversation 964、ui-session 36、ui-subagent 122）；baseline 不变，122 个文件、2081 项全过。
  - 补丁重新导出：48 个文件，SHA256 `e96e40bea9924a54d1058adfdaf16fb9a95864659aec19b12c6dcc480f279439`；源码 `diff HEAD --check` 与补丁反向应用检查通过。构建依赖 `install --ignore-scripts --frozen-lockfile --offline` 退出 0，三文件与仓库记录逐字节相同；`--prepare-links` 与四包类型检查均退出 0；`build-host-extension --target 0.2.2-rc.3`（含更新 README 后 `--replace` 重建）与 `--verify` 通过 630 个文件；`vendor-host-extensions --from …` 与无参数复核通过 4 包、217 个文件。runtime-host：ui-session `client.js` 字节不变；ui-conversation、ui-subagent 仅 CSS Modules 类名前缀不同（类名哈希随构建源码绝对路径变化，逐词比对其余 0 处差异）；ui-chat 除类名前缀外只有分组判断改动。新 SHA256 见 `host-extensions/dsh-0.2.2-rc.3/README.md`。
  - 插件侧：`corepack pnpm build:preview` 退出 0，复制 remote 声明与 `lib/types` 到被忽略的 `lib/` 后 `corepack pnpm typecheck` 通过（DSH 0.2.2-rc.3）；`KIMI_CODE_NO_AUTO_UPDATE=1 corepack pnpm vitest run tests/build-dependencies.test.ts tests/host-runtime-package.test.ts tests/clean.test.ts` 3 个文件 37 项全过，加 `tests/windows-remote.test.ts` 共 4 个文件 65 项全过（首次缺 `lib/types/host/index.js` 时 build-dependencies 1 项因找不到入口失败，补齐构建产物后通过）。
  - 未执行：修正后的 Desktop 加载与界面实机验收（Worker 子会话输入栏、回答与推理显示顺序）、Windows 验证、根项目全量测试。
  - 2026-11-15 主会话合入（f5c1571）后：根项目 `corepack pnpm typecheck` 通过，全量 `KIMI_CODE_NO_AUTO_UPDATE=1 corepack pnpm vitest run` 341 文件中 337 通过、4 跳过，7910 项中 7896 通过、14 跳过、0 失败（145.26 秒）。重建的四包随 277751b 装到 Windows（隔离包，逐文件校验通过）与 Mac（正式构建）Desktop，两端插件界面正常加载、设置与账号窗口可操作。仍未执行：「回答之后又有推理」的 Worker 回合在实机上的显示顺序（需要恰好出现该时序，无法主动构造），本项保持未勾选。
  - 2026-11-15 用户确认此项按现状验收并勾选；上面记录的未执行真实验证照旧保留，不当作已实测。
