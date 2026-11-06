## ADDED Requirements

### Requirement: 安装驱动的 Pi 和 OMP 登录选项
Pi 与 OMP 的登录选项 SHALL 来自当前所选安装的原生可登录服务商注册表，完整保留当前平台可用的原生 ID，并区分智谱国内 BigModel 与国际 Z.AI。未知或读取失败 MUST 不回退猜测列表，仍提供原生终端入口；启动所选登录前 MUST 再确认该安装支持该 ID。

#### Scenario: 安装包含额外提供商
- **WHEN** 当前 Pi 或 OMP 注册表包含固定列表遗漏的 API Key 或 OAuth 服务商
- **THEN** 添加账号列表展示全部原生可用项，使用其自身登录参数；原生未支持的另一 CLI 的 ID 不得混入

#### Scenario: 平台或版本不同
- **WHEN** macOS 与 Windows 的已安装版本提供不同选项，或用户切换 CLI 路径
- **THEN** 选项按当前安装读取，旧安装缓存不得用于新安装；不可用方式不显示为可直接登录

#### Scenario: 发现失败
- **WHEN** 原生注册表不可读或查询进程未确认退出
- **THEN** 不展示编造的直接登录项；进程清理未确认时继续暂停该 CLI，其他失败保留原生终端入口

### Requirement: Pi 和 OMP 按来源与凭据确认退出
Pi/OMP 退出 SHALL 仅作用于明确选择的来源和原生凭据；OMP 同服务商多凭据 MUST 按稳定凭据 ID 定位，不按邮箱、密钥、排序或当前高亮猜测。原生调用及目标存储回读确认删除后才报告成功；无法识别、读取失败、取消或进程清理未确认 MUST 不报告成功。其他来源、同服务商其他凭据和配置凭据 SHALL 保留。

#### Scenario: OMP 新旧 key 共存
- **WHEN** 用户退出同 provider 的旧凭据 id=1，另有新凭据 id=2
- **THEN** 只向原生流程提交 id=1，确认 id=1 消失且 id=2 保留后报告成功

#### Scenario: 新版有边框菜单
- **WHEN** OMP 的凭据选择行含原生面板边框
- **THEN** 精确识别选中凭据 ID；无法确认高亮或行被截断时停止自动选择，绝不猜测回车

#### Scenario: Pi 无交互退出
- **WHEN** 用户退出 Pi 某一服务商
- **THEN** 原生 SDK 仅操作所选 auth 存储并回读，不因无关会话/工具/交互 UI 初始化阻塞退出

#### Scenario: 替换未完成
- **WHEN** 新凭据已保存但指定旧凭据的原生退出未确认
- **THEN** 不宣称替换完成，明确保留失败状态，不自动删除其他凭据或放宽模型交集规则

#### Scenario: Distinguish OMP credentials without exposing keys
- **WHEN** 同来源同 provider 有多条 OMP 凭据
- **THEN** 账号行和替换选项 SHALL 展示原生凭据编号，退出请求保留完整来源/provider/id，不能按列表顺序猜测目标或显示 API key。
