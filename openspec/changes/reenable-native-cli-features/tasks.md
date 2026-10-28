# Tasks

## 1. 核实

- [ ] 1.1 Grok：核实 ACP 模式下网页搜索与抓取是否产生权限请求，以及在 Windows/macOS 上的行为。
- [ ] 1.2 OpenCode/MiMo：按实际安装版本核实原生 skill 发现路径与 `OPENCODE_DISABLE_EXTERNAL_SKILLS` 的作用范围，确定只读提供用户 skill 的方式，确认不会读取 provider 配置或其他 CLI 凭据。
- [ ] 1.3 OMP：核实 `approvalMode` 取值及其审批事件能否接入 DSH 审批。
- [ ] 1.4 ZCode：核实 `Skill` 工具是否涉及委派，浏览器 REPL 的用途与风险（供后续决定）。

## 2. 实施

- [ ] 2.1 Grok：去掉 `--disable-web-search` 与 `GROK_WEB_FETCH=0`。
- [ ] 2.2 OpenCode/MiMo：按 1.2 结论启用用户原生 skill，保留账号隔离项。
- [ ] 2.3 Pi：完全权限时 `--tools` 追加 bash（依赖 `relay-native-approvals-to-host` 2.1 的预设读取）。
- [ ] 2.4 OMP：按 1.3 结论处理 bash。

## 3. 自动检查

- [ ] 3.1 adapter 参数测试：Grok 无网页禁用参数；OpenCode/MiMo skill 可见且隔离项仍在；Pi 三档预设下 bash 有无正确；能力表随之变化。
- [ ] 3.2 `pnpm typecheck`、关联测试、`pnpm build:preview`。

## 4. 真实验收（需已有选型授权）

- [ ] 4.1 Grok 网页搜索、OpenCode 使用用户 skill、Pi 完全权限下执行命令与工作区内修改下走 DSH 备选；未验证项在本任务下列出。

## 5. 待用户决定（不在本次实施）

- [ ] 5.1 CLI 内部子 Agent（Grok、ZCode）是否启用；统一 Claude Task、Codex 多 Agent 的标准。
- [ ] 5.2 CLI 记忆（Grok、Hermes、OMP）是否启用。

## 6. 文档

- [ ] 6.1 README（中英）支持范围列出各 CLI 已关闭的原生功能及类别；验证记录写在本文件对应任务下。
