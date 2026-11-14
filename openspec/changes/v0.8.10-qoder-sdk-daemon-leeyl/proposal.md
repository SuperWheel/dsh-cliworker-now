# Proposal

## Why

Qoder / Qoder CN 1.1.89 移除了旧 SDK worker 会话，现有账号和模型查询因此退出 42。需要迁移到官方 SDK 1.0.59 的 daemon 账号查询面，同时保留旧版只读 worker 协议。

## What Changes

- 按可信本地入口版本选择协议；版本未知时仅对明确不支持协议的信号切换一次。
- 本次查询独占 daemon，通过 initialize、account_info、get_models、shutdown 获取元数据，不建立会话、不发送 prompt。
- 保持私有配置、一次性鉴权文件、超时、输出限制及范围退出确认，失败只显示脱敏原因。
- 补充模拟、两版 1.1.89 和旧版元数据、ACP initialize 验证及文档。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `qoder-cli`：元数据查询版本分流与私有 daemon 生命周期。
- `qodercn-cli`：中国版使用同一协议分流与自身认证来源。

## Impact

Host 的 qoder-accounts.ts、关联测试和说明文档；不增加 SDK 运行依赖，不修改 Client 或 CLI 更新模块。

## 成功指标（基线、目标）

基线：任务说明记录 1.1.89 旧 worker 元数据路径退出 42。目标：两版 1.1.89 账号/模型可读、1.1.73 旧协议仍可读；用户配置 mtime 清单零变化，查询无残留进程和临时目录；以实际记录为准。

## 范围外

登录、更新、真实模型调用、ACP 任务协议改造、Desktop 更新、版本升级、Git 提交及正式构建。
