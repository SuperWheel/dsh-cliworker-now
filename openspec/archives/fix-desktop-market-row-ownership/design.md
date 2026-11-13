# Design

## Context

市场根据 bundle 插入的 id 推导所有权，复用 stock id 会让禁用重放关闭官方 UI。两个检查对象均标为 Harness 0.2.1-rc.2，但 scratch asar2 含 `readDisabledProfileBundles`，npm app-boot 没有该函数；分别验证，不假设实现相同。此前独立 id 候选已证明模块加载正常但 canonical 设置写入失败。

## Goals / Non-Goals

**Goals:** 插件归属与 stock 分离；保留原生设置命名空间、层次、实时编辑、revision、重置和卸载恢复；保持每个官方浏览器包只有一个来源。

**Non-Goals:** 修改 Harness 或市场代码、变更真实客户端安装、调用模型、版本升级或发布。

## Decisions

### 独立 Loader id 与原包身份

四个 insert 使用 `cliworker-ui-*`，运行路径和 `@deepseek-ai/dsh-client-ui-*` 包身份不变。顶层 stock disabled rows 仅属于本 bundle 层。dshmarket 的 insertedIds 不含 stock id，carrierRowIds 识别四个 stock disables；关闭时移除 bundle，恢复时重加。带 inject 的补丁不能通过 parseSimplePatch，仍需要按提示重启。

### 设置视图保留 canonical 持久化

两个宿主的 SettingsForms.write 按 configEditor.entries 返回值的 options.id 找条目，再从活跃 fiber 取 Config。公开 configure 仅接受 auto 展示策略，不支持注册 namespace 或 schema 别名。ConfigEditor.edit 还检查 entry 身份、活跃 fiber、继承层、name 断言与重载结果。因此仅转发 settings.update 的参数不够。

实现 `installHostSettingsAliases`，在只读校验后、ready 发布前安装可释放的 ConfigEditor.entries 包装。仅对 ui-chat/ui-conversation 返回 stock entry 的 Proxy：id/name/options/config 仍是 stock；fiber 视图使用 vendored 的 schema/uid/state，并通过官方 resolveConfig/interpolate 从 stock raw config 生成设置值。私有 entry 从配置编辑清单隐藏，实际 Loader 和 ClientModuleRegistry 不改。

这两个固定版本 UI 的 Host apply 只设置 auto:false；其 Config 仅供 SettingsForms 投影给浏览器，故不需要把 stock config 复制到私有行或更新 Host 任务运行配置。新适配注册同样的 auto:false，保留原生页面结构。

SettingsForms.describe/update/replace/mutate 及其 revision/事件协议保持原样，ConfigEditor.edit 仍负责锁、验证、canonical name 写入、原子持久化、层次冲突拒绝、重载与回滚。预检和视图安装不写文件；只有原生设置编辑写盘。这样停止使用插件时 stock 模块仍能读取相同设置，无需迁移或双写。

### 预检与生命周期

校验四个 vendored 来源唯一、路径真实匹配、独立 id、stock 来源为官方 canonical name 且 disabled。两个设置别名允许 stock config，但拒绝 private id 上的另一份 config；保留 session/subagent 的丢失配置检查及所有 isolate/intercept/inject、跳过 name 断言的检查。别名取值时再次检查当前来源和作用域，防止后续 HMR 引入外部 schema。

按 stock entry 和 vendored fiber 身份缓存稳定 Proxy，使 ConfigEditor.edit 在重载前后的身份核验有效。替换 fiber 时释放旧展示注册；卸载时还原原 entries 属性描述符、释放全部缓存。若后来的扩展已包装 entries，则不覆盖它，但把本闭包置为停用，让它保留的旧引用透明转发，不重建别名。

### 排除的替代方案

- 原生 settings.configure 没有 namespace/schema 注册 API；仅改它不能解决 canonical lookup。
- 改 vendored 客户端 namespace 并复制初始 config，不能保留卸载后的 stock 读取；不采用。
- app-boot 的非 insert name 是断言，其他字段直接覆写但没有 replace/name override 分支；不能用普通非 insert 换入口。
- YAML flow 表示或隐藏在 payload 中规避市场正则解析，仍然插入 stock id，依赖第三方解析遗漏；不作为正式方案。

## Risks / Trade-offs

- [宿主未提供别名扩展 API] → 只包装一个公开读取方法，保留原生编辑事务；严格限定固定 UI schema，并测试卸载还原与后置包装。后续宿主升级需复查该契约。
- [HTTP 引导正常掩盖偏好故障] → 实际调用 canonical settings.update、revision 冲突、mutate 重置，并冷启动和移除 bundle 检查持久化。
- [asar2 与 npm 启动禁用逻辑不同] → 分别运行 Desktop A/B 与 npm 独立 home；不把 asar2 的禁用过滤泛化。

## Migration Plan

构建仅生成 `.cache/preview-package`，替换 scratch 副本后复验；不修改用户安装。配置不迁移，原有 canonical id/name 继续有效。已由旧版本写入 vendored 路径 name 断言的用户 patch 会明确报冲突，不自动改写。回退或移除 bundle 后 stock 原生设置继续读取 canonical 配置。
