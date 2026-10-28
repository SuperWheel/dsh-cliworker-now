# Tasks

## 1. 调查

- [ ] 1.1 用无模型夹具或已授权的真实运行，记录 Codex app-server 单个 `item/completed` 与 `outputDelta` 的实际最大帧，确定入站单行默认上限。
- [ ] 1.2 核对 Client 时间线如何消费 `detail`/`toolCall.output`，列出需改的组件文件，同步 design.md。
- [ ] 1.3 核实用户 `config.toml` 中的 `tool_output_token_limit` 是否作用于插件启动的 app-server 运行（插件未覆盖，需实测确认），结论写入 README 草稿。

## 2. 实施

- [ ] 2.1 `native-transport.mjs`：区分单帧保护、展示预算；展示超限降级为摘要，不抛错。
- [ ] 2.2 Codex runner：增量事件、完成时单份输出、原始帧正文摘要化。
- [ ] 2.3 Claude、ACP 系、ZCode、OpenCode/MiMo、Hermes、agy runner：去除 detail/toolCall.output/原始帧的三重正文；思考改增量。
- [ ] 2.4 `pi-omp-bridge.mjs`：读取 Host 预算，去掉写死的 1 MiB/16 MiB。
- [ ] 2.5 `native-harness-tools.ts`：按字节判断并预留包装余量。
- [ ] 2.6 `runtime.ts`、`bridge-protocol.ts`：Host 接收侧与新预算一致；配置 schema（`index.ts`）新增预算项。
- [ ] 2.7 Client：按 step 聚合增量、显示截断标记，旧记录兼容。

## 3. 自动检查

- [ ] 3.1 复现夹具：400KB 单命令、50×64KB、思考长流、>1 MiB 中文工具桥结果；修复前失败、修复后运行继续且传输量线性。
- [ ] 3.2 入站超大单帧仍停止并报告具体原因；展示超限不改变终态。
- [ ] 3.3 旧时间线记录渲染回归；`pnpm typecheck`、关联测试、`pnpm build:preview`。

## 4. 真实验收（需已有选型授权）

- [ ] 4.1 Codex 读取 1MB 以上文件并连续读取多个文件，检查运行未终止、事件、退出状态与界面截断标记。
- [ ] 4.2 至少一个其他 CLI（Claude 或 ACP 系）同类复验；未验证的 CLI 在本任务下列出。

## 5. 文档

- [ ] 5.1 README（中英）新增「输出预算」：插件传输预算与 CLI 模型可见预算的区别、Codex 原生配置位置、gpt-6.x 原生同样使用代码模式 exec/wait。
- [ ] 5.2 `doc/design.md` 同步事件形状；验证记录写在本文件对应任务下。
