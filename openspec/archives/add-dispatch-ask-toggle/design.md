# Design

## “默认模型设置”对应哪项配置

插件里与派遣相关的设定有两处，均为 Host 私有存储：

| 存储 | 作用域 | 内容 | 写入来源 |
| --- | --- | --- | --- |
| `<projectKey>.preference.json` | 项目 + CLI | `model`、`effort`，以及 `dispatchRole`、`dispatchBinding` | 设置页 `configure()` 只写模型/强度并保留原角色与绑定；完整选型 `setDispatchSetup()` 写全部 |
| `<conversationKey>.conversation-setup.json` | 主对话 + 项目 + CLI | 已确认的完整设定 | 每次派遣成功 |

插件没有全局或跨项目的默认模型。设置页「项目默认设置」显示和修改的就是第一项；`storage.dispatchSetup(project, cli)` 读取同一文件，只有 `dispatchRole` 与 `dispatchBinding` 都存在时才返回完整设定，这也是现有“沿用设定”问题卡展示的内容。因此“设置里已配置的默认模型设置”取 **项目 + CLI 的完整设定**：模型、强度来自设置页（或上次选型），角色与账号绑定来自上次完整选型。设置页没有默认角色控件；缺少角色时不猜测“无角色”，回退到完整选型，保存后后续即可免询问。

## 开关作用域与存储

开关是 **全局（profile 级）** 通用设置，放在「CLI Worker 设置」通用页「任务调度」分区，与“最高同时对话数”“同目录写任务并行”同级。理由：用户诉求是“不再询问”，通用页标题正是任务指定的「CLI Worker 设置」；安全性不依赖开关作用域，因为免询问仍要求每个项目和 CLI 各自有当前有效的完整设定，不会跨项目或 CLI 套用。

字段 `askBeforeDispatch` 加入 `general-settings.json`（`atomicJSON`，目录 0700、文件 0600）。schema 为可选布尔；缺失即询问，旧文件无需迁移；`saveGeneralSettings` 传 `null` 恢复默认。`runtime.generalSettings()` 向 Client 返回 `askBeforeDispatch ?? true`。

## Host 流程

`chooseDispatch` 在取得目录和当前账号绑定后：

1. 主对话已确认设定有效 → 照旧直接使用。
2. 主对话无设定：开启询问 → 原有“沿用”问题卡；关闭询问 → 项目完整设定 `valid()` 通过则直接使用，否则进入完整选型。
3. 主对话设定已失效：关闭询问且项目设定有效 → 使用项目设定；否则完整选型。
4. 未提问的设定针对刚读取的目录与绑定做 `valid()` 检查，并把绑定记入 `selectionBindings`；`launch` 再以该绑定调用 `querySelection`（`authorizeSelection`）实时授权，与基线分支对“已确认对话设定”的处理一致。经过提问的设定仍在 `chooseDispatch` 内复核。任何失败都抛错且不启动。

`valid()` 要求 CLI、账号绑定一致，模型在当前目录且强度受支持。等待队列、取消和 `pending` 计数逻辑不变。

## Client

`general-settings.tsx` 在“同目录写任务并行”之后新增一行，复用 `cwn-setting-row`：左侧“调用前询问模型”标签与说明，右侧原生 `Switch`。保存沿用本页的 `save(field)`：保存中显示进度，失败恢复原值并显示短错误，成功不显示文字。`readSettings` 对缺失字段按 true 处理，其他非布尔值拒绝。中英文文案加入 `i18n-messages.ts`。

## 风险与回退

- 用户可能忘记已关闭询问：说明文字写明关闭后的行为，打开开关即可恢复。
- 回退：打开开关即恢复原行为。`generalSettingsSchema` 不是 strict，旧版本插件读取时会忽略该字段，降级后按原流程询问。
