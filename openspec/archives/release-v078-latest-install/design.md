# Design

## Context

动机见 proposal.md。隔离实测中，DeepSeek Harness 0.2.0-rc.2 的无版本包名首次安装得到 registry latest，但已有固定或范围依赖时再次执行可能保留旧版本。显式 `@latest` 才在本次测试中把 0.7.6 更新为 0.7.7。当前开发 manifest 保持 private，公开包由已核验 lib 生成。

## Goals / Non-Goals

**Goals:** 安装入口同时满足首次安装和主动升级；将源码、preview、Desktop 与公开包证据连接到同一 v0.7.8。

**Non-Goals:** 不实现后台自动更新，不改第三方 CLI 协议，不以模拟或目录检查代表真实模型成功，不覆盖用户运行数据。

## Decisions

1. 使用 `dsh-cliworker-now@latest`。无版本虽然更短，但旧版升级实测未生效；固定版本仍保留于 Release 备用命令及回退记录。
2. 保留开发包 private，由 scripts/package-release.mjs 从核验构建生成公开 manifest。发布前比较源码/preview/正式包，发布后分别下载 npm 与 GitHub tarball 验证哈希。
3. 全量验收按平台记录。Windows 运行完整 suite，区分平台夹具问题、真实故障与明确不适用的 POSIX 行为，不以整组跳过掩盖故障。
4. 沿用市场 PR #6795，仅更新本插件条目；公开 tarball 可下载后才提交。市场合并状态以远端查询为准。

5. 设置目录缓存由 Host 管理，按机器/平台/项目/CLI 隔离，文件仅保存模型、强度和不可逆账号绑定；同宿主重复打开复用，重启后首次必须重新查询。相同内容不重写文件；账号、路由、路径变化及手动刷新使本轮缓存失效。缓存仅用于显示，保存选型和任务派遣仍做原生授权重检。
6. 目录识别不写项目偏好。有效默认值保留；不再可用的默认模型提示重新选择，不自动派遣或切换模型。
7. Windows 不支持 POSIX O_NOFOLLOW/mode 语义，OpenCode/Hermes/Pi 的私有读取补齐 lstat、句柄和读取后路径身份核对；精确权限位断言限定 POSIX，Windows 不把 mode 当作 ACL 证明。

8. Codex 从当前 app-server 的 initialize.userAgent 解析客户端版本，按本次版本读取同账号远端目录；远端真实 ID/强度可补齐原生旧缓存缺项。只有其他 CLI 的既有共享兼容路径保留旧参数，本 Codex 查询禁止猜版本。
9. CC Switch 的 Claude discovery 仅列 Stack，成功的原始空目录不代表角色映射失效；仅本机自身代理可保留已配置角色 ID。NAME 为标签，执行仍用角色 ID，费用未知并显示未核验说明；权限过滤后空、非本机空、认证/网络错误保持拒绝。
10. Windows 控制回执 Socket 仅写，避免自然退出被不存在的读通道阻塞；SQLite 快照与临时目录创建采用长路径入口，保持原路径与原生来源只读。

## Risks / Trade-offs

- latest 会随以后发布变化 → 保留明确的版本、哈希与固定版本备用安装命令。
- npm 身份可能过期 → 使用官方登录/发布认证，不存储到仓库或输出凭据。
- 第三方订阅和目录响应影响实机验收 → 分别记录目录、账号、模型生成范围，不扩大结论。
- 未关联的本地改动 → 按文件及补丁选择暂存，不清理或提交个人素材。
- 安装器默认新版本等待策略 → npm 公开后仍核对实际安装版本。本轮 Desktop 自带 pnpm 11.7.0 和开发 pnpm 11.25.0 在发布未满 24 小时时均保留 0.7.7；固定 0.7.8 安装与等待期后默认 `@latest` 升级是两项不同证据，不关闭用户保护、不提前勾选升级验收。

## Migration Plan

完成全量和 UI 核验后冻结公开包；提交源码并确认远端 CI，发布 npm 与 GitHub 同包，再验证 latest 升级并更新市场 PR。需要回退时执行固定 v0.7.7 安装命令；不回滚用户会话或账号数据。

## Sources

- [Codex app-server](https://learn.chatgpt.com/docs/app-server)：原生握手与模型目录。
- [OpenAI 模型与推理元数据](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)：账号目录及 reasoning 能力。
- [CC Switch handlers.rs](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/proxy/handlers.rs) 与 [model_mapper.rs](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/proxy/model_mapper.rs)：Claude Stack 辅助目录与角色模型映射分别处理。
