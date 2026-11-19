# Tasks

## 1. 原生工具调查与 DSH 指令识别 〔后端｜4h〕

- [ ] 1.1 对照 rc.5 基础包的 `tool-subagent` 声明、实测会话对应的 Agent 预设、提供方注册状态和当步工具作用域，核实 `subagent` 是否进入模型工具清单，以及插件作用域是否影响可见性。记录可核查的配置或工具列表证据，缺失的信息记为「待核实」。
- [ ] 1.2 在 `src/host/routing.ts` 实现独立原生目标，复用直接指令与讨论判定，处理可选 `cli` 和同句、同批并列目标。以全部列明的别名及 DSH、Codex 分别交办示例核对解析结果。
- [ ] 1.3 用明确标注的模拟输入回归别名、大小写及空格、`cli` 和「命令行」后缀、讨论、引用、否定、同句和同批混合指令，覆盖纯外部歧义与未知目标。核对 `cliworker_resolve`、外部工具的退役目标拒绝及活动 CLI 原有结果。（未执行：待实现后运行 `pnpm test tests/routing.test.ts`）

## 2. 同次请求的委派提示与存量兼容 〔后端｜4h｜前置 1〕

- [ ] 2.1 按已准入消息及本轮工具作用域注入指引，使用 `subagent` 的 `description` 和 `prompt` 承载 DSH 任务，明确工具缺失时提示在 Agent 设置中启用。混合指令保留独立的外部 CLI 选型指引。核对常驻委派说明与当轮提示一致，并与名称同步变更衔接，按实际列表识别已有名称。
- [ ] 2.2 在模拟宿主中核对同次请求的提示来源、`subagent` 参数说明、Agent 设置启用提示、禁止 workflow 绕行及 DSH 部分不走 `cliworker_start` 和外部选型。覆盖两个入口的独立可见性、混合指令、宿主拒绝、步骤取消、子 Agent 边界，确认无误报退役或未知候选，通用提问工具照常可用。（未执行：待实现后运行 `pnpm test tests/routing.test.ts`）
- [ ] 2.3 使用模拟存量 `cli='harness'` 任务，核对旧记录可读，Client 不能续聊，Host 也拒绝续聊或重新派遣，无原生或外部启动。核对 `harness` 仍不在活动 CLI 中。（未执行：待实现后运行 `pnpm test tests/panel.test.tsx tests/runtime.test.ts tests/dispatch-storage.test.ts`）
- [ ] 2.4 同步 README 的中英文用户说明和 `doc/design.md` 的路由说明，核对原生与外部入口、工具缺失处理及退役历史描述与规格一致。

## 3. 原生子 Agent 分组标题 〔前端｜3h〕

- [ ] 3.1 更新 `src/client/panel.tsx` 的分组标题与无障碍模板入参，复用现有翻译模板。核对仅该分组使用 `Deepseek Harness`，继续显示现有图标和计数，设置开关文案保持既有写法。
- [ ] 3.2 用模拟面板覆盖中英文标题及无障碍名称、图标、计数、折叠和显示开关，核对外部 Worker 不混入该分组。在支持的窄宽度验证标题可读且无溢出，记录实际宽度、语言和布局证据。（未执行：待实现后运行 `pnpm test tests/panel.test.tsx` 和窄栏布局检查）
- [ ] 3.3 同步 README 和 `doc/design.md` 的分组说明，核对设置页文案及页面设计参数无需调整。

## 4. rc.5 派遣与面板联动验收 〔测试｜3h｜前置 2,3〕

- [ ] 4.1 完成影响范围内的类型检查及隔离预览检查，核对预览包可在 rc.5 加载并显示该分组，记录实际命令、版本和结果。（未执行：待实现及 rc.5 适配合入）
- [ ] 4.2 Mac Desktop 0.2.2-rc.5 真实验收：在 `v0.9.2-dsh-rc5-adapt-leeyl` 合入且已有模型选型授权后，在主对话分别发送一次「调用 dsh 帮我总结 README」和「用 DeepSeek Harness 检查这个目录」。逐条核对实际 `subagent` 工具调用、原生子 Agent 创建与完成事件、返回主对话的结果、无外部选型及 CLI Worker 面板 `Deepseek Harness` 分组。核对中英文界面的可见标题、无障碍名称、图标、计数及窄栏展示。（未执行：本次仅撰写规格，待实现、rc.5 适配合入及真实调用授权）
  - 实施验收时，在 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/<YYYY-MM-DD>-dsh-native-dispatch/` 新建权限为 `0700` 的独立验收子目录，保存实机工作区及脱敏证据，并在本任务填写实际路径和结果。若需临时 `HOME` 或 `DSH_HOME`，放在同一验收子目录。
  - 若实施需要独立 worktree，按项目约定置于 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/worktrees/` 下并记录实际路径。
