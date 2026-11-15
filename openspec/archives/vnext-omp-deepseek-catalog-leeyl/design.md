## Context

`discoverPiOmp → confirmedCatalog` 分两阶段：`native-candidates` 保存原生摘要；OMP 的 `account-scope` 再刷新原生目录，然后 `accountSupportedChoices` 按路由分组查询账号交集。OMP 摘要没有 baseUrl/api，而 builtinAPI 没有 deepseek，分组时直接 continue。parseCatalog 遇到无效项会抛错，不会静默过滤。

## Goals / Non-Goals

恢复 DeepSeek API 登录的原生候选账号查询，不扩大候选范围，不把目录读取当推理验收；不改真实凭据、全局配置或 Desktop 链接。

## Decisions

1. 在既有 builtinAPI 表补充 deepseek 默认地址 `https://api.deepseek.com` 与 `DEEPSEEK_API_KEY`。本机 OMP 18.20.2 可执行文件内置原生 registry 中 `We("deepseek", "deepseek", "https://api.deepseek.com", ...)` 与 API key 名可核实；不硬编码 model ID。
2. 保持优先级：SDK model 路由、model 自定义、provider 自定义先于默认；OMP 登录 API 优先于默认环境凭据。鉴权覆盖、未知范围和失败仍按既有保守策略处理。
3. Pi 1.5.2 SDK 提供 baseUrl/api，模拟 DeepSeek 登录发现 2 个原生候选且原过滤已能输出 2 个，无 OMP 的地址缺失问题。共享默认表也补齐环境凭据来源；不借用 OMP 真实密钥测试 Pi。

## Risks / Trade-offs

原生上游默认地址可能变化；只以当前核实路由补全摘要，不创造模型。不接受远端新增但原生不支持的 ID。后续 Windows/Desktop 仍需独立验证。

## Migration / Rollback

无持久化迁移与新依赖；移除默认表新增项即可回退。诊断仅在 0700 临时目录复制账号；模型查询不写真实账号目录。无 UI 或生命周期变更。

## Open Questions

无阻塞实现问题。Mac/Windows Desktop 下拉框与实际推理不在本次验收范围。
