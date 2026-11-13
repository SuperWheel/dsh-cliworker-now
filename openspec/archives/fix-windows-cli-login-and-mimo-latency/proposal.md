# Proposal

## Why

实际 Windows Desktop 0.7.6 验收暴露账号终端关闭后残留、ZCode/OMP 终端失败、Pi/OpenCode 官方启动入口误报未安装，以及已登录账号模型目录不可用的问题。MiMo 一组无模型元数据命令约 6 秒，重复检查造成显著启动等待，需要在保持账号隔离的前提下修复并实际复验。

## What Changes

- 追加修复 macOS/Windows Hermes Nous 登录频繁过期：区分短期 invoke JWT 到期与原生登录失效；同一明确账号可续期时调用有界、非交互的原生刷新并保留轮换凭据，健康凭据不额外启动进程。账号、模型目录及派遣边界保持同源校验，临时网络失败不误报必须重登。

- 本轮追加 ZCode 授权来源选择：按实际安装的原生命令能力提供中国 BigModel 与海外 Z.AI，未知/不支持的能力明确说明，不自动替换凭据、拼造 OAuth 地址或静默回退。重新追踪整个设置页首次打开、后台账号检测、模型刷新与登录的 Windows 可见窗口和所属进程，修复遗漏的启动路径。

- 用户新增 Windows 模型/启动回归：修复 Codex、OMP、Pi 模型和思考强度读取、OMP 首次检测误报及 OpenCode 登录/刷新模型弹控制台；测量各 CLI 设置查询冷/热耗时，减少重复进程及同时启动争抢，保持实时账号/权限核验。ZCode 上轮保留官方默认登录；本轮按用户最新要求增加可核验的 BigModel／Z.AI 原生授权选择。

- 2026-10-11 用户追加实际 Windows 回归：去除所有账号终端粗黑外框，修复系统剪贴板粘贴，重新核验 Codex/Hermes 已有安装识别及 ZCode 登录后续错误。上轮键盘输入/菜单出现不替代剪贴板和完整登录验收。

- 安全识别 Windows 官方固定 npm 原生入口和 Pi 管理式启动器；核验 Pi 1.1.0 原生契约后支持当前安装，不放开任意 batch。
- 统一账号终端关闭的等待、失败与重试；修复 Windows 自有终端进程清理，提供不含凭据的启动/退出诊断。
- 按安装版本真实支持的登录能力处理 ZCode/OMP；修复可证实的 OAuth 账号状态、身份绑定与模型发现不一致，并保留必须用户授权或原生不支持的明确边界。
- MiMo 仅缓存不含凭据的短期原生能力元数据，消除同一次操作的重复启动；实时重读自身账号和配置，账号授权与撤销检查不缓存。
- 修复实际验收发现的明确派遣误判：插件名称与工具参数不当作 CLI 名称，同一 CLI 的括号别名与重复指令归一；不同或未知目标仍拒绝猜测。
- 在实际 Windows 中比较优化前后元数据与任务耗时；先隔离构建回归，再无活动任务时更新 Desktop 并复验登录、启动、续聊及停止。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `platform-runtime`：官方 Windows 入口识别、版本身份和原生终端范围清理。
- `cli-connection-health`：账号终端可靠关闭、短错误和恢复入口。
- `cli-model-discovery`：能力元数据复用与当前 OAuth 模型目录的证据一致性。
- `cli-account-isolation`：优化后继续按当前自身账号/配置核验，不由缓存恢复认证。
- `worker-dispatch`：明确目标的同名别名归一及插件工具说明排除，保留多目标和未知目标边界。

## Impact

涉及 native-launch、Pi installation、账号 Host/Client 生命周期、first-party models/account binding、MiMo metadata、相关测试、README 和设计/实际记录。保持 Harness 核心、SDK、用户技能及既有会话/账号不变。用户已授权修复与此前的最小模型选型；不自动购买额度、不伪造原生模型能力、不承诺供应商响应延迟，缺少安装/授权的 CLI 保留实证边界。
