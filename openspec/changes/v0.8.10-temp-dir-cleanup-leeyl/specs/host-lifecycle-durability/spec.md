## ADDED Requirements

### Requirement: 临时探测树尽力回收
Host SHALL 在确认进程范围退出后回收成功或失败的目录查询、身份、登录选项和 Qoder 元数据临时树；删除 SHALL 对瞬时占用有限重试，最终失败 MUST NOT 覆盖查询原结果。ProcessCleanupUnconfirmedError SHALL 保留临时树与现有保护。

#### Scenario: 已确认退出的查询拒绝
- **WHEN** 查询拒绝且进程范围已确认退出
- **THEN** 删除临时树并保留原始查询错误

#### Scenario: Windows 短暂占用
- **WHEN** 已成功的探测删除时遇 EBUSY 或 EPERM
- **THEN** 有限重试；即使最终失败，仍返回成功探测结果，遗留交给后续清扫

#### Scenario: 进程范围退出未确认
- **WHEN** 探测抛出 ProcessCleanupUnconfirmedError
- **THEN** 当次不删除仍可能被使用的临时树，不解除 CLI 保护

### Requirement: 限定范围的过期清扫
Host SHALL 在启动时非阻塞清扫，并在创建目录查询前节流尝试清扫。清扫 MUST 仅处理状态目录 catalog 下 query-* 及系统临时目录中插件 mkdtemp 前缀的真实目录，至少一小时未修改，排除符号链接、junction、年轻目录、外部名称及已知活动目录；不得跟随链接。锁定目录 SHALL 跳过并在后续清扫重试。卸载 SHALL 取消后续扫描并等待已开始的清扫结束。

#### Scenario: 混合临时目录
- **WHEN** 扫描同时发现旧插件目录、年轻目录、同名前缀符号链接和外部目录
- **THEN** 只删除旧插件真实目录，链接目标和其他目录保持

#### Scenario: 后台清扫失败或卸载
- **WHEN** 某目录锁定或 Host 开始卸载
- **THEN** 失败不阻止启动和查询，卸载后不再开始新的清扫步骤

### Requirement: OMP 探测共用私有 native 缓存
OMP 元数据与权限帮助探测 SHALL 使用状态目录内 0700 的 omp-natives 作为 PI_NATIVES_DIR，不使用用户 ~/.omp；正式任务原生运行环境 SHALL 保持原行为。缓存 SHALL 保留最新三个版本，过期版本回收遇占用可延后，不删除近期版本。无同等能力证据的 Pi SHALL 不注入该变量。

#### Scenario: 连续 OMP 探测
- **WHEN** 身份、目录、登录选项或权限帮助探测先后启动
- **THEN** 所有探测使用同一个插件缓存目录，保持代理变量，隔离账号 HOME 和配置不变

#### Scenario: 多版本缓存
- **WHEN** 缓存存在超过三个版本目录
- **THEN** 回收最新三个以外且至少一小时未修改的真实版本目录，不跟随链接

### Requirement: Windows 短时 CLI 查询使用私有临时目录
Host SHALL 为 Windows 短时 CLI 探测、账号、元数据、目录及版本查询设置每次独立的 TMP/TEMP；目录 SHALL 使用插件前缀与 owner marker，并在托管进程范围确认退出后尽力删除。MUST 保持代理环境和 argv 数组，MUST NOT 改变正式 Worker 与官方更新的运行环境。

#### Scenario: 查询结束或启动失败
- **WHEN** Windows 短时查询成功、失败或启动失败，且不存在未确认退出的进程范围
- **THEN** 回收本次私有目录及其中 Bun DLL，磁盘删除失败不覆盖查询结果

#### Scenario: 未确认退出与历史 DLL
- **WHEN** 进程范围退出未确认，或系统 Temp 存在共享名称的历史 Bun DLL
- **THEN** 保留该次目录与 owner marker，由既有安全清扫延后处理；不扫描或删除共享 Temp 的历史 DLL

#### Scenario: Worker 与官方更新
- **WHEN** 启动正式 Worker 或官方更新
- **THEN** 不应用短时查询的 TEMP 入口，沿用各自既有环境与清理
