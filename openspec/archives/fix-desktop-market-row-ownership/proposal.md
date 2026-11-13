# Proposal

## Why

市场按 bundle 插入的 id 判断行归属，本插件复用四个 stock UI id 后，禁用记录重放会关闭宿主原生界面。直接使用私有 id 又会破坏原生设置 lookup，因此需要同时分离 Loader 所有权和保留 canonical 设置身份。

## What Changes

- 四个 vendored UI 改为插件独立 id，stock disables 只属于当前 bundle 层，保留官方客户端包名与唯一来源。
- 只读预检验证两组行的来源及配置边界；以可释放的 ConfigEditor.entries 设置视图保留原生 namespace、配置层次和持久化。
- 继续使用宿主 SettingsForms/ConfigEditor 的编辑事务、revision、重置与失败回滚，不迁移或双写配置。
- 补充归属、预检、设置与清理回归，以及双宿主的启用/禁用、重启和移除 bundle 隔离证据。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `package-distribution`：市场禁用的归属边界，以及替换界面来源时保留原生设置的要求。

## Impact

修改 `cordis.patch.yml`、`scripts/host-extension-guard.mjs`（构建复制到 `lib/native-runtime-guard/index.mjs`）、测试与安装说明。构建直接复制 patch，无另一份生成模板。版本保持 0.8.2；不修改用户安装、真实配置、Harness 核心或市场，不调用模型，不提交、推送或发布。
