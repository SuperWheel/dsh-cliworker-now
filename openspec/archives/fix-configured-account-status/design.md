# Design

## Context

见 proposal.md。`zcodeGrokAccountLaunch` 为退出生成原生 `logout` 参数，使用与 Worker 相同的 `ZCODE_DATA_BASE_DIR`；插件没有自行修改绑定的步骤。`projectZCodeIdentity` 优先解析绑定：匹配手工 API 指纹为 API configured，OAuth 身份无法确认的完整绑定为 configured 并要求重新登录。只有该投影为 unconfigured 或凭据文件不存在，`zcodeGrokAccountStatus` 才回退到 `readZCodePersonalIdentity`，有 API Key 则显示 API configured。

`AccountsWindow` 仅为 authenticated 且没有 logins 的状态合成单账号行；ZCode configured 无 logins，因此上述两种路径均显示空窗口。`FlowGuide.proves` 的整账号退出确认接受非 authenticated 状态，故成功结果页也不能区分二者。现场缺少安全摘要的实际回读，不能确认具体 Windows 分支。

## Goals / Non-Goals

**Goals:** 保留 Host 已给出的判断，覆盖退出后刷新、导航、账号摘要以及其他 CLI 的 configured 原因。

**Non-Goals:** 不改变认证语义或退出命令，不新增绑定删除或协议字段，不读取真实账号，不把测试夹具当作原生 CLI 清理结果。

## Decisions

- configured 的显示在 `connectionStatus` 统一使用 `hostText(summary)`，账号摘要复用其 label。避免按中文关键词判断状态，也避免为各 CLI 单独维护名单。
- 沿用 unverified 灰点。Host 的 configured 仍是未确认，不升级为 connected，也不凭文字强行改为失败。
- 配置摘要允许换行，保留现有字体、行高、间距和主题 token；长原因不挤出容器，不新增第二段说明。
- 不修改 Host：没有找到插件退出遗漏删除的证据；原生命令负责清理。用合成文件模拟退出后的三种存储形态及原生手工 API 指纹分支，验证读取无写入、无秘密投影。
- README、设置设计规范及 doc/design.md 记录新的展示规则。存储、权限、生命周期均不变。

## Risks / Trade-offs

- [Host 未来给出较长摘要] → 使用现有安全文本翻译与自然换行；摘要内容由 Host 负责，Client 不截掉可操作原因。
- [不能定位 Windows 现场分支] → 保留未验证项，要求后续新预览包实际回读摘要；本次只依据源码和模拟证据。
- [共享工作区同时修改] → 只修改相关行，不提交、不重置、不覆盖其他会话工作。

## Migration Plan

无数据迁移。先运行关联测试、typecheck 与隔离 preview；Desktop 更新与 Windows 真实复测留待后续。回退仅需撤回本次 Client 展示与样式变更，无账号数据恢复步骤。
