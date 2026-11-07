# Tasks

> **状态：阻塞：需要豆包企业或团队订阅账号，用户无此身份（2026-11-07）。**
> 协调会话 2026-11-07 决定本期“只调研、不实现”：不写功能代码，不改共享注册清单，不新增 CliId，只提交本变更目录。第 2 节起全部未开始，不得在阻塞解除前勾选、同步主规格或归档。

## 0. 调研与形态判定（不需要登录的部分已完成）

- [x] 0.1 通道调研（只做元数据与非模型探测，未发送 prompt）
  - 2026-11-07，macOS arm64，`doubao 2.31.3`。结论与来源见 `proposal.md` 调研表、`design.md`「通道选择」。
  - 检索 `current/resources/js_app/*/main.js`：`entry-cli-router` 实现了 `text`/`json`/`stream-json`；原生前端固定 `output_format: "text"`。
  - `doubao --output-format stream-json -p x` → 退出码 2，`invalid_arguments: 未知命令或选项`。
  - 文本模式：会话行 `{"type":"session","session_id":…}` 写 stderr；正文在结束时写 stdout；非交互下审批请求被自动拒绝；需要回答的交互以 `interaction_required` 结束。
  - `--service-start`：`services.dispatch` → `entry-cli-chat`，经字节 WebSocket 推送通道接收远程任务，本地无监听端口。未实际运行：会注册远程派发服务，且需要登录。
  - 内部 IPC：Mojo 接口（`ServiceControl`、`AuthControl`、`SessionEvents`、`ShellApiEvents` 等），只监听 `control/js-service.sock`（0600），有对端校验（`untrusted_peer`）。`auth status` 运行期间，`lsof -U` 只见该套接字，`lsof -i` 只见到本机代理 7897 端口的出站连接。结论：非公开内部协议，不可作接入通道。
  - 用户数据目录 `~/Library/Application Support/doubao_cli/`：`aha_net/`、`app/`、`control/`（锁与套接字）、`crash-monitor/`、`doubao-cli-pc-login/`（`account`、`device`、`generation`、`session`；只看了名称与大小，未读取内容）、`logs/`。没有本地会话记录文件，会话存于云端。
  - 共享服务 `--type=service` 与 `crashpad-handler` 各自独立进程组，CLI 退出后被 init 收养，空闲约 10 秒自行退出。每次探测后用 `ps`/`pgrep` 核对，均无残留（最后一次核对：19:21）。
  - 退出码与 stderr：0（`--version`）；2 `invalid_arguments`（未知选项、`-p` 后空提示词、`--resume` 与 `--list` 同用）；4 `login_required`（`auth status`、`auth status --verify`、`--list`、`-p`，消息为“豆包 CLI 需要企业账号…”）；7 `conflict`（用户扫码期间：“正在切换账号，请稍后重试”）。原生错误格式为 `<code>: <消息>`，stdout 为空。
  - 参数顺序 `[--resume id] --permission-mode always_allow -p x` 在原生层通过（停在登录检查，退出码 4）。原生层先做登录检查，所以 JS 层的取值校验（如 `--permission-mode bogus`、`--effort High`）在未登录时无法验证。
  - 自动模式安全分类器拒绝了含 `--dangerously-bypass-approvals-and-sandbox` 的参数顺序探测（理由：Safety Bypass Flag）。未绕过，该参数的原生解析未实测。
- [x] 0.2 形态判定：只找到国内版，单 CliId `doubao`、单账号。
- [ ] 0.3 **阻塞**：账号门槛。用户 19:05 扫码登录后被服务端拒绝（`login_required: 豆包 CLI 需要企业账号`），并确认没有豆包企业或团队身份。门槛由服务端判定（`/alice/dispatch/setting/user`、`passport_enterprise_user_type`），没有本地开关。
- [ ] 0.4 拿到账号后先复核（不发 prompt，或在用户批准模型后再做需要 prompt 的项）：
  - `auth status` 成功时的输出与退出码；
  - `--list` 的文本格式与会话 ID 字符集；
  - JS 层对 `--permission-mode always_allow`、`--dangerously-bypass-approvals-and-sandbox` 的接受情况（后者需用户在本会话授权后执行）；
  - 未知 `--model` 的报错格式；
  - 获用户模型授权后：一轮 `-p` 的 stderr 会话行、stdout 正文、退出码；`--resume` 回执；SIGINT 后是否输出 `Cancelled.` 并在宽限内退出；`always_allow` 下改文件是否生效；进程组与共享服务退出时间。
  - 复核结果与 `design.md` 冲突时，先修订 design 与增量规格，再编码。

## 1. OpenSpec

- [x] 1.1 创建 `openspec/changes/add-doubao-cli/`（proposal、design、`specs/doubao-cli`、`specs/worker-permission-levels`、tasks），标注阻塞状态
- [x] 1.2 `pnpm spec status --change add-doubao-cli` 与 `pnpm spec validate add-doubao-cli --strict` 通过（见第 11 节）

## 拿到账号后的实施步骤（第 2–10 节，未开始）

## 2. 注册与能力声明

- [ ] 2.1 `CLI_IDS`/`CLI_LABELS`/`CLI_SHORT_NAMES` 追加 `doubao`（「豆包 CLI」）
- [ ] 2.2 `worker-permissions.ts`：豆包无第一项、豆包专属「自动审批」说明；`workerPlanSupported` 返回 false
- [ ] 2.3 `conversation-features.ts`：分支不支持理由；运行中引导、附件、工具桥不声明
- [ ] 2.4 `account-links.ts`：单账号，不登记登录域名
- [ ] 2.5 `routing.ts` 别名；`index.ts`/`process.ts` 配置项 `doubaoExecutable`
- [ ] 2.6 `native-worker.ts` transport `doubao-text-v1`、`native-bridge.mjs` runner 映射、`scripts/build.mjs` 资源清单
- [ ] 2.7 `cli-native-capabilities.mjs` 能力类别（`file-read`、`file-write`、`search`、`shell`）
- [ ] 2.8 逐项核对 `grep -rn "qodercn" src tests scripts` 的命中点，处理或写明不支持的理由

## 3. 发现与启动

- [ ] 3.1 `doubao-adapter.ts`：appRoot、npm 启动器映射、`--version` 身份核对、`DOUBAO_CLI_NO_UPDATE_CHECK=1`
- [ ] 3.2 Windows 发现线索（`%LOCALAPPDATA%`、npm `.cmd`）可解释；需要 Windows 实测

## 4. 账号

- [ ] 4.1 `auth status` 解析（已登录 / 未登录 / 订阅不足 / 切换中 / 未知）
- [ ] 4.2 原生终端登录 `doubao login`、退出 `doubao logout`
- [ ] 4.3 来源绑定只用 `doubao-cli-pc-login/generation` 的元数据

## 5. 目录

- [ ] 5.1 只发布 Auto（`default`），且需已登录；不传 `--model`/`--effort`

## 6. 执行、会话、停止

- [ ] 6.1 argv 与权限映射（无 ask、无规划）；不进入 `workerArguments`
- [ ] 6.2 `native-doubao.mjs`：stderr 会话行、错误前缀、stdout 正文、结束判定
- [ ] 6.3 `native-transport.mjs` 追加 `io.holdIdle()`
- [ ] 6.4 停止：SIGINT、取消确认、强制结束后核对共享服务 PID
- [ ] 6.5 续聊 `--resume`：ID 校验，回执不一致即失败

## 7. 界面与图标

- [ ] 7.1 `cli-limitations.ts`；连接页与 Worker 卡片的受限标注；i18n
- [ ] 7.2 图标：按 design「图标」重新生成 `doc/assets/cli-icons/v5-doubao/`（含 preview）与 `src/client/assets/doubao.png`，接入 `icons.tsx`（`mono: false`）
  - 2026-11-07 已试生成一次：256×256 RGBA PNG，SHA-256 `eb08383dbb5b26b16f842a0bf02ee1b11afe2ba98d2828587a6dc99dac124ed1`，四角 alpha 为 0，主体包围盒 `[25,25,231,231]`。因阻塞未入库。

## 8. 自动化测试

- [ ] 8.1 runner（模拟 CLI）：成功、无会话行、续聊回执不一致、错误映射（订阅不足、未登录、切换中、需要回答）、取消已确认与未确认
- [ ] 8.2 argv 与权限映射、提示词与续聊 ID 校验
- [ ] 8.3 账号状态解析、来源绑定不读内容、目录
- [ ] 8.4 路由别名、权限菜单（无第一项、仅可查看下拒绝、规划拒绝）
- [ ] 8.5 `pnpm typecheck`、相关 vitest、`pnpm build:preview`

## 9. 真实验收

- [ ] 9.1 有效账号下 `auth status` 成功
- [ ] 9.2 用户批准模型（或默认 Auto）后：读文件、改文件（核对产物）、续聊、运行中停止（核对进程）、订阅不足提示
- [ ] 9.3 Desktop 隔离包加载：连接页、图标明暗、Worker 卡片标注
- [ ] 9.4 Windows

## 10. 文档

- [ ] 10.1 README、README.en、AGENTS.md、usage-details（中英）、design.md、`doc/doubao-protocol.md`
- [ ] 10.2 PRD 由协调会话合并时更新（本分支不改）：需求 5.8、§四.五、附录 A.4 的结论改为“JS 层有结构化格式但未开放；用户无企业或团队账号，阻塞”；§六变更拆分加入 `add-doubao-cli`（只调研）

## 11. 本期验证记录

- [x] 11.1 `corepack pnpm spec status --change add-doubao-cli`：4/4 产物完成；`corepack pnpm spec validate add-doubao-cli --strict --no-interactive`：通过；全量 `spec validate --all --strict --no-interactive`：57 项通过、0 失败（本机没有全局 pnpm，用 corepack 调用项目锁定的 pnpm 11.25.0；`pnpm spec:check` 脚本内部调用裸 `pnpm` 会失败，故直接运行等价命令）
- 未执行：`pnpm typecheck`、vitest、`pnpm build:preview`。本期没有代码改动。
- 中途停止的编码子 Agent（Codex gpt-6-astra high）只读了源码，未写入任何文件（`git status` 干净）。

## 共享改动

无。本期未修改任何共享注册清单或源码文件。
