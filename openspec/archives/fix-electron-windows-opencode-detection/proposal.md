# Proposal

## Why

Windows 实机已安装 OpenCode npm CLI 和桌面随附 CLI，普通 Node 探测成功，但插件账号与模型页同时报“桌面 CLI 入口不可用”。一次可逆 Host 诊断确认实际选中正确的 npm PE console CLI，却在检查不存在的 `resources/app.asar` 时遭 Electron 44.0.0 抛出无 code 的 `Invalid package`。现有测试只覆盖普通 Node，未覆盖归档虚拟文件系统的这一差异。

## What Changes

- Windows 安装身份与文件可用性检查使用磁盘文件语义，兼容 Electron 宿主中的存在及缺失 ASAR 标记。
- 保留有效 npm CLI、桌面独立 CLI、显式路径优先级以及权限/损坏错误边界；不修改宿主全局 ASAR 行为。
- 补最小专项回归和 Windows 实际插件状态验收；记录未执行真实登录与模型生成。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `platform-runtime`: Windows 桌面安装探测须按物理文件判断，而不受 Electron ASAR 虚拟目录影响。

## Impact

影响 Host Windows 桌面入口 helper、对应测试及使用/设计记录。没有 Client 协议、凭据或持久化格式变更；不增加运行依赖，不修改 Harness 核心。保持 v0.7.8，仅本地提交，不推送或发布。
