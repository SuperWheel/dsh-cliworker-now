# Proposal

## Why

2026-11-14 用户在 Mac Desktop 的「Pi · 账号 → 添加账号」中指出：除已列出的服务商外，「其他服务商」目前只能在原生终端中选择和配置。用户要求「其他服务商」也提供与其他登录菜单风格一致的图形化配置界面，并把相同的菜单做成可复用模板，供其他同类菜单使用。前端由 Opus 实施。

现状：`src/client/account-login/accounts-window.tsx` 的 `AddAccount` 为除 ZCode 外所有带服务商列表的 CLI（OpenCode、Hermes、Pi、OMP、Kimi、TRAE CN）追加「其他服务商（在原生终端中选择）」，选中后打开原生终端。各 CLI 自定义服务商（OpenAI 兼容等）的原生配置位置与格式各不相同，插件目前没有图形化写入。

## What Changes

- Host 为支持自定义服务商的 CLI 提供表单描述：字段（名称、Base URL、API 协议、API Key、模型 ID 列表等）、必填、选项与说明，全部按该 CLI 已核实的原生格式生成；不支持的 CLI 不返回表单，界面保持原生终端。
- Host 校验并写入该 CLI 原生配置（使用原生命令或原生文件格式，按 CLI 实际能力；不套用其他 CLI 的格式）；API Key 只写入原生凭据位置，不回显、不写日志、不进快照。写入后作废该 CLI 的账号与目录缓存并重新读取。
- Client 新增通用「服务商表单」模板（由 Host 表单描述驱动），样式与现有登录窗口一致；「其他服务商」选中后进入该表单，并保留「在原生终端中配置」作为备选。同类菜单（如已有服务商的 API Key 填写步骤）可复用同一模板。
- 不新增模型调用；连通性检查如需请求服务商，只做不消耗模型额度的列模型请求，且须用户主动点击。

## Capabilities

### New Capabilities

- `custom-provider-config`：其他服务商的图形化配置。

## Impact

- 协议：`src/shared/custom-provider.ts`（新增）。
- Host：`src/host/index.ts` 新增 Remote；各 CLI 原生写入模块（Pi、OMP、OpenCode、Hermes、Kimi，按核实结果取舍）。
- Client：`src/client/account-login/` 新增表单模板并接入 `accounts-window.tsx`。
- 文档：README 中英文、doc/design.md、doc/settings-ui-design.md（新增表单模板规则）。
