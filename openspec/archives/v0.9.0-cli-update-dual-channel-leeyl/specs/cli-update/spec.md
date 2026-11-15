## ADDED Requirements

### Requirement: 官方优先与看门狗
对于有已核实接管描述、且安装布局匹配的自带更新 CLI，Host SHALL 先执行官方更新命令，同时运行看门狗。出现下列任一情况，看门狗 SHALL 判定「官方渠道不可用」：

- 非零退出且版本未前进；
- 输出出现下载中断的特征文字；
- 暂存文件连续 30 秒不增长；
- 暂存文件大小回落；
- 60 秒窗口内平均速度低于 100 KB/s；
- 按当前速度预计会撞上官方硬时限；
- 进度不可观测时超出总预算。

判定后，Host MUST 先发 TERM，等待片刻再终止整个进程树。确认进程范围已经退出后，Host 只删除本次运行产生的暂存文件，然后启动插件接管。没有接管描述的 CLI 保持原有执行方式。

#### Scenario: 官方下载断流
- **WHEN** Claude 原生更新的暂存文件停在 81 MB，30 秒没有增长
- **THEN** Host 终止官方进程树，确认进程范围退出后删除本次的 staging 目录，改由插件接管下载并显示「插件接管」进度；最终以重新探测到的版本判定成功

#### Scenario: 已是最新
- **WHEN** 官方命令以 0 退出并报告已是最新（例如 Kimi 的版本指针回退到低于已装版本）
- **THEN** Host 按「已是最新」报告；MUST NOT 判为不可用，MUST NOT 切换到接管，也 MUST NOT 降级

#### Scenario: 官方成功
- **WHEN** 官方命令成功，重新探测的版本到达或超过目标
- **THEN** 只按官方结果报告，不启动接管，并清除该 CLI 在本机的官方失败记录

### Requirement: 官方失败记忆
Host SHALL 按「CLI × 本机 × 安装布局」记录官方渠道不可用的时间，记录有效期为 7 天。有效期内更新该 CLI 时，Host SHALL 直接走插件接管，并在界面说明原因；过期后恢复官方优先。用户取消、「已是最新」、锁冲突和插件接管自身失败 MUST NOT 写入失败记录。记录文件 MUST 存放在插件私有目录，权限为 0600。

#### Scenario: 7 天内再次更新
- **WHEN** Windows 上 OMP 的官方渠道 3 天前被判为不可用，此时有新版本
- **THEN** Host 跳过官方命令直接接管，进度来源显示「插件接管」，并说明「官方渠道近期在本机失败」

#### Scenario: 记录过期
- **WHEN** 失败记录已超过 7 天
- **THEN** Host 先试官方渠道，看门狗照常运行

### Requirement: 统一下载器与工件描述
插件接管 SHALL 只通过统一下载器完成。每个 CLI 只提供一份工件描述，内容包括：

- 清单地址与取值规则；
- 文件列表：每个文件含多个源地址、长度来源、摘要、私有目录内的落点、压缩方式与解压后的校验值；
- 附加脚本或元数据；
- 放置方式与放置后动作；
- 官方进度探针。

统一下载器 SHALL 支持：

- 10 秒停滞续传与换源；
- 多源长度与 ETag 一致性检查；
- 摘要取自清单，或取自响应头的 base64 md5；
- gzip 与 zstd 解压，解压结果另做一次校验；
- 预签名地址返回 403 时重新取清单换新地址；
- 多文件聚合进度。

摘要缺失或校验不一致时，Host MUST 拒绝放置。

#### Scenario: TRAE 多文件下载
- **WHEN** TRAE CN 接管需要下载主工件、host 与 ripgrep 三个文件
- **THEN** 进度条显示三个文件的合计字节与合计续传次数，不按文件重置

#### Scenario: OMP 预签名地址过期
- **WHEN** 续传时 R2 预签名地址返回 403
- **THEN** 下载器重新取构建清单，核对版本、长度与 sha256 不变后换用新地址续传；不一致则干净重下或报错

#### Scenario: Kimi zstd 工件
- **WHEN** Kimi 描述给出 zst 压缩件与解压结果两个 sha256
- **THEN** 下载器校验压缩件，解压后再校验结果，两者都通过才交给放置；宿主运行时缺少 zstd 解码时 MUST 报告前提缺失，不放置未经校验的文件

### Requirement: 接管放置方式
接管放置 SHALL 只使用以下五类方式：

- (a) 交官方本地入口，以参数数组执行；
- (b) 在同目录写临时文件，再原地替换单个可执行文件；
- (c) 写版本文件，再原子更新链接或启动器；
- (d) 从归档只解出唯一成员，然后替换；
- (e) 不接管。

放置前 Host MUST 完成以下核对：

- 安装布局与官方默认布局一致；
- 目标版本高于已装版本；
- 链接或入口位于白名单路径内。

放置后 Host MUST 以重新探测到的版本判定结果。接管 MUST NOT 修改用户的 shell 配置或 PATH，MUST NOT 在调用官方脚本时移除宿主代理环境变量。

#### Scenario: Qoder Windows 条目选择
- **WHEN** Windows x64 build ≥ 17763，清单里 legacy 条目排在 standard 之前
- **THEN** 描述按官方规则选择非 legacy 且满足 `min_windows_build` 的条目，而不是取第一个系统与 CPU 都匹配的条目

#### Scenario: 布局不符
- **WHEN** Claude 的 Unix 启动器不是指向 `claude/versions/` 内文件的符号链接
- **THEN** 接管拒绝放置并说明原因，只保留官方渠道

### Requirement: 官方进度显示
官方渠道执行期间，Host SHALL 按 CLI 的探针显示真实进度：

- 暂存文件探针：轮询本次运行新出现、且名称符合规则的暂存文件，总量取清单或 HEAD，显示字节进度；
- 阶段探针：读取官方输出、日志或状态文件，显示阶段文字和已用时间；官方有固定阶段序列时，以「第 N/M 步」显示阶段进度条；
- 无探针：只显示阶段文字和已用时间。

Host MUST NOT 伪造百分比；暂存文件不能确定属于本次运行时 MUST NOT 显示其大小。

#### Scenario: Hermes 更新
- **WHEN** 用户更新 Hermes
- **THEN** 进度条按回执的 6 个阶段显示「第 N/6 步」，并显示日志中的真实阶段行和已用时间；fetch 阶段另显示已接收字节，不显示字节百分比。官方失败时读回执给出原因，自动重跑一次（退出码 2 除外），仍失败则提示用户

#### Scenario: Hermes 回执阶段结束后的当前步
- **WHEN** 运行中回执的最后阶段记录 outcome 为 success 或 skipped
- **THEN** Host SHALL 显示 plan、snapshot、apply、deps、build、restart 序列中的下一步，最多第 6 步；snapshot 完成后的 fetch 与 fetch 完成后的 apply 均显示第 3 步 apply。阶段为 failed/running 时保留该阶段对应步数（fetch 对应 apply）；整体 outcome=success 时固定显示第 6 步 restart。状态文件、日志及输出片段 MUST NOT 使显示步数落后于回执推算的当前步

#### Scenario: Hermes 拉取过慢由插件接管
- **WHEN** Hermes 处于 fetch 阶段，首字节宽限后 30 秒无增长或 60 秒均速低于 100 KB/s
- **THEN** 插件停止 Hermes 并确认进程树退出，用 git 按稳定标签分段预取，校验目标标签解出的提交等于计划目标 sha 后，重新执行 `hermes update --yes` 完成安装；插件 MUST NOT 写引用、改工作区或索引，MUST NOT 使用没有摘要的源码 zip；进度只显示「第 k/N 段」与已接收字节

#### Scenario: Hermes npm 依赖跟随下载源
- **WHEN** 用户的下载源设为 npmmirror、官方或自定义，并更新 Hermes
- **THEN** 插件以 `npm_config_registry=<该 registry>` 执行 `hermes update --yes`（含重跑），内容由 Hermes 按锁文件摘要校验；下载源为「跟随」时插件 MUST NOT 设置该变量

#### Scenario: Hermes 依赖下载停滞
- **WHEN** Hermes 处于工具阶段且有下载文字或本次活动分片，或 deps 阶段本次分片发生过变化且仍有 part 文件，分片、范围检查点及完成文件连续 30 秒没有活动
- **THEN** 插件确认进程退出后最多重跑官方更新 3 次，每次须有完成文件增长；无增长或耗尽后如实报告重跑次数，MUST NOT 声称即将进行没有实现的 Python/Node 接管。历史分片存在本身 MUST NOT 作为本次下载证据

#### Scenario: Hermes 安静的 Node 依赖和构建
- **WHEN** Node/pnpm、Python 依赖或 build 阶段（包括发布历史/元数据查询）没有可核实的下载证据，缓存 120 秒不变
- **THEN** Host MUST NOT 因下载停滞停止进程；输出片段、日志、状态、回执、checkout 三处 node_modules、pnpm store/npm cache 写入均续期，等待官方退出；依赖/build/apply/restart 使用 20 分钟无活动租约，plan/snapshot/未知阶段保留 5 分钟兜底

#### Scenario: Hermes 已输出完成标记但尚未退出
- **WHEN** 本次输出、日志或状态包含 Update complete! 或 Code updated!，或整体成功回执匹配目标版本/提交
- **THEN** Host SHALL 禁用下载判慢并等待退出，MUST NOT 因 30/120 秒下载规则或 5 分钟静默停止；仍保留 20 分钟无活动租约和用户取消。阶段 success 本身 MUST NOT 等同整体完成

#### Scenario: Hermes 失败后检出已经到目标
- **WHEN** 已确认官方进程范围退出，但命令非零退出、看门狗或接管/恢复路径报错
- **THEN** Host SHALL 在重跑或报告失败前只读安装记录/checkout，执行既有安装身份与 verifyUpdatedVersion 验证；版本恰为目标时发布成功并展示新版本。记录落后时仅以 HEAD 精确对应的唯一稳定标签补充版本，MUST NOT 运行 Hermes 查询版本。版本未前进、身份变化、用户取消或清理未确认 MUST NOT 被掩盖

#### Scenario: Hermes Python 镜像只在验证可复用后交付
- **WHEN** 镜像按锁哈希安装到同一 venv 后可离线 sync，但官方重跑创建新 generation，缓存与 find-links 无法让新环境离线 frozen sync
- **THEN** Host MUST NOT 启用未经该恢复流程验证的 Python takeover，MUST 保留官方依赖流程并如实记录实验失败边界

#### Scenario: Grok 接管校验
- **WHEN** Grok 官方渠道被判为不可用，且四项接管前提都满足
- **THEN** 插件按响应头 md5 与长度校验工件，冒烟 `--version` 含目标版本，平台签名有效后才放置；任一项不通过就拒绝放置

#### Scenario: Pi 环回 registry
- **WHEN** Pi 托管安装由插件接管
- **THEN** 插件逐个用 sha512 校验 122 个 tarball，只在 127.0.0.1 上临时提供这些文件，交官方 `pi update --self` 完成安装；操作结束（成功、失败或取消）后关闭服务

### Requirement: npm 平台组件与安装可运行性
Host SHALL 从有效 registry 的目标清单解析 optionalDependencies（含 npm 别名），以实际 npm Node 运行时的 platform/arch/libc 对照 os/cpu/libc 选择平台组件。主包及组件 MUST 共用统一下载、官方摘要校验和合计进度，沿用官方优先、接管、镜像、续传及 7 天失败记忆；自定义源不得自动换源。

Host SHALL 以同一 Node/npm 和缓存预置已校验平台 tgz，再以 prefer-offline/include=optional 安装主包；不得移除代理或添加 NO_PROXY，不以延长 fetch-timeout 修复。安装成功 MUST 同时满足 CLI 必需组件组的名称与版本核验、CLI 版本探针和目标版本核对。安装阶段清除字节百分比并说明其余网络活动。

#### Scenario: npm 静默跳过 Windows Codex 平台包
- **WHEN** npm exit 0 且 @openai/codex package.json 已到 0.169.0，但 alias @openai/codex-win32-x64 对应组件缺失
- **THEN** Host MUST 报告失败和具体组件名称，MUST NOT 显示已更新；即使版本字段正确也不能绕过安装树及 CLI --version 探针

#### Scenario: 已安装版本等于最新但平台组件已损坏
- **WHEN** 后台或前台检查发现本平台组件缺失，即使缓存和主包版本等于最新
- **THEN** Host SHALL 清除可用版本缓存，以既有 failed/UNKNOWN_VERSION 和 reasonDetail 标明需修复，保留 installed=true，提供已有重新安装入口，MUST NOT 归入 latest

#### Scenario: 多文件实际下载进度
- **WHEN** npm 主包 4.9 KB 下载完成而平台包尚未完成
- **THEN** 进度 SHALL 累加主包与平台包实际字节，全部长度未取得前总量为未知，MUST NOT 用主包 100% 表示整个下载或安装完成

#### Scenario: 本地平台缓存复用
- **WHEN** 已校验的普通名称或 npm alias 平台 tarball 经 cache add 预置，同一 cache 下 install 主包
- **THEN** npm SHALL 使用本地内容缓存，平台 tarball 无再次网络 GET；元数据与其他依赖的联网不得冒充受控字节下载

#### Scenario: 取消及清理未确认
- **WHEN** npm 缓存预置或安装中取消，或无法确认进程范围退出
- **THEN** Host SHALL 等待原进程退出确认，禁止报告成功；清理未确认时保留本次文件和维护锁，确认退出后清理私有下载目录

#### Scenario: 平台可选组件具有替代或回退路径
- **WHEN** OpenCode Windows x64 只有普通包或 baseline 包，或 CodeBuddy 缺少可回退 child_process 的 node-pty 包
- **THEN** Host SHALL 按必需组件组判定，OpenCode 两种二进制至少一个即可，CodeBuddy 不因 node-pty 缺失失败；Codex 对应平台 alias 与其他真正必需组件仍必须存在，且版本探针必须通过

#### Scenario: 健康安装遇到注册表离线
- **WHEN** 本地安装核验运行，其他 OS 的 optionalDependency 未安装，或已验证平台元数据不可用
- **THEN** Host MUST NOT 为判定本地缺件请求 registry；SHALL 使用本地清单、CLI 必需组及持久化已验证元数据，元数据不可用与确定缺件区分，不因远端故障将健康安装判坏

#### Scenario: Harness 与 npm 的架构不同
- **WHEN** Windows ARM64 机器运行 x64 Harness，但解析得到原生 ARM64 Node/npm
- **THEN** Host SHALL 用该 Node 的实际平台与架构选择和核验 ARM64 组件，下载与安装使用同一个 Node/npm 参数数组

#### Scenario: 官方接管和慢镜像旋转均保留断点
- **WHEN** 官方已下载部分字节后停滞、低速或预算到期，或镜像低速而官方可用
- **THEN** Host SHALL 中断当前连接并保留临时文件与偏移，验证同对象后用 Range/If-Range 从断点续传；只有无法安全追加或验证标识变化才从零重取，最终仍核对官方摘要

#### Scenario: 临时目录或失败记忆清理拒绝
- **WHEN** 安装结束后的目录删除或 ChannelMemory 写入因 ENOSPC/EACCES 等错误失败
- **THEN** Host SHALL 记录清理提示，仍完成操作、清空运行句柄、释放维护锁并继续队列；进程退出未确认的隔离策略 SHALL 保持不变

#### Scenario: 准备阶段尊重必需和替代组件
- **WHEN** OpenCode 普通平台包不可获取但 baseline 可以获取，或 CodeBuddy 可选 node-pty 预下载失败
- **THEN** Host SHALL 为替代组依次尝试至一项已校验工件成功，可选件失败仅记录且继续；真正必需组全部失败 MUST 终止，未校验文件 MUST NOT 进入 npm 缓存

#### Scenario: 所选镜像缺少精确版本清单
- **WHEN** automaticSources 已开启且主包或平台组件清单在所选源不可获取
- **THEN** Host SHALL 允许官方清单回退；custom 模式 MUST NOT 增加该回退，身份或完整性冲突 MUST NOT 作为换源理由

#### Scenario: 摘要重试期间对象长度变化
- **WHEN** 摘要失败后的干净重试探测到新的 validator 和长度
- **THEN** Host SHALL 在有效的新文件句柄上重置下载，聚合总量改用新响应长度，未知时撤销总量，MUST NOT 截断已关闭句柄或保留旧总量

#### Scenario: CLI 可运行但 npm 不在可解析路径中
- **WHEN** 已安装的 npm 来源 CLI 可通过已保存绝对路径运行，而 npm 无法解析
- **THEN** Host MUST NOT 仅因此判定安装损坏或清除健康缓存/身份；SHALL 按既有安全规则探测 CLI 或复用缓存，并继续把 npm 可用性作为更新执行前置条件

#### Scenario: npm 下载接管的进度身份
- **WHEN** npm 插件下载进入 takeover，包括文件交界与下载完成
- **THEN** 每条下载进度 SHALL 包含非空 sourceHost，客户端可据此与官方更新器接管区分；进入 npm 安装阶段 SHALL 清除下载 channel/sourceHost，MUST NOT 暗示已删除断点

### Requirement: 每次操作结束清理残留
每次更新或安装 SHALL 在成功、失败或取消后，确认全部托管进程范围退出才尽力删除本次下载、stage、私有 npm 缓存及 partial，不保留跨操作断点；下载通道记忆 SHALL 独立保留。清理失败 MUST NOT 改变操作结果；输出尾部 SHALL 追加一行中文，列明清理类别、删除项数与实际删除的逻辑字节数，无法确认退出时说明延期。

#### Scenario: 下载失败前没有返回文件路径
- **WHEN** 下载在返回路径之前失败
- **THEN** 本次已登记 partial 仍在操作收尾清理，原失败结果保持

#### Scenario: npm 私有缓存
- **WHEN** 插件 cache add 已核验 tgz 并运行 npm install
- **THEN** 两条 argv SHALL 指定同一个本次下载目录内的 --cache，代理环境保持，操作结束后删除该目录而不清理用户全局 npm 缓存

#### Scenario: npm reify 残留
- **WHEN** 操作进程已退出，且进程检查能确认没有 npm 正在操作该前缀
- **THEN** 仅回收本包 .name-八位字母数字目录及声明 bin 的 .bin[.cmd|.ps1]-八位字母数字备份；检查不确定、链接或其他包名称保持

#### Scenario: 自更新旧版本
- **WHEN** 已识别当前入口且既有版本探针确认可运行并匹配版本记录
- **THEN** 按 Grok、Qoder/Qoder CN、Claude、TRAE CN 的已知安装根与规则回收非当前版本；MUST NOT 跟随候选链接或 junction，除读取 current 指向外不解析外部目标

#### Scenario: 更新失败或当前不可核验
- **WHEN** 操作失败但旧当前版本仍可核验，或当前完全不可核验
- **THEN** 前者仅回收本次新增且未使用的副本，保留原有版本及恢复备份；后者保留所有 CLI 原生残留，仅清理确认退出的插件私有资源

#### Scenario: 清理抛错
- **WHEN** 清理遇锁定、权限或统计错误
- **THEN** 原成功或失败结果不变，尽力继续清理其他项，不把格式校验或模拟结果当实机验收

#### Scenario: Hermes 更新后原生残留
- **WHEN** Hermes 本次更新已有匹配目标的成功回执、现有安装记录或 HEAD 精确稳定标签经 verifyUpdatedVersion 确认为目标版本，且托管进程范围退出
- **THEN** Host SHALL 仅在 tools/facts.json 校验通过、每个 entry 引用均为真实存在的目录、所有更新锁和 tools/.install.lock 均可判为无活 owner 时，删除 bin/*.deleteme 普通文件及 tools 中符合 <name>-<version>-<platform>-<arch> 且未被任何 entry 引用的真实目录；MUST NOT 运行 hermes --version，不跟随链接/junction，不删除锁、facts.json 或 dot entries

#### Scenario: Hermes 清理证据不全
- **WHEN** 更新失败/取消、版本或成功回执不可核验、facts 无效/缺失/引用目录缺失，或 PID-bearing 锁存活证据为 active/unknown，或无 PID 锁的进程枚举失败/不可用/路径不完整/发现内部进程
- **THEN** Host MUST NOT 删除任何 Hermes 原生残留，SHALL 在清理汇总说明跳过原因；PID-bearing 锁保持原三态判定

#### Scenario: 无 PID 锁与安装路径进程
- **WHEN** 成功更新的托管范围已退出，零字节或未知格式的无 PID 普通锁仍在，但完整进程枚举没有可执行路径位于本次 Hermes home 或 checkout 内的进程（只有安装根外的同名 hermes 进程也属无匹配）
- **THEN** Host SHALL 仅对本次清理判锁 stale，并继续已获授权的残留清理；MUST NOT 以锁年龄或进程名字代替路径证据，不终止被枚举进程、不运行 Hermes 命令、不修改锁文件；Windows 路径大小写与分隔符 SHALL 归一化，home 名称前缀相似的外部目录不算内部

### Requirement: OMP 成功更新后的原生备份回收
Host SHALL 仅在托管范围退出、OMP 更新成功且新鲜版本探针严格等于目标版本后，回收已知 Windows OMP 安装目录或 macOS `<home>/.local/bin/omp` 同目录内匹配 `<入口 basename>.<数字>.<数字>.<数字>.bak` 的普通单链接文件。身份 MUST 为 `self-update`，realpath 匹配已知入口；入口 MUST 为普通单链接非符号链接文件，入口父链与候选 MUST 通过既有路径安全检查。Windows 匹配 SHALL 忽略大小写，macOS SHALL 大小写敏感；MUST 保留当前入口、`omp.lock`、链接/junction、硬链接、匹配名称的目录和其他名称，不扩展无证据的 Linux 规则。

#### Scenario: 已核验成功与精确备份
- **WHEN** 当前 OMP 入口已识别且更新后探针版本等于目标
- **THEN** 删除同目录精确匹配的备份，保留当前入口并计入既有中文清理摘要

#### Scenario: 失败或版本未核验
- **WHEN** 更新失败、退出未确认、当前入口未知或版本不等于目标
- **THEN** 保留全部 OMP 原生备份，不改变原操作结果

#### Scenario: macOS 已知官方布局与备份
- **WHEN** macOS 官方入口 `<home>/.local/bin/omp` 满足身份、文件和路径安全检查，更新已成功且新鲜探针等于目标
- **THEN** Host SHALL 回收同目录 `omp.1794698897770.88878.0.bak` 等精确匹配文件，保留 `omp.lock`、`omp.1.2.bak`、`other.1.2.3.bak`、大小写不符名称、目录和链接

#### Scenario: Linux 无命名证据
- **WHEN** Linux 使用同样的入口路径和备份名称，即使更新成功且版本匹配
- **THEN** Host MUST 保留全部 OMP 原生备份，不启用 macOS 清理规则
