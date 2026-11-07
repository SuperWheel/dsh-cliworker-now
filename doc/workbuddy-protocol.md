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

Host 原生桥请求的 `argv` 是 `[runtime, entry]`；`native-workbuddy.mjs` 再核对安装身份并生成 ACP／网关参数。引导、ready 监听、横幅丢弃、子进程环境、审批标题及拒绝终态均由已有核心模块负责。助手、socket 与子进程清理由这些模块管理；只停止插件启动的范围，不停止桌面端。运行资源连同 `.cjs` 助手一起复制到隔离包及声明运行目录。

`workbuddy-metadata.ts` 复用 `probeWorkBuddyMetadata`，只做 initialize 与 session/new，不发 prompt。一次授权内共用一次握手；查询范围结束后清除作用域，不长期缓存账号或原生 session 回执。模型 ID、label 与 efforts 均取原生结果，不额外推断模型或强度。每次查询会留下空的原生会话（原生没有删除接口）。

账号状态只根据原生元数据成功或认证错误判断。成功显示 product 站点；未登录提示“请打开 WorkBuddy 桌面端登录后重试”；引导失败显示固定不可用类别。没有插件登录、退出或账号终端入口，不读取凭据文件内容。

来源绑定仅由应用、内置入口、版本、配置目录及站点生成，且每次准入重新确认原生登录。原生未公开稳定账号主体，本实现不能据此识别同站点账号切换；不把这个绑定描述成用户身份校验。与账号相关的原生 session/load 恢复失败按 runner 规则报错。

## 能力

| 能力 | 接线 |
| --- | --- |
| 询问／自动审批／完全权限 | `default`／`auto`／`bypassPermissions`，保持 runner 已定义的回退 |
| 规划 | 原生 `plan` |
| 附件 | 原生 ACP 按协商能力处理 |
| 工具类别 | 文件读、按模式写、搜索、shell、web、skills |
| DSH 工具桥 | 关闭；WorkBuddy 内置 CLI 只公开 http/sse MCP，未验证插件工具通道 |
| 分支 | 关闭；WorkBuddy 内置 CLI 未公开原生分支能力 |
| 运行中消息 | 原生 Inbox，整轮清理后接收；不声明 steer |
| 遥测 | 不新增用量或上下文事件，不套用 Qoder 积分或其他 CLI 的 token 口径 |

skills、子 Agent 与记忆继续由原生设置决定，未新增扫描目录或共享逻辑。连接页及 Worker 卡片显示试验性说明；现有字号、主题 token、表单组件和布局继续复用。

## 证据边界

本机安装版与元数据历史调研见本变更 proposal／tasks；本次注册接线测试使用明确标注的模拟程序与探测结果，没有登录、密钥读取或真实模型调用。国际版应用身份、Windows 实机、真实任务／审批／恢复／停止、Desktop 明暗主题及图标仍待实际验收。隔离构建和类型检查不等于这些真实行为已通过。命令与结果见 [tasks.md](../openspec/changes/add-workbuddy-cli/tasks.md)。
