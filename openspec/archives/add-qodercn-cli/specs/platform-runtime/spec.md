# Spec Delta

## ADDED Requirements

### Requirement: 公共 Windows 路径发现
插件 SHALL 对所有受支持 CLI 复用有界的 Windows 路径发现流程，读取当前进程及当前用户/机器 PATH，并检查共享常见安装入口。版本专属位置及包身份 MUST 保留精确声明；显式配置优先、无关 GUI 不执行、不扫描任意磁盘或猜测最新版本。

#### Scenario: Desktop PATH 陈旧
- **WHEN** 受支持 CLI 已通过用户安装器加入用户或机器 PATH，而 Desktop 继承的 PATH 尚未更新
- **THEN** 公共发现层读取最新路径并按该 CLI 的入口规则解析，保留现有原生 argv 启动及取消清理边界。

#### Scenario: 显式损坏或跨版安装
- **WHEN** 显式入口损坏、不可访问，或候选实际属于另一 CLI/品牌
- **THEN** 保留该错误或拒绝候选，不静默替换显式入口、启动 GUI 或回退另一品牌。
