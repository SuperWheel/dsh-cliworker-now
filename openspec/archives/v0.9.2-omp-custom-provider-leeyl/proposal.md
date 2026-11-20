# Proposal

## Why

OMP 用户目前要切换到原生终端才能添加自有 API Key 服务商。REQ-0138 的第 10 条要求在账号窗口内完成配置，并保持 OMP 全局配置不变。见 [需求快照](../../../doc/prd/2026-11-19-v0.9.2-REQ-0138.md)和 [PRD](../../../doc/prd/2026-11-19-v0.9.2-dsh-rc5-names-omp-PRD.md#10-omp-其他服务商图形化配置)。

## What Changes

- 安全写入契约核实后，在 OMP「添加账号 → 其他服务商」中复用现有图形表单，提供服务商 ID、名称、Base URL、API 协议、API Key 和模型 ID，并保留「在原生终端中配置」。
- Host 校验字段与重名，在插件 OMP 持久账号目录内事务写入，失败时回滚，成功后刷新账号和模型目录。无法确认版本、来源或安全写入契约时，保留原生终端入口并记录原因。

## Capabilities

### New Capabilities

### Modified Capabilities

- `custom-provider-config`：补充 OMP 服务商表单的启用条件、插件目录写入边界和保存后的目录刷新。

## Impact

- Host 扩展 `src/host/service-accounts.ts` 与 `src/host/custom-provider.ts` 的 OMP 表单支持，沿用事务、账号来源及 Worker 快照链路。当前两处表单入口均限定 Pi、OpenCode、Hermes 和 ZCode。
- Client 沿用 `accounts-window.tsx` 和 `provider-form.tsx`，继续使用现有 Gateway `customProviderForm`、`saveCustomProvider` 接口及表单描述结构。安装入口沿用现有方式。

## 成功指标（基线、目标）

- 基线为 OMP 的「其他服务商」只进入原生终端。目标是在通过安全核实的 OMP 安装中，能在同一窗口提交虚构服务商，回读插件目录获得对应配置和 `0600` 权限，且账号与模型目录刷新可见。
- Mac Desktop 验收以界面、磁盘回读、全局目录写前写后比对及恢复证据为准，不调用模型。安全门槛未通过时，验收原生终端回退并记录阻塞原因。

## 范围外

- OMP 全局配置、`agent.db` 写入、普通原生登录行为、远端密钥验证与模型调用。
- 其他 CLI 的服务商表单、DSH rc.5 适配、Agent 命名及 DSH 原生子 Agent 派遣。
