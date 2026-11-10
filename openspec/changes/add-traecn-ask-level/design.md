# Design

## 模块边界

- `src/shared/worker-permissions.ts`：TRAE 的 `LEVELS.traecn` 增加 `ask`。`cliLevelOptions`、`levelName`、`runsUnderViewOnly` 都由此推导，无需单独分支；Client 菜单与派遣回执文案随之变化。
- `src/host/adapters.ts`：`cliArguments` 去掉 TRAE「询问档」的报错，其余校验（必须走原生 ACP、不支持强度）不变。
- `src/host/native-traecn.mjs`：`traecnAcpArgv` 按档位生成 argv；`runNativeTraecn` 的 `editMode` 在询问档为 `undefined`，使共享 runner 跳过模式设置与回读。
- `src/host/native-acp.mjs` 不改：`wantedMode` 为空时本就跳过模式块；审批转交与“因拒绝审批而结束”（`deniedCancelEndsTurn`）沿用 v0.8.8 实现。

## 参数取舍

| 档位 | argv | 会话模式 |
| --- | --- | --- |
| 询问 | `-c sandbox_mode="read-only" -c approval_policy="on-request" -c approvals_reviewer="user" acp serve` | 不设置（会话不返回模式） |
| 仅工作区编辑 | `--permission-mode default acp serve` | `default` |
| 完全权限 | `--permission-mode bypass_permissions acp serve` | `bypass_permissions`（可降到 `default`） |
| 规划 | `--permission-mode default acp serve` | 切到 `plan` |

- 用 `-c` 而不是 `-s/-a`：TRAE 自带文档以配置键说明这两项，且 `approvals_reviewer` 没有对应短参数；三项统一用 `-c`，参数顺序固定，便于测试。
- 显式传 `approvals_reviewer="user"`：不传时取用户配置或 TRAE 默认值，可能是 `auto_review`（审核子代理代批），不能保证由人审批。`user` 是实测接受的取值。
- 不同时传 `--permission-mode`：实测会使 TRAE 拒绝启动。
- 不用 `approval_policy="untrusted"`：v0.8.8 实测 `-a untrusted` 不被接受；`on-request` 是 TRAE 文档列出的值。若真实探测显示 `on-request` 对工作区内写文件不询问，回退为两档，不尝试更宽的取值。

## 兼容性与生命周期

- 已保存档位为 `ask` 的 TRAE Worker 只可能来自手工改数据（菜单此前不提供），升级后按询问档运行。
- 没保存档位的 TRAE Worker 在主对话为仅可查看时，从“拒绝派遣”变为“以询问档运行”。这是行为放宽，但每个改动仍先经 DSH 审批。
- 每轮都启动一次 TRAE 进程（`runNativeAcp` 只跑一轮），换档或切规划不需要额外重启逻辑；进程清理与停止语义不变。
- 无存储格式变化。

## 依赖

- 增量规格 `traecn-cli` 修改的需求只存在于未归档的 `add-traecn-cli`；归档顺序必须先 `add-traecn-cli`，再本变更。
- `worker-permission-levels` 的「Worker 三档权限菜单」同样以 `add-traecn-cli` 修改后的文本为基础。

## 风险与回退

- 核心行为（工作区内改动先询问）未经真实模型验证：glm-5.3-flash 服务端 400，用户决定不换模型。代码可以先合入本地分支，但开放条件见 proposal。回退办法：撤回 `LEVELS.traecn.ask` 并恢复 argv 中的报错，即回到 v0.8.8 行为。
- TRAE 升级可能改变配置键或取值：启动失败会以 runner 的现有错误路径报告，不会退化成更宽的模式。
- Windows 只读沙箱未验证。
