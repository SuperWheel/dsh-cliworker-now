# Proposal

## Why

Windows 预览包 c7a5eb2 中，ZCode 退出后的设置页显示灰色「已配置」，掩盖可能存在的「绑定未确认，请重新登录」。`settings-dialog.tsx` 的导航状态和账号摘要均丢弃 configured 状态的 Host summary，其他 CLI 的登录检查或续期提示也受影响。

## What Changes

- 设置导航和账号摘要统一保留 configured 的安全 Host 摘要；无摘要才回退「已配置」。沿用中性灰点，长原因允许自然换行。
- 通过合成夹具覆盖 ZCode OAuth 退出后残留绑定、仅 API Key、无认证三种投影及账号窗口刷新，保留原生退出和 API 配置。
- 对 MiMo、Pi/OMP/OpenCode、Hermes 等 configured 原因加入展示回归，同步用户说明。
- 源码显示 ZCode 退出委托原生 `logout`，与 Worker 共用认证目录；没有插件自行删除绑定的实现。仅凭空账号窗口不能区分残留绑定和 API 配置，Windows 实际分支保持未证实，不推测清理故障或新增文件删除。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cli-connection-health`: configured 的短原因不得被泛化状态覆盖。

## Impact

涉及 Client 设置状态、样式、相关合成测试、README 与设置设计文档；不改变 Host 认证判定、协议、存储、原生命令或安装方式。版本保留 0.8.4，不触碰真实凭据、账号、模型、Desktop 链接及禁止修改的原生桥文件。
