## ADDED Requirements

### Requirement: 手动切换插件下载
有插件接管方案、安装布局匹配的更新行，在官方更新器运行期间 SHALL 显示「切换插件下载」按钮。点击后 Host SHALL 按看门狗判定官方不可用的同一路径处理：发 TERM、确认官方进程树退出、清理本次半成品，再转插件接管；进程树退出前 MUST NOT 报告已切换，切换中按钮显示「正在切换…」并禁用。接管成功后 SHALL 写入 7 天官方失败记录。接管开始后按钮隐藏，「取消更新」保留。没有接管方案的 CLI（ZCode、CodeBuddy Code、WorkBuddy CN、WorkBuddy，以及 npm、brew 安装）不显示按钮；Hermes 只在拉取阶段显示。

#### Scenario: 官方下载太慢时手动切换
- **WHEN** Grok 官方更新进行中，用户点「切换插件下载」
- **THEN** Host 结束官方进程树并清理后转插件下载，行内显示插件下载进度

#### Scenario: 官方已结束
- **WHEN** 点击时官方更新已经完成、已切换或已取消
- **THEN** Host SHALL 返回对应状态，不重复切换，不改变结果

### Requirement: 取消后核对原安装
用户取消更新、进程树确认退出并清理后，Host SHALL 只读核对该 CLI 原安装（同一路径记录与根目录、版本可读、完整性），持维护锁，60 秒超时，MUST NOT 安装或写路径记录。结果 SHALL 显示为：原版本未变「已取消，原版本 X 未受影响」；版本已前进「已取消，但更新已完成：X」并刷新该行；安装损坏「已取消，安装已损坏：原因」并给出修复入口；核对失败或超时才显示「已取消。已写入的文件不会回滚，建议重新检查」。

#### Scenario: 取消 Grok 下载
- **WHEN** Grok 官方下载中被取消，`bin/grok` 仍指向 1.0.77
- **THEN** 行内显示「已取消，原版本 1.0.77 未受影响」，不使用错误色

### Requirement: 设置页是整机 CLI 管理
「CLI Worker 设置」SHALL 只管理本机的 CLI：安装、版本、连接与登录状态、账号、模型清单。这些读取和账号操作（登录、退出、切换、图形账号窗口）MUST NOT 以主对话的工作目录为前提、缓存键或进程工作目录；主对话没有目录或目录已不存在时 SHALL 照常工作。需要进程工作目录的探测和账号终端 SHALL 使用插件数据目录下固定的自有空目录（0700，拒绝符号链接与他人所有），该目录不含任何项目级 CLI 配置。设置页模型清单 SHALL 按整机口径展示（只读用户级配置）；Claude Code、Codex、Qoder、TRAE CN、CodeBuddy 等 CLI 的项目级配置（项目内的路由、密钥或模型设置）SHALL 只在派遣 Worker、续聊和为该项目保存模型偏好时按项目核验。项目模型偏好属于项目：主对话没有可用项目时设置页 SHALL 不带出偏好，保存偏好、派遣和续聊 SHALL 报「此主对话没有工作目录，请先选择项目」或「此主对话的工作目录已不存在（…），请切换到有效项目」。

#### Scenario: 会话目录被删除后打开设置
- **WHEN** 主对话的工作目录已被删除，用户打开「CLI Worker 设置」
- **THEN** 17 个 CLI 的连接状态、账号和模型清单照常读取与显示，不出现目录不存在的错误

#### Scenario: 没有项目时登录账号
- **WHEN** 主对话没有工作目录，用户在设置页点登录或退出
- **THEN** 账号终端或图形账号窗口照常启动，进程工作目录为插件自有空目录

#### Scenario: 项目里另有路由配置
- **WHEN** 某项目的 `.claude/settings.json` 把 Claude Code 指向另一个服务地址
- **THEN** 设置页仍显示本机用户级的登录状态和模型清单；在该项目派遣或保存模型偏好时按项目配置重新核验

#### Scenario: 没有项目时保存模型偏好
- **WHEN** 主对话的工作目录已不存在，用户在设置页保存某 CLI 的项目默认模型
- **THEN** 保存被拒并说明工作目录已不存在，需切换到有效项目；连接状态显示不受影响

### Requirement: Hermes 代码已更新但后续步骤未完成
Hermes 官方更新先提交代码，再做依赖与构建，后续步骤失败时回执仍是 success。Host SHALL 只按回执字段识别这一状态：`outcome` 为 success、`post_update.sha` 等于检出目录当前 HEAD，并且 `stages` 中 build 或 deps 为 failed，或 `followups` 非空。该状态 MUST NOT 显示为成功或失败：操作以 `incomplete` 阶段结束，行用警示色并提供「重试」，Host MUST NOT 执行成功后的残留清理。原因 SHALL 取自本次 `update.log` 的 `EPERM|EBUSY … rename` 行，脱敏、路径换成占位并截短；没有这一行时不写原因，MUST NOT 使用 `followups.reason` 或推测。「检查更新」SHALL 同样识别并写入行缓存。

#### Scenario: Node 依赖改名被拒
- **WHEN** Hermes 从 0.23.1 更新到 0.23.2，代码已切换，`node-deps.mjs` 改名 `node_modules` 报 EPERM，回执为 success、build 为 failed
- **THEN** 该行显示警示色「代码已更新到 0.23.2，后续步骤未完成」与改名那一行原因，并提供「重试」，不显示成功圆点或错误色

#### Scenario: 重启 Desktop 后
- **WHEN** 回执仍是未完成状态，用户重启 Desktop 并打开「更新 CLI」
- **THEN** Hermes 行仍在「可更新」，显示警示色原因与「重试」，不显示为「已是最新」

#### Scenario: 原因不是改名被占用
- **WHEN** 回执显示 build 未完成，但本次日志没有改名被拒的行
- **THEN** Host 只显示未完成状态与「重试」，不写原因

#### Scenario: 回执与当前代码不符
- **WHEN** 回执的 `post_update.sha` 不是当前 HEAD，或回执不是 success
- **THEN** Host 不判为未完成，按原有规则显示

### Requirement: Hermes 从中断处重试
未完成状态下，即使已装版本已是最新，Host SHALL 允许启动重试；回执没有未完成步骤时 SHALL 照旧拒绝对已是最新的版本启动更新。重试 SHALL 用参数数组运行官方命令 `hermes update --yes`，由 Hermes 补做未完成的步骤；Host MUST NOT 自己移动或删除 `node_modules`，MUST NOT 调用 Hermes 未公开的内部入口。输出与阶段文字 SHALL 写明「从中断处继续」，进度沿用官方六步，MUST NOT 伪造进度。目标提交已在 HEAD，重试 MUST NOT 启动拉取看门狗、插件预取或接管，MUST NOT 显示「切换插件下载」或「插件已下载目标代码」。重试进程失败时 MUST NOT 以版本已是目标回读为成功。

#### Scenario: 版本已是最新时重试
- **WHEN** 已装版本等于最新版本，回执仍有未完成步骤，用户点「重试」
- **THEN** Host 启动 `hermes update --yes`，输出写明从中断处继续、不重新应用代码；取码阶段长时间无输出不被判为停滞，不出现「切换插件下载」

#### Scenario: 重试后完成
- **WHEN** 重试写出的新回执不再有失败步骤和 followups
- **THEN** 操作以成功结束，行回到「已是最新」，照常执行成功后的清理

#### Scenario: 重试后回执没有换新
- **WHEN** 重试进程退出后，回执仍是重试前那一份未完成回执
- **THEN** Host 如实说明无法确认后续步骤已完成，保持未完成状态

### Requirement: Node 依赖改名被占用时自动重试一次
仅当未完成的原因是改名 `node_modules` 被拒（EPERM/EBUSY）时，Host SHALL 等待 10–15 秒后自动从中断处重试一次，并输出「Node 依赖改名被占用，自动从中断处重试 1/1」；其他原因 MUST NOT 自动重试。自动重试后仍未完成时，Host SHALL 只读列出可执行文件或命令行在 Hermes 目录内的进程，写出名字和 PID；没有这样的进程时只写「未发现占用进程」，无法列出时如实说明，MUST NOT 写出命令行内容或对占用者的猜测。

#### Scenario: 自动重试后完成
- **WHEN** 第一次运行因改名被拒未完成，自动重试写出的新回执没有未完成步骤
- **THEN** 操作以成功结束，不列进程

#### Scenario: 仍被占用时列出进程
- **WHEN** 自动重试后改名仍被拒
- **THEN** 结果为未完成，提示写出 Hermes 目录内仍在运行的进程名与 PID；一个也没有时只写「未发现占用进程」

#### Scenario: 其他原因不自动重试
- **WHEN** 未完成的原因不是改名 `node_modules` 被拒
- **THEN** Host 只运行一次官方命令，不枚举进程

## MODIFIED Requirements

### Requirement: 官方优先与看门狗
对于有已核实接管描述、且安装布局匹配的自带更新 CLI，Host SHALL 先执行官方更新命令，同时运行看门狗。出现下列任一情况，看门狗 SHALL 判定「官方渠道不可用」：

- 非零退出且版本未前进；
- 输出出现下载中断的特征文字；
- 下载阶段连续 10 秒没有进展：能读到字节的看暂存文件增长；读不到字节的（如 Grok）看更新器输出的下载状态文字有没有变化；
- 暂存文件大小回落；
- 60 秒窗口内平均速度低于 100 KB/s；
- 按当前速度预计会撞上官方硬时限；
- 进度不可观测时超出总预算。

10 秒计时只在下载阶段进行：更新器明确进入下载后开始，输出表明已下载完成或进入解压、安装、签名校验、杀毒扫描时停止，这些阶段 MUST NOT 因 10 秒规则被终止；从未明确进入下载阶段时只适用总预算。判定后，Host MUST 先发 TERM，等待片刻再终止整个进程树。确认进程范围已经退出后，Host 只删除本次运行产生的暂存文件，然后启动插件接管。没有接管描述的 CLI 保持原有执行方式。

#### Scenario: 官方下载断流
- **WHEN** Claude 原生更新的暂存文件停在 81 MB，10 秒没有增长
- **THEN** Host 终止官方进程树，确认进程范围退出后删除本次的 staging 目录，改由插件接管下载并显示「插件接管」进度；最终以重新探测到的版本判定成功

#### Scenario: 已是最新
- **WHEN** 官方命令以 0 退出并报告已是最新（例如 Kimi 的版本指针回退到低于已装版本）
- **THEN** Host 按「已是最新」报告；MUST NOT 判为不可用，MUST NOT 切换到接管，也 MUST NOT 降级

#### Scenario: 官方成功
- **WHEN** 官方命令成功，重新探测的版本到达或超过目标
- **THEN** 只按官方结果报告，不启动接管，并清除该 CLI 在本机的官方失败记录

#### Scenario: 看不到字节的官方下载
- **WHEN** Grok 官方更新输出「Downloading Grok 1.0.88...」后 10 秒没有新的下载状态
- **THEN** Host SHALL 判定官方渠道不可用并转插件接管；输出表明已进入解压或安装后，MUST NOT 再按 10 秒规则终止

### Requirement: 下载停滞检测与断点续传
插件自己掌控的下载（npm 主包 tarball、官方安装脚本、桌面安装包）SHALL 每 5 秒检查一次已下载字节（响应正文开始之前仍按原连接时限等待）；没有增长时 SHALL 中断连接，用 HTTP Range 从已下载位置继续，最多 200 次，总时长上限 2 小时。服务器不支持 Range 时 SHALL 整包重下，并计入同一次数预算。下载完成后 SHALL 校验官方长度或摘要；不符时 SHALL 删除文件并干净重下一次，仍不符才判为失败，校验通过前 MUST NOT 安装。外部命令只有在能读到下载字节时才适用停滞规则，否则页面显示「下载进度无法读取」，安装阶段另设 10 分钟上限。续传 200 次仍失败与超过 2 小时 SHALL 分开提示。取消时 SHALL 删除临时文件；失败或重启后临时文件保留 24 小时，总量有上限，用户重试时接着用。

#### Scenario: 停滞后续传
- **WHEN** 下载到 32 MB 后 5 秒没有增长
- **THEN** 插件中断连接，以 `Range: bytes=33554432-` 继续，进度区显示「已自动续传 1 次」

#### Scenario: 达到上限
- **WHEN** 第 200 次续传后仍然停滞
- **THEN** 判为失败，写「续传 200 次仍未完成」，提示可在页面底部切换下载源后重试；次数耗尽后不再主动换源，若仍有进展则继续当前连接至完成或总超时

#### Scenario: 校验失败
- **WHEN** 下载完成后 integrity 与官方源给出的值不符
- **THEN** 删除文件后干净重下一次，不消耗恢复计数；仍不符才失败且不执行安装

#### Scenario: 镜像元数据保留摘要但替换文件
- **WHEN** 镜像的目标版本元数据声明了与官方一致的 sha512，但 tarball 地址返回不同内容
- **THEN** Host SHALL 使用官方 sha512 验算实际文件；一次干净重下仍不符时返回 INTEGRITY_MISMATCH、删除临时文件，并且 MUST NOT 启动 npm 安装

### Requirement: 可续传下载的低速重连
Host SHALL 使用一处 100,000 B/s 阈值，每个 5 秒窗口新增少于 500,000 B 且仍有进展时（窗口从收到第一段正文开始计），仅对已证实支持 Range 的插件下载重连，共用 200 次计数；外部命令 MUST NOT 因低速被终止或重跑。

#### Scenario: 低速恢复保留已下载字节
- **WHEN** 206 或 Accept-Ranges: bytes 已证明续传能力，5 秒平均速度低于 100 KB/s 且仍有可用次数
- **THEN** Host SHALL 从已写入长度重新连接，并输出“下载过慢（X KB/s），从 Y 处重新连接（第 N 次）”；服务器忽略 Range 返回 200 后，后续 MUST NOT 再主动按慢速重连

#### Scenario: 次数用完后仍在前进
- **WHEN** 200 次已用完且正文仍在增长
- **THEN** Host SHALL 保持当前连接直到完成或 2 小时上限，不因低速报告失败；若真正 5 秒无增长才以次数耗尽失败

### Requirement: 官方同对象多源续传
Host 下载器 SHALL 提供 sources 列表能力，MiMo 配置官方双 FDS 源：API 域名优先、原域名备用；地址 MUST 匹配内置 host 与路径前缀白名单，无凭据，禁止重定向。最新版本查询 SHALL API 优先、失败回落原域名。首个成功源 HEAD SHALL 建立固定长度、ETag/content-md5 身份，换源前 MUST 核对目标 HEAD 一致；换源续传 SHALL 使用原已写字节的 Range/可用的 If-Range，核对 GET 身份及 206 范围，完成后核对长度与 content-md5（hex/base64），不符走一次干净重下。206 响应不带 Content-MD5 时，只要强 ETag 与初始身份相同、Content-Range 总长一致，SHALL 视为同一对象继续；整文件摘要仍在完成后核对。

#### Scenario: 慢速或中断轮换官方源
- **WHEN** MiMo 下载中断或达到已有低速重连条件
- **THEN** Host SHALL 在同一个 200 次/2 小时预算内选择下一个身份一致的源，继续 Range 并输出“切换到 <host> 继续下载（第 N 次）”；次数耗尽仍在前进时继续当前连接

#### Scenario: 换源身份不一致
- **WHEN** 备用源 HEAD 长度、ETag/content-md5 不匹配初始身份，或 GET ETag/MD5 不匹配已核实身份
- **THEN** Host MUST 拒绝换源或追加文件，不将不同对象片段合并

#### Scenario: 所有源不可用或校验重下仍失败
- **WHEN** 所有 HEAD 源不可用、GET 恢复预算耗尽或第二次完整文件校验仍失败
- **THEN** Host SHALL 报告失败，校验失败的文件 SHALL 删除，不执行安装器；取消 SHALL 停止回落/重试

#### Scenario: 续传响应省略摘要头
- **WHEN** Qoder 的 HEAD 与 200 响应带 Content-MD5，206 续传响应不带，但强 ETag 相同且 Content-Range 总长为 68148975
- **THEN** Host SHALL 接受续传，完成后用初始 Content-MD5 校验整个文件；ETag 缺失、为弱 ETag、改变或总长不同 MUST 拒绝追加

### Requirement: 分层缓存
CLI 状态缓存 SHALL 保存在插件私有目录，按本机保存，目录 0700、文件 0600，MUST NOT 进入 Git。CLI 路径与安装来源 SHALL 长期保存，在文件不存在或不可执行、真实路径变化、用户改了手动路径、本页刚装完或更新完时重读。当前版本 SHALL 长期保存，以真实路径、文件大小、修改时间（桌面应用再加应用包版本号）为指纹，指纹变化时重读。最新版本 SHALL 保存 6 小时，在超时、用户点「检查更新」、换了下载源时重查。账号登录状态 SHALL 保留上次结果用于显示，超过 10 分钟的在打开设置时原地静默重读，登录、退出、切换账号后立即重读；账号状态 SHALL 按 CLI 保存一份，MUST NOT 按项目或会话目录区分，换项目或会话没有目录不视为过期，也不重新探测；项目里的 CLI 配置只在派遣任务和为该项目选择模型时生效。缓存 SHALL 只保存显示需要的内容（版本号、来源、分区、检查时间、登录状态、界面上本来就显示的账号名），MUST NOT 保存令牌、Cookie、API Key 或命令输出。缓存文件读不出或格式不对时 SHALL 整份丢弃，按没有缓存处理，不报错。

#### Scenario: 账号状态过期
- **WHEN** 打开设置时某个 CLI 的账号状态缓存已有 15 分钟
- **THEN** 先显示上次的状态，同时原地重读，读完后替换

#### Scenario: 缓存损坏
- **WHEN** 缓存文件内容不是合法 JSON
- **THEN** 整份丢弃，页面按没有缓存加载，不弹错误

#### Scenario: 缓存不含凭据
- **WHEN** 检查缓存文件内容
- **THEN** 只有版本、来源、分区、时间、登录状态与显示用账号名，没有令牌或 Cookie

#### Scenario: 换项目不重读账号状态
- **WHEN** 某个 CLI 的账号状态 3 分钟前读过，用户切到另一个项目的主对话后打开设置
- **THEN** 直接显示同一份状态和同一个检查时间，不启动 CLI 进程

### Requirement: 项目连接状态静默预加载与缓存消费
连接状态属于本机，不属于项目（2026-11-17 用户决定）。Host SHALL 按 2026-11-14 用户决定，将除原生会话与交互外的账号、模型及原生强度纳入既有 60 秒后空闲预加载。后台 SHALL 使用已记录入口，复用前台完整查询、SettingsConnectionCache 分槽、同一 CLI 读取队列及维护锁；允许前台已有的原生服务初始化、令牌续期和插件私有运行配置写入，不额外发现 PATH；探测进程 SHALL 在插件自有的固定空目录中运行，MUST NOT 以任何会话目录作为前提、工作目录或缓存键。后台 MUST NOT 发 prompt、调用模型、创建原生任务会话、弹出终端/窗口/交互或自动升级；Kimi MUST 设置 KIMI_CODE_NO_AUTO_UPDATE=1，宿主代理环境 SHALL 保留。

#### Scenario: 范围与排除理由
- **WHEN** Host 构建后台连接队列
- **THEN** SHALL 纳入 Codex、Claude Code、Kimi、MiMo、Grok Build、OMP、Pi、Hermes Agent、OpenCode、ZCode 的账号和目录，以及 CodeBuddy 账号
- **AND** Antigravity（钥匙串交互）、Qoder/Qoder CN/TRAE CN（原生会话）、WorkBuddy CN/WorkBuddy（bootstrap 密钥）和 CodeBuddy 目录（session/new）SHALL 保留前台

#### Scenario: 项目已激活但设置未打开
- **WHEN** 后台检查开启且 Host 满足既有空闲条件，不论主会话有没有有效项目、激活过几个项目
- **THEN** Host SHALL 每个 CLI 只登记一次，共 11 个账号与 10 个目录项，再多的项目也不增加连接项；仅执行已启用且有已记录安装入口的项；后台连接项 SHALL 串行执行，模型和强度不得来自猜测

#### Scenario: 后台被任务或登录打断
- **WHEN** 连接项尚未完成而新任务、登录窗口或更新操作开始
- **THEN** Host SHALL 中止当前项并等待进程范围清理，清理后空闲至少 30 秒再重试，旧取消结果不得写入任何展示缓存

#### Scenario: 前台与后台同一 CLI 并发
- **WHEN** 设置页查询或显式刷新与后台读取同一 CLI
- **THEN** 同一 CLI 同槽的普通读取 SHALL 合并，强制刷新 SHALL 等旧查询清理后重查；同一 CLI 的账号槽与目录槽 SHALL 串行，不重复启动并行原生进程，也不吞掉前台请求

#### Scenario: 单槽失败或 Host 停用
- **WHEN** 一个账号或目录读取失败，或 Host 停用
- **THEN** 普通失败 SHALL 仅写对应槽 error 而不阻断其他 CLI；清理未确认 SHALL 隔离该 CLI，停用 SHALL 中止并等待全部在途读取及进程清理

### Requirement: 连接快照、过期更新与来源作废
Host SHALL 按 Host 生命周期和 CLI 保存连接展示缓存（整机一份，缓存键与回执 MUST NOT 含项目），账号与目录分别保存 checkedAt、过期状态和 revision，10 分钟有效，时钟回拨视为过期。设置首屏 SHALL 可取得已有快照；请求连接状态 SHALL 先返回已有结果并对缺失或过期槽现查，通过订阅推送更新。未过期槽 MUST NOT 重复启动探测。旧接口 SHALL 仍兼容，强制刷新 SHALL 不被正在进行的读取吞掉。

#### Scenario: 缓存已命中
- **WHEN** 某个 CLI 的账号及目录均未过期
- **THEN** 设置查询直接得到账号、模型和强度及 checkedAt，不再启动 CLI 进程

#### Scenario: 过期或未核实登录
- **WHEN** 账号缓存过期或 authenticated 没有 verification
- **THEN** 展示快照 SHALL 将其降为 unknown，不得显示绿色已登录；查询失败 SHALL 清除旧成功值并发布该次读取的真实原因，MUST NOT 以通用失败文案替换已知原因

#### Scenario: 登录或入口变化期间旧查询返回
- **WHEN** 登录/退出/账号切换、CLI 启用状态或执行入口发生变化
- **THEN** Host SHALL 作废该 CLI 的账号和目录缓存、增加 revision、中止旧查询并等待清理，旧回执不得恢复已作废内容

#### Scenario: Host 停用或项目切换
- **WHEN** Host 停用或客户端切换项目
- **THEN** 停用 SHALL 中止并等待所有读取及清理订阅，重启不得将上次 Host 的登录缓存当作已核实状态；切换项目 SHALL 继续使用同一份连接快照，不作废、不重新探测

#### Scenario: 主对话没有目录、目录已不存在或换了项目
- **WHEN** 打开设置的主对话没有工作目录、工作目录已被删除，或先后在两个不同项目的主对话里打开设置
- **THEN** 连接快照、连接状态、账号状态与订阅 SHALL 照常返回同一份结果，同一 CLI 在有效期内只探测一次，MUST NOT 报目录错误

#### Scenario: 维护期读取被拒不显示为连接错误
- **WHEN** 账号或目录读取因该 CLI 正在更新（MAINTENANCE）被拒
- **THEN** 连接缓存 MUST NOT 把它记为读取错误（不显示红点）；更新以任何结果结束（成功、失败、取消）并释放维护锁后，Host SHALL 作废该 CLI 的连接显示缓存，让设置页重新读取
