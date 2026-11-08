# WorkBuddy 内置 CLI 接入（试验性）

试验性：依赖 WorkBuddy 桌面端非公开接口。实现决策以 [OpenSpec design](../openspec/changes/add-workbuddy-cli/design.md) 为准。注册接线复用已有核心模块，不改其他 CLI 的协议。

| 项目 | 国内版 | 国际版 |
| --- | --- | --- |
| CliId／Worker 短名 | `workbuddycn` | `workbuddy` |
| 显示名 | WorkBuddy | WorkBuddy AI |
| transport | `workbuddycn-acp-v1` | `workbuddy-acp-v1` |
| product endpoint 主机 | workbuddy.cn／www.workbuddy.cn | workbuddy.ai／www.workbuddy.ai |
| 路径设置 | `workbuddycnExecutable` | `workbuddyExecutable` |

两项配置缺省值是发现标识，不是 PATH 命令。手动路径接受应用目录、自带运行时或内置入口。默认候选来自 `workbuddy-variant.ts`；应用名只是线索，实际检查 `@genie/agent-cli`、`cli/dist/codebuddy-lite-wb.mjs` 与 `product.json` 的 endpoint、dataFolderName。macOS 使用应用自带 Electron；Windows 使用应用目录中的运行时。两版不互相回退，不使用 PATH 上的 CodeBuddy、node 或其他 CLI。

泛称 WorkBuddy 按两版的只读发现结果分流：只装一版用该版，两版都装通过宿主 `userQuestions` 询问；取消不启动，探测错误不当作未安装。`workbuddycn`／WorkBuddy 国内版明确国内版，WorkBuddy AI／WorkBuddy 国际版明确国际版。

## 运行与查询

Host 原生桥请求的 `argv` 是 `[runtime, entry]`；`native-workbuddy.mjs` 再核对安装身份并生成 ACP／网关参数。引导、ready 监听、横幅丢弃、子进程环境、审批标题补全及拒绝终态由共享 ACP runner 的同名选项 `approvalFromToolCall`、`deniedCancelEndsTurn` 负责。助手、socket 与子进程清理由这些模块管理；只停止插件启动的范围，不停止桌面端。运行资源连同 `.cjs` 助手一起复制到隔离包及声明运行目录。

`workbuddy-metadata.ts` 复用 `probeWorkBuddyMetadata`，只做 initialize、session/new 与逐模型的 session/set_config_option，不发 prompt；`thought_level` 取值随模型变化，每个模型的强度取切换后的实际列表。一次授权内共用一次握手；查询范围结束后清除作用域，不长期缓存账号或原生 session 回执。模型 ID、label 与 efforts 均取原生结果，不额外推断模型或强度。每次查询会留下空的原生会话（原生没有删除接口）。

账号状态以元数据成功确认当前已登录并显示 product 站点。`CLI_OWN_ACCOUNT_REQUIRED` 包含通用 -32000/-32001/401/403 或认证文本，无法证明认证缺失，因此账号状态为 unknown，提示“请在桌面端检查登录状态”；其他失败为 unavailable。尚无经核实的明确认证缺失回执，不报告退出成功。

有桌面管理指引，无 CLI 登录/退出。设置账号行通过 `target: desktop` 声明能力，进入复用 `LoginWindow` 的 480px 无 PTY 页面；当前账号用灰卡，操作与状态同排，不显示原生终端开关。旧 Host 没有能力描述时只留原手动指引，旧 `accountStart` 继续拒绝 WorkBuddy。

`accountDesktopStart/Respond/Watch/Stop` 管理独立的内存观察会话；固定动作仅 open/refresh/continue，Client 不传路径或命令。`workbuddy-desktop.ts` 保留父会话归属、CLI 互斥、执行权限/启用/Worker 空闲检查和 `AccountFrame` seq/status/cleanupConfirmed，帧只有固定文案及安全账号投影，没有 data 或 PTY。每次动作重新解析安装；`workbuddy-desktop-open.ts` 在 macOS 以 argv `[/usr/bin/open, verifiedAppRoot]` 打开，不加 `-n`；Windows 从核实应用根重新选择 `WorkBuddy.exe` / `WorkBuddy AI.exe`，不带 CLI 参数，实机启动/激活仍未验证。打开失败显示手动打开和重试。

打开页只读一次；打开桌面端或继续观察后，上一轮完成至少间隔 15 秒再查询，最多 5 分钟或 20 次自动查询。手动刷新合并在途查询；预算到期后手动刷新仅一次，继续观察须显式操作。每周期一次元数据获取同时用于账号与模型变化判断，仅状态/模型变化或手动刷新时使该 CLI 展示缓存失效。保留每 RPC 20 秒及整轮 25 秒时限，等待实际清理后释放；清理不明走已有隔离保护。父会话结束、订阅取消或卸载取消观察，打开响应未被订阅时 30 秒回收；关闭指引从不终止桌面应用。

不新增凭据文件读取；`workbuddy-key-helper.cjs` / `workbuddy-bootstrap.mjs` 的 at-rest 密钥处理保持原样，密钥不进入 Host 帧、事件或日志。

来源绑定仅由应用、内置入口、版本、配置目录及站点生成，且每次准入重新确认原生登录。原生未公开稳定账号主体，本实现不能据此识别同站点账号切换；不把这个绑定描述成用户身份校验。与账号相关的原生 session/load 恢复失败按 runner 规则报错。

## 能力

| 能力 | 接线 |
| --- | --- |
| 询问／自动审批／完全权限 | `default`／`auto`／`bypassPermissions`，保持 runner 已定义的回退 |
| 规划 | 原生 `plan` |
| 附件 | 原生 ACP 按协商能力处理 |
| 工具类别 | 文件读、按模式写、搜索、shell、web、skills |
| DSH 工具桥 | 关闭；WorkBuddy 内置 CLI 只公开 http/sse MCP，未验证插件工具通道 |
| 分支 | 关闭；当前 CLI 不支持会话分支：WorkBuddy 内置 CLI 的 ACP 没有实现 session/fork |
| 运行中消息 | 原生 Inbox，整轮清理后接收；不声明 steer |
| 遥测 | 用量：本轮 `end_turn` 后读取内置 CLI 原生会话文件（`<configDir>/projects/<项目键>/<sessionId>.jsonl`），按请求去重汇总 token 与 `rawUsage.credit`，按积分显示；缺积分或有子 Agent 时积分未知。上下文：采用 ACP `usage_update` 的 `used`/`size`。两版回执互不归属 |

skills、子 Agent 与记忆继续由原生设置决定，未新增扫描目录或共享逻辑。连接页显示试验性说明，Worker 卡片不显示；现有字号、主题 token、表单组件和布局继续复用。

## 证据边界

本机安装版与元数据历史调研见本变更 proposal／tasks；本次注册接线测试使用明确标注的模拟程序与探测结果，没有登录、密钥读取或真实模型调用。国际版应用身份、Windows 实机、真实任务／审批／恢复／停止、Desktop 明暗主题及图标仍待实际验收。隔离构建和类型检查不等于这些真实行为已通过。命令与结果见 [tasks.md](../openspec/changes/add-workbuddy-cli/tasks.md)。
