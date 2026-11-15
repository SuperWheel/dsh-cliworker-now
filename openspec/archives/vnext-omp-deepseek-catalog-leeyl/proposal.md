## Why

OMP 的 DeepSeek API 登录已有有效原生候选，但 `models --json` 不含路由地址，Host 默认地址表漏掉 `deepseek`，在账号查询前丢弃全部候选，设置页显示空目录。

## What Changes

- 补齐经安装版 OMP 核实的 DeepSeek 默认 API 路由及环境变量名，继续按原生候选与当前账号 `/models` 的交集显示。
- 覆盖无自定义 models.yml 的 DeepSeek 登录、失败关闭、原生强度和 Pi 路由优先级的模拟回归。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cli-model-discovery`：明确 DeepSeek 默认路由缺失元数据的补全和账号交集要求。

## Impact

仅 Host 原生目录过滤及测试、文档；不改 Client、协议、登录写入、版本及依赖。

## 成功指标（基线、目标）

基线：隔离复制真实 OMP 插件账号后，原生候选 4 个，snapshot 4 个，账号查询 0 次、输出 0 个。目标：使用实际默认路由查询，只显示原生与账号均有的 ID；强度来自原生。Pi 使用安装 SDK 与模拟凭据/列表核对，不迁移真实凭据。

## 范围外

真实模型推理、Desktop 安装和 UI 操作、Windows 实机验证、账号修改、提交、推送和版本变更。
