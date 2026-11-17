## MODIFIED Requirements

### Requirement: 连接快照、过期更新与来源作废
Host SHALL 按 Host 生命周期、项目和 CLI 隔离连接展示缓存，账号与目录分别保存 checkedAt、过期状态和 revision，10 分钟有效，时钟回拨视为过期。设置首屏 SHALL 可取得已有快照；请求连接状态 SHALL 先返回已有结果并对缺失或过期槽现查，通过订阅推送更新。未过期槽 MUST NOT 重复启动探测。旧接口 SHALL 仍兼容，强制刷新 SHALL 不被正在进行的读取吞掉。

#### Scenario: 缓存已命中
- **WHEN** 同一项目与 CLI 的账号及目录均未过期
- **THEN** 设置查询直接得到账号、模型和强度及 checkedAt，不再启动 CLI 进程

#### Scenario: 过期或未核实登录
- **WHEN** 账号缓存过期或 authenticated 没有 verification
- **THEN** 展示快照 SHALL 将其降为 unknown，不得显示绿色已登录；查询失败 SHALL 清除旧成功值并发布该次读取的真实原因，MUST NOT 以通用失败文案替换已知原因

#### Scenario: 登录或入口变化期间旧查询返回
- **WHEN** 登录/退出/账号切换、CLI 启用状态或执行入口发生变化
- **THEN** Host SHALL 作废相关 CLI 各项目的账号和目录缓存、增加 revision、中止旧查询并等待清理，旧回执不得恢复已作废内容

#### Scenario: Host 停用或项目切换
- **WHEN** Host 停用或客户端切换项目
- **THEN** 停用 SHALL 中止并等待所有读取及清理订阅，项目快照不得串用，重启不得将上次 Host 的登录缓存当作已核实状态

#### Scenario: 维护期读取被拒不显示为连接错误
- **WHEN** 账号或目录读取因该 CLI 正在更新或安装（MAINTENANCE）被拒
- **THEN** 连接缓存 MUST NOT 把它记为读取错误（不显示红点）；安装结束并释放维护锁后，Host SHALL 作废该 CLI 的连接显示缓存，让设置页重新读取

#### Scenario: CLI 更新或版本变化不作废账号与模型
- **WHEN** 某个 CLI 经「更新 CLI」页更新结束（成功、失败或取消），或 CLI 自行升级后 Host 发现其版本指纹变化
- **THEN** Host MUST NOT 因此作废该 CLI 的账号与模型显示缓存或增加 revision；账号与模型照常按 CLI 自身的登录规则和 10 分钟有效期重读，CLI 更新后仍保留登录时插件也显示已登录
