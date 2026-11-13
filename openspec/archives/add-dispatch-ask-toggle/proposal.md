# Proposal

## Why

当前每个新主对话首次派遣某个 CLI 时，`src/host/index.ts` 的 `chooseDispatch` 都会用宿主 `userQuestions` 弹出问题卡：项目已有完整设定时询问“是否沿用”，否则询问模型、思考强度与角色。部分用户已在 CLI 设置页「项目默认设置」配好模型和强度，希望派遣时不再被询问，直接使用默认值。所有者要求增加开关，默认仍询问，关闭后才直接使用默认设定。

这会改变 `AGENTS.md`“首次选择前不启动任务”的约定，因此只允许一个例外：**仅在用户关闭询问，且该项目和 CLI 已有当前仍有效的完整设定时**跳过问题卡。

## What Changes

- 在「CLI Worker 设置」通用页的「任务调度」分区新增「调用前询问模型」开关（原生 Switch），作为通用设置字段 `askBeforeDispatch` 保存在 `general-settings.json`；默认开启（询问），即现有行为不变。
- 关闭后，新主对话派遣任一 CLI 时：若该项目和 CLI 已保存的完整设定（模型、强度、角色、账号绑定）在当前目录和账号下仍有效，直接使用，不弹“沿用”或选型问题卡；之后照常在 `launch` 中做实时授权 `authorizeSelection`，并检查宿主权限、CLI 开关与项目一致性。
- 没有完整设定（例如只在设置页选了模型但从未确认过角色）、设定已失效（模型不在目录、强度不支持、账号绑定变化）时，回退到现有完整选型问题卡；不猜测模型、强度或角色，不跨项目或 CLI 套用设定。
- 当前主对话已确认的设定继续优先；其失效时，关闭询问模式先尝试项目设定，仍无效再完整选型。
- 旧配置缺少该字段时按“询问”处理，无需迁移；`null` 恢复默认。
- 同步 `AGENTS.md`、README、`doc/settings-ui-design.md`、`doc/tasks.md`。

## 范围外

- 不新增“默认角色”设置项；角色仍来自上一次完整选型保存的项目设定。
- Qoder / Qoder CN 双版本歧义询问不属于模型选型，仍照常询问。
- 同会话互斥、同目录写任务串行（及其可选并行副本）、并行上限、宿主规划/只读拒绝等规则不变。
- 不做真实模型调用、不更新 Desktop 链接、不升版本号。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `worker-dispatch`：新增“调用前询问开关”需求，修改“项目设定与主对话确认”以写明唯一例外。

## Impact

- Host：`src/host/storage.ts`（通用设置 schema 增加可选字段）、`src/host/runtime.ts`（`generalSettings()` 默认 true）、`src/host/index.ts`（`chooseDispatch` 一个分支）。无新增 Remote，沿用 `generalSettings` / `saveGeneralSettings`。
- 共享协议：`GeneralSettings.askBeforeDispatch`。
- Client：`src/client/general-settings.tsx` 新增一行，`src/client/i18n-messages.ts` 补英文文案；旧 Host 未返回该字段时视为开启。
- 安装方式不变。
