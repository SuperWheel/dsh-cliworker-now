# Tasks

## 1. 协议与 Host 原生写入 〔后端｜6h〕
- [ ] 1.1 核实各 CLI（Pi、OMP、OpenCode、Hermes、Kimi、TRAE CN）自定义服务商的原生格式、位置与命令，design.md 记录证据与取舍
- [ ] 1.2 `src/shared/custom-provider.ts` 协议与 Host Remote：表单描述、提交、校验
- [ ] 1.3 各已核实 CLI 的原子写入、凭据保护与缓存作废，模拟测试覆盖成功、冲突、校验失败、写入失败回滚

## 2. 通用表单模板与账号窗口接入 〔前端｜5h｜前置 1〕
- [ ] 2.1 通用服务商表单模板（Host 描述驱动），样式与登录窗口一致，doc/settings-ui-design.md 补规则
- [ ] 2.2 「其他服务商」接入表单，保留原生终端备选；不支持的 CLI 保持原行为
- [ ] 2.3 前端模拟测试与 build:preview

## 3. 验收 〔测试｜2h｜前置 2〕
- [ ] 3.1 typecheck、关联测试、全量 vitest、严格校验
- [ ] 3.2 Mac Desktop 实机：Pi 等已核实 CLI 的表单显示与写入（使用测试用服务商与测试密钥，不调用模型）
- [ ] 3.3 README、doc/design.md 同步
