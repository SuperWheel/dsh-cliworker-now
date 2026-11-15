# Proposal

## Why

2026-11-15 用户提供 Windows、DSH 0.2.2-rc.3、插件 200d97f 的磁盘耗尽证据：catalog/query-*、OMP identity/login-options 和 Qoder CN metadata 持续遗留，OMP 每个隔离 HOME 解包约 128 MB native addon。源码确认四处直接删除缺乏重试、finally 删除异常会掩盖结果，extendedCatalog 失败路径不删除，且没有过期清扫。

## What Changes

- 统一临时树尽力删除，Windows 瞬时占用有限重试；已确认退出的失败查询也删除，进程范围未确认退出则保留。
- OMP 元数据与权限帮助探测共用插件私有 natives 缓存；保留最新三个版本，跳过近期目录。
- Host 启动异步清扫，目录查询创建前节流清扫；仅插件命名的过期真实目录，不跟随链接。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `host-lifecycle-durability`: 临时资源回收、后台清扫生命周期与 OMP 探测缓存。

## Impact

仅 Host、原生 OMP 元数据桥、打包清单与测试；Client、Gateway 协议、版本和正式 Worker 的原生 HOME/运行环境不变。文档补充存储布局。

## 成功指标（基线、目标）

基线为用户实机遗留与当前失败路径。目标是已确认退出的成功/失败探测都尝试带重试删除，删除失败不改变探测结果；模拟测试核对清扫边界与缓存注入，Windows 实机由用户复验磁盘增长与锁释放。

## 范围外

不读取真实凭据或 .env，不启动真实模型，不提交、升级版本、更新 Desktop 或清除现有进程保护标记；不把自动测试作为 Windows 实机证据。
