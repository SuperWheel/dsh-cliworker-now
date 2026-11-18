# Qoder CN CLI 原生协议与隔离

核验日期：2026-10-19，插件仍为 v0.8.1。中国版独立注册为 `qodercn`，沿用经实际发行包核对的 ACP/SDK 算法。参考：[官方 ACP](https://docs.qoder.cn/cli/acp)、[安装](https://docs.qoder.cn/cli/installation)、[模型](https://docs.qoder.cn/cli/models)。执行证据另见 [实际记录](../tasks.md)。

## 1. 两版身份

| 项目 | Qoder 国际版 | Qoder CN 中国版 |
| --- | --- | --- |
| 插件 CLI / 会话协议 | qoder / qoder-acp-v1 | qodercn / qodercn-acp-v1 |
| 官方独立程序 | qodercli | qoderclicn |
| 用户根 / 环境前缀 | .qoder / QODER_ | .qoder-cn / QODERCN_ |
| PAT | QODER_PERSONAL_ACCESS_TOKEN | QODERCN_PERSONAL_ACCESS_TOKEN |
| npm | @qoder-ai/qodercli | @qodercn-ai/qoderclicn |
| ACP agentInfo.name | qoder-cli | qoder-cli-cn |

泛称 Qoder 先检测安装：单装使用该版、双装宿主原生询问、均缺失明确拒绝。明确国际版或 qodercn 不回退。模型、强度、偏好、路径、账号来源、目录缓存、清理保护和历史保持品牌身份。

## 2. 官方 1.1.74 与 Windows 入口

本机中国版原生安装为 `~/.qoder-cn/bin/qoderclicn/qoderclicn.exe`，官方符号链接指向该次安装的 `qoderclicn-1.1.74.exe`。不枚举“最新版本”。PATH 的 qodercn.cmd 是分发器；自动发现直接使用核验后的原生入口，npm 则验证包名和 bin 声明后选择 bundle/qoderclicn.js。

公共 Windows 发现复用常见 bin/npm/Bun/Scoop/pnpm 目录，缺失时读取最新用户/机器 PATH。专属路径与包身份按品牌核验；自动发现拒绝另一版、GUI 和不明分发器。显式自定义 wrapper 保持用户配置优先，实际 ACP 初始化仍核对品牌。

## 3. 共享字段与独立来源

- 品牌变量使用 QODERCN_CONFIG_DIR、QODERCN_CONFIG_DIR_NAME、QODERCN_CLI_HOME、QODERCN_PERSONAL_ACCESS_TOKEN 等；未配置时用户根为 .qoder-cn。项目配置默认仍是 .qoder；对应 CONFIG_DIR_NAME 可同时改变用户和项目目录名。
- SDK 控制变量仍叫 QODER_AGENT_SDK_ENTRYPOINT、QODER_AGENT_SDK_VERSION、QODER_SDK_AUTH_PAYLOAD_FILE、QODER_SDK_AUTH_CONFIG_DIR；认证载荷的 type 仍为 qodercli，不能改成 qoderclicn。browser 原生存储策略为 readOnly/none，PAT 为 memoryOnly/none。临时根、输入 settings/customs 和账号根只取选中版，结束及进程清理未确认不发布目录。
- ACP 使用 qodercn --acp，agent 名为 qoder-cli-cn，工具扩展仍是 _meta.qoder.toolName。模型与 reasoning_effort、mode 从原生 configOptions 读取和确认；不复制国际版档位，不使用 yolo。未宣告的只读规划仍在 prompt 前拒绝。
- 原生日志名仍为 qodercli.log，位置在中国版根内。项目路径编码、userMessageId/parentUuid 归属和有界私有读取沿用同算法；事件分别使用 cliworker.qodercn_prompt_usage、cliworker.qodercn_context 与 qodercn.native-* 来源。对侧事件不能补给本版统计。

## 4. 验证边界

模拟回归覆盖品牌、账号/PAT、路径、选型、权限、取消、恢复、遥测与未知计数。首次实机初始化时中国版未登录；用户随后完成原生登录，实际目录返回 15 个可用模型，并授权 Qwen3.8-Flash / low。正常 Windows Desktop Host 的真实文件工具生成、同会话无工具记忆续聊、实际输出后取消均通过，合计 3 次提交，受管句柄范围退出确认。模型/强度由明确标注的授权夹具匹配实时目录，不冒充真实 UI 点击；其他模型、图片理解与完整共享 Skill/MCP 尚未逐项实测。Windows Desktop 的实际安装、设置页、桌面故障及命令结果记录于 tasks.md；Mac Desktop 不参与本次验收。

随后按用户要求，在正常 Windows Desktop 新建对话、输入并点击发送一次，由当前已选 GLM-5.3-Flash / Low 主对话实际派遣 qodercn / qfmodel / low。该独立新 Worker 通过真实工具桥读取样例中的随机标识并正确求和，原始协议 SUCCESS 与 Host completed 一致；该 Worker 仅有本轮一次发送记录。实际打开原生子会话，核对完成结果、过程展开、Qoder CN CLI 独立模型列表及 Qwen3.8-Flash 勾选、Low 展示和未发送输入的编辑/清空。该轮未单独采集原生退出码，最终进程观察为零；不套用前述三轮的逐句柄退出证据。本次没有手工点击双装询问框，其行为仍由模拟回归覆盖。

## 5. Windows 本轮启动恢复

正式 Desktop 首次冷启动显示各 CLI 设置均不可读，错误为 active Service cliworker unavailable。现场 host.lock 的 PID 已属于 Tabbit Browser；既有 WorkerStorage 仅检查该 PID 是否存活，会因此拒绝创建服务。该锁逻辑与本次开始前的源码一致；不能据此确定旧锁的遗留时间、原因或将其归因于中国版登录。恢复须先正常退出并确认全部 Harness 进程结束、无活动 Worker、锁哈希未变化，再备份并移除已证实过期的锁；不结束复用 PID 的其他应用。恢复及后续设置实测结果见 tasks.md。

后续独立验收会话的 UI 树导航期间发生一次 Windows renderer crashed。后台真实续聊、取消仍完成；错误日志没有给出具体触发原因。移除临时验收扩展、恢复原 profile 并正常冷启后，13 个设置页再次通过。其后普通最大化仅恢复静态显示，真实点击仍无响应；确认无活动任务后只回收该故障实例并正常冷启，实际点击和上述新对话原生子会话检查通过。崩溃及冻结原因仍未确定，遵循用户要求停止扩大诊断，不宣称永久修复。中国版原生执行后认证文件字节发生变化，原凭据未保存或回滚；此前收尾正式账号绑定核验一致，不等于认证文件逐字不变，本次新调用后的哈希变化也单独保留于 tasks.md。
