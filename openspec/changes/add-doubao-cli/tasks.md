# Tasks

## 0. 调研与形态判定

- [x] 0.1 通道调研（只做元数据与非模型探测，未发送 prompt）
  - 2026-11-07，macOS arm64，`doubao 2.31.3`。结论与来源见 `proposal.md` 调研表与 `design.md`「通道选择」。
  - 检索 `current/resources/js_app/*/main.js`：`entry-cli-router` 实现 `text`/`json`/`stream-json`；原生前端固定 `output_format: "text"`。
  - `doubao --output-format stream-json -p x` → 退出码 2，`invalid_arguments: 未知命令或选项`。
  - 文本模式：会话行 `{"type":"session","session_id":…}` 写 stderr；正文结束时写 stdout；非交互审批被自动拒绝；提问类交互以 `interaction_required` 结束。
  - `--service-start`：远程派发服务（WebSocket 推送），本地无监听端口。
  - 用户数据目录 `~/Library/Application Support/doubao_cli/`：`aha_net/`、`app/`、`control/`（锁文件）、`crash-monitor/`、`doubao-cli-pc-login/`（`account`、`device`、`generation`、`session`，未读取内容）、`logs/`；无本地会话记录文件。
  - 共享服务 `--type=service` 与 `crashpad-handler` 各自独立进程组，CLI 退出后被 init 收养，空闲约 10 秒自行退出；每次探测后 `ps` 核对均无残留。
  - 退出码：0（`--version`）、2（`invalid_arguments`）、4（`login_required`）、7（`conflict`，用户扫码期间）。
  - 参数顺序 `[--resume id] --permission-mode always_allow -p x` 在原生层通过（停在登录检查，退出码 4）。
  - 自动模式安全分类器拒绝了含 `--dangerously-bypass-approvals-and-sandbox` 的参数顺序探测（理由：Safety Bypass Flag）；未绕过，该参数的原生解析未实测。
- [x] 0.2 形态判定：只找到国内版，单 CliId `doubao`、单账号。
- [ ] 0.3 账号门槛：用户 2026-11-07 19:05 扫码登录后，`doubao auth status` 返回 `login_required: 豆包 CLI 需要企业账号，请使用企业账号登录后重试。`（退出码 4）。需要用户改用团队或企业订阅账号登录，阻塞全部真实任务验收。

## 1. OpenSpec

- [x] 1.1 创建 `openspec/changes/add-doubao-cli/`（proposal、design、`specs/doubao-cli`、`specs/worker-permission-levels`、tasks）
- [ ] 1.2 `pnpm spec status --change add-doubao-cli` 与 `pnpm spec:check` 通过

## 2. 注册与能力声明

- [ ] 2.1 `CLI_IDS`/`CLI_LABELS`/`CLI_SHORT_NAMES` 追加 `doubao`
- [ ] 2.2 `worker-permissions.ts`：豆包无第一项；`workerPlanSupported` 返回 false
- [ ] 2.3 `conversation-features.ts`：分支不支持理由；`running-message`、附件、工具桥不声明
- [ ] 2.4 `account-links.ts`：单账号，不登记登录域名
- [ ] 2.5 `routing.ts` 别名；`index.ts`/`process.ts` 配置项 `doubaoExecutable`
- [ ] 2.6 `native-worker.ts` transport、`native-bridge.mjs` runner 映射、`scripts/build.mjs` 资源清单
- [ ] 2.7 `cli-native-capabilities.mjs` 能力类别
- [ ] 2.8 逐项核对 `grep -rn "qodercn" src tests scripts` 命中点，处理或写明不支持理由

## 3. 发现与启动

- [ ] 3.1 `doubao-adapter.ts`：appRoot、启动器映射、`--version` 身份核对、`DOUBAO_CLI_NO_UPDATE_CHECK=1`
- [ ] 3.2 Windows 发现线索（`%LOCALAPPDATA%`、npm `.cmd`）可解释；未实测

## 4. 账号

- [ ] 4.1 `auth status` 解析（已登录 / 未登录 / 订阅不足 / 切换中 / 未知）
- [ ] 4.2 原生终端登录 `doubao login`、退出 `doubao logout`
- [ ] 4.3 来源绑定只用 `doubao-cli-pc-login/generation` 元数据

## 5. 目录

- [ ] 5.1 只发布 Auto（`default`），需已登录；不传 `--model`/`--effort`

## 6. 执行、会话、停止

- [ ] 6.1 argv 与权限映射（无 ask、无规划）
- [ ] 6.2 `native-doubao.mjs`：stderr 会话行、错误前缀、stdout 正文、结束判定
- [ ] 6.3 `io.holdIdle()` 追加到 `native-transport.mjs`
- [ ] 6.4 停止：SIGINT、取消确认、强制结束后的共享服务 PID 核对
- [ ] 6.5 续聊 `--resume`：ID 校验、回执不一致失败

## 7. 界面与图标

- [ ] 7.1 `cli-limitations.ts`；连接页与 Worker 卡片受限标注；i18n
- [ ] 7.2 图标素材 `doc/assets/cli-icons/v5-doubao/`、运行图 `src/client/assets/doubao.png`、`icons.tsx`

## 8. 自动化测试

- [ ] 8.1 runner（模拟 CLI）：成功、无会话行、续聊不一致、错误映射（订阅不足、未登录、切换中、需要回答）、取消确认与未确认
- [ ] 8.2 argv 与权限映射、提示词与续聊 ID 校验
- [ ] 8.3 账号状态解析、来源绑定不读内容、目录
- [ ] 8.4 路由别名、权限菜单（无第一项、仅可查看拒绝、规划拒绝）
- [ ] 8.5 `pnpm typecheck`、相关 vitest、`pnpm build:preview`

## 9. 真实验收（阻塞）

- [ ] 9.1 用户以团队或企业订阅账号登录后：`auth status` 成功输出
- [ ] 9.2 用户批准模型（或默认 Auto）后：读文件、改文件（产物核对）、续聊、运行中停止（进程核对）、订阅不足提示
- [ ] 9.3 Desktop 隔离包加载：连接页、图标明暗、Worker 卡片标注
- [ ] 9.4 Windows：未执行

## 10. 文档

- [ ] 10.1 README、README.en、AGENTS.md、usage-details（中英）、design.md、`doc/doubao-protocol.md`
- [ ] 10.2 PRD 由协调会话合并时更新（本分支不改）

## 共享改动

（实施后逐项登记本分支对共享清单文件的追加式改动，供协调会话合并。）
