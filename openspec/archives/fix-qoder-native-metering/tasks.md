# Tasks

## 1. Qoder 数字采集

- [x] 1.1 实现 ACP 扩展计数、精确本轮积分与上下文补读，加入身份、去重、路径、日志和取消回归，并同步协议文档；以 Windows 关联测试通过核验。

## 2. 原生显示

- [x] 2.1 传递独立积分并在原生用量入口及详情显示，token 未公开明确标注；加入投影与渲染回归，核对原生扩展构建产物。

## 3. Windows 最小验收与交付

- [x] 3.1 在 Windows 执行关联回归、必要类型检查及 Windows Desktop 交互，核对上下文、积分和未公开 token；不在 Mac 执行测试，不调用付费模型。
- [x] 3.2 同步 README、设计与 doc/tasks.md 的实际命令、结果和边界；核对规格及差异并严格校验。

## Workflow follow-up

- 依据实际证据同步规格并归档；保留未执行的真实模型、完整 Windows 账户和全量发布验收边界。

## Verification evidence

- Windows Node 24.15.0，关联 8 文件 118 项通过、0 失败、0 跳过；Host/Client 类型检查通过。
- Windows 正式 Desktop 冷启后，只读打开原有 Qoder 历史，点验用量及上下文弹层：0.252595 积分、15.7%、Token 未公开。
- 已加入原生扩展源码的渲染用例；未运行该独立文件，以四包隔离构建和 Windows 实际原生显示为本轮对应证据。
- 私有回执与截图位于 `.test-data/qoder-metering-20261018/`；没有新模型调用、Mac 测试或全量发布验收。
