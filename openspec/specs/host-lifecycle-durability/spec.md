# host-lifecycle-durability Specification

## Purpose

保证 Host 在停止、崩溃恢复和异常环境下仍能正确清理进程与资源、保留完整的事件记录：停止不因持久化失败而卡住，存储有独占锁，事件日志断尾可恢复，子进程环境与 CLI 输出解码有明确边界。

## Requirements

### Requirement: 停止不依赖持久化成功
停止 Worker SHALL 先在内存撤销该会话已排队消息的发送资格，并中止预约、插队消息、准备与当前运行；后续消息状态写盘失败 MUST NOT 阻止取消，而应在进程范围退出、启动资源释放后作为本次停止的错误报告。Host 卸载 MUST 逐个隔离各 Worker 的停止异常，其余 Worker 仍完成停止且存储锁被释放。

#### Scenario: 停止时写盘失败
- **WHEN** 用户停止运行中的 Worker，而后续消息队列文件写入抛出错误
- **THEN** 当前运行仍被中止并等待进程退出，旧代际消息不再被发送，启动资源照常释放，停止结果报告持久化失败

#### Scenario: 卸载时某个停止同步抛错
- **WHEN** Host 关闭时某个 Worker 的停止调用同步抛出异常
- **THEN** 其他 Worker 照常停止，Host 继续完成关闭并释放存储锁

### Requirement: 存储独占锁
同一存储目录 SHALL 在任意时刻至多由一个存活 Host 持有。获取与回收失效锁 MUST 不存在“检查后删除”竞态：Host 只能删除确认属于已退出进程且以唯一名称标识的锁，不得删除其他存活 Host 的锁；无法解析的锁 MUST 拒绝并提示人工检查。判断锁的持有进程是否存活时 MUST 同时核对进程号与进程启动时间：进程号仍在使用、但该进程启动时间晚于锁文件写入时间的，说明进程号已被复用，原 Host 已退出；无法取得启动时间时 MUST 按存活处理。

#### Scenario: 两个 Host 同时回收失效锁
- **WHEN** 上一个 Host 异常退出留下锁，两个新 Host 并发启动
- **THEN** 至多一个 Host 取得存储，另一个报告存储已被占用；不会两者同时成功

#### Scenario: 存活 Host 持有存储
- **WHEN** 存活 Host 持有锁时另一个 Host 启动
- **THEN** 后者拒绝启动，不修改前者的锁

#### Scenario: 遗留锁的进程号已被复用
- **WHEN** 上一个 Host 未释放锁就退出，其进程号随后分配给一个晚于锁文件写入时间启动的其他进程，新 Host 启动
- **THEN** 新 Host 判定该锁已失效并回收，正常取得存储；无法确认该进程启动时间时仍按存活处理并拒绝启动

### Requirement: 事件日志断尾恢复不丢失完整记录
读取 Worker 事件日志时，仅最后一行未以换行结束的残缺追加 SHALL 被丢弃；修复 MUST 原地截断到最后一个完整换行，不以截断后重写的方式处理完整前缀，修复失败时完整前缀仍保持。

#### Scenario: 修复写入失败
- **WHEN** 事件文件末尾有残缺行，且恢复过程中文件写入接口失败
- **THEN** 已完整记录的事件字节保持不变

#### Scenario: 多字节字符断尾
- **WHEN** 残缺尾部包含不完整的多字节 UTF-8 字符
- **THEN** 文件被截断到最后完整换行，完整前缀逐字节不变

### Requirement: Windows Codex 子进程环境边界
Windows Codex 后台启动 SHALL 仅以本次启动的显式环境和 Codex 管理标记构造子进程环境；宿主进程环境 MUST NOT 被整体复制进子进程环境，宿主对密钥类变量的过滤由宿主进程后端负责。

#### Scenario: 宿主环境含无关密钥
- **WHEN** Host 进程环境含有与本次 CLI 无关的 `*_API_KEY`、`*_TOKEN`、`*_SECRET` 或 `DSH_*` 变量
- **THEN** 准备好的 Windows Codex 启动环境不包含这些变量，显式启动变量保持

### Requirement: 工具桥 lease 异常清理
CLI 工具桥 lease 取得后 SHALL 由异常清理保护；在 lease 交还调用方之前，任何保存或通知失败 MUST 关闭 lease 并恢复子 Agent 展示模式，再报告原错误。

#### Scenario: 保存能力状态失败
- **WHEN** 工具桥已创建，而保存 Worker 能力状态抛出错误
- **THEN** 工具桥监听被关闭，展示模式恢复，启动报告该错误

### Requirement: CLI 输出按字节流解码
读取 CLI 目录查询输出 SHALL 按字节流解码 UTF-8；跨数据块的多字节字符 MUST 完整还原。

#### Scenario: 中文模型名跨块
- **WHEN** CLI 输出的中文字符的字节被拆分到两个数据块
- **THEN** 解析结果包含完整字符，不出现替换字符

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
