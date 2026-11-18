# cli-update Specification

## Purpose
规定 CLI Worker 设置中「更新 CLI」页的检查、更新、安装、下载通道（官方优先、插件接管兜底与统一下载器）以及更新后清理的行为，确保只在用户可见的操作下改动 CLI 安装，并如实报告结果。

## Requirements

### Requirement: 官方优先与看门狗
对于有已核实接管描述、且安装布局匹配的自带更新 CLI，Host SHALL 先执行官方更新命令，同时运行看门狗。出现下列任一情况，看门狗 SHALL 判定「官方渠道不可用」：

- 非零退出且版本未前进；
- 输出出现下载中断的特征文字；
- 下载阶段连续 10 秒没有进展：能读到字节的看暂存文件增长；普通阶段探针看更新器输出的下载状态文字有没有变化；Grok 的 activityOnly 文件探针按下述分阶段规则处理；
- 非 activityOnly 探针的暂存文件大小回落；
- 60 秒窗口内平均速度低于 100 KB/s；
- 按当前速度预计会撞上官方硬时限；
- 进度不可观测时超出总预算。

判定后，Host MUST 先发 TERM，等待片刻再终止整个进程树。确认进程范围已经退出后，Host 只删除本次运行产生的暂存文件，然后启动插件接管。没有接管描述的 CLI 保持原有执行方式。

#### Scenario: 下载阶段启停停滞计时
- **WHEN** 更新器输出表明已进入下载、已下载完成或已进入解压、安装、签名校验、杀毒扫描
- **THEN** Host SHALL 仅在明确进入下载时启动 10 秒计时，在下载完成或进入后续阶段时停止计时；后续阶段 MUST NOT 因 10 秒规则被终止，从未明确进入下载阶段时只适用总预算

#### Scenario: 官方下载断流
- **WHEN** Claude 原生更新的暂存文件停在 81 MB，10 秒没有增长
- **THEN** Host 终止官方进程树，确认进程范围退出后删除本次的 staging 目录，改由插件接管下载并显示「插件接管」进度；最终以重新探测到的版本判定成功

#### Scenario: 已是最新
- **WHEN** 官方命令以 0 退出并报告已是最新（例如 Kimi 的版本指针回退到低于已装版本）
- **THEN** Host 按「已是最新」报告；MUST NOT 判为不可用，MUST NOT 切换到接管，也 MUST NOT 降级

#### Scenario: 官方成功
- **WHEN** 官方命令成功，重新探测的版本到达或超过目标
- **THEN** 只按官方结果报告，不启动接管，并清除该 CLI 在本机的官方失败记录

Grok 的官方探针 SHALL 只观察 `~/.grok/downloads` 中目标版本与平台键匹配的 `grok-<version>-<platform>*.tmp*` 新文件，以相对名称、size、mtimeMs、ino 指纹变化（出现、增长、修改、消失）作为活动；MUST NOT 将文件大小当成已下载字节或展示百分比。大小缩小、inode 改变和重试换名 MUST NOT 触发 OFFICIAL_RESTARTED。目标版本未知时 SHALL 回退阶段探针，MUST NOT 扩大文件匹配范围；清单失败但版本已知时 SHALL 保留同一文件探针。原有 officialBudgetMs 总预算 SHALL 保持不变。

#### Scenario: Grok 管道输出只有 Downloading
- **WHEN** Grok 输出 Downloading 后尚无任何本次文件活动
- **THEN** Host SHALL 容忍 60 秒盲窗；59 秒不得接管，60 秒 SHALL 以 OFFICIAL_SLOW 触发接管

#### Scenario: Grok 可观察文件仍在变化或已经停滞
- **WHEN** 已观察到本次匹配文件活动
- **THEN** 每次指纹变化 SHALL 刷新活动时间，连续 10 秒无变化 SHALL 以 OFFICIAL_STALLED 接管；持续变化 30 秒 MUST NOT 因无输出而接管，且 MUST NOT 显示下载字节

#### Scenario: Grok 主程序写入完成后的静默收尾
- **WHEN** 匹配临时文件的大小等于 HEAD 取得的原始主程序长度，且指纹连续 3 次轮询不变
- **THEN** Host SHALL 调用 phase(false) 停止 10 秒时钟，改用 120 秒无活动时限；静默 100 秒不得接管，120 秒 SHALL 以 OFFICIAL_STALLED 接管；后续文件变化 SHALL 刷新无活动时间，不得把 grove 下载或签名检查当成主程序下载停滞

#### Scenario: Grok 接管清理与成功移走暂存
- **WHEN** 官方进程树已确认退出，需要清理本次 Grok 暂存
- **THEN** Host SHALL 只删除不在启动基线、mtime 不早于启动时间、ino/dev 与观察身份一致、nlink 为 1 的普通匹配文件；MUST 保留基线文件、符号链接、硬链接及 Unix 最终版本文件；成功时临时文件已移走 SHALL 无错误地跳过，保留目标文件
- **AND** 页面没有实际删除证据时 MUST NOT 声称已删除半成品，OFFICIAL_SLOW 和收尾超时 MUST NOT 显示「10 秒没有新数据」

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

- 5 秒停滞续传与换源；
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
- **WHEN** Hermes 处于 fetch 阶段，等待首字节 10 秒仍无进展、收到字节后连续 10 秒无增长，或 60 秒均速低于 100 KB/s
- **THEN** 插件停止 Hermes 并确认进程树退出，用 git 按稳定标签分段预取，校验目标标签解出的提交等于计划目标 sha 后，重新执行 `hermes update --yes` 完成安装；插件 MUST NOT 写引用、改工作区或索引，MUST NOT 使用没有摘要的源码 zip；进度只显示「第 k/N 段」与已接收字节

#### Scenario: Hermes npm 依赖跟随下载源
- **WHEN** 用户的下载源设为 npmmirror、官方或自定义，并更新 Hermes
- **THEN** 插件以 `npm_config_registry=<该 registry>` 执行 `hermes update --yes`（含重跑），内容由 Hermes 按锁文件摘要校验；下载源为「跟随」时插件 MUST NOT 设置该变量

#### Scenario: Hermes 依赖下载停滞
- **WHEN** Hermes 处于工具阶段且有下载文字或本次活动分片，或 deps 阶段本次分片发生过变化且仍有 part 文件，分片、范围检查点及完成文件连续 10 秒没有活动
- **THEN** 插件确认进程退出后最多重跑官方更新 3 次，每次须有完成文件增长；无增长或耗尽后如实报告重跑次数，MUST NOT 声称即将进行没有实现的 Python/Node 接管。历史分片存在本身 MUST NOT 作为本次下载证据

#### Scenario: Hermes 安静的 Node 依赖和构建
- **WHEN** Node/pnpm、Python 依赖或 build 阶段（包括发布历史/元数据查询）没有可核实的下载证据，缓存 120 秒不变
- **THEN** Host MUST NOT 因下载停滞停止进程；输出片段、日志、状态、回执、checkout 三处 node_modules、pnpm store/npm cache 写入均续期，等待官方退出；依赖/build/apply/restart 使用 20 分钟无活动租约，plan/snapshot/未知阶段保留 5 分钟兜底

#### Scenario: Hermes 已输出完成标记但尚未退出
- **WHEN** 本次输出、日志或状态包含 Update complete! 或 Code updated!，或整体成功回执匹配目标版本/提交
- **THEN** Host SHALL 禁用下载判慢并等待退出，MUST NOT 因下载停滞规则或 5 分钟静默停止；仍保留 20 分钟无活动租约和用户取消。阶段 success 本身 MUST NOT 等同整体完成

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

### Requirement: macOS 系统代理注入
Host SHALL 在 macOS 用参数数组运行 `/usr/sbin/scutil --proxy`，复用 Windows 的 5 秒超时、64 KiB 输出上限、15 秒按需缓存、并发合并及进程清理。读取失败或关闭代理后 SHALL 清除旧代理。Host SHALL 优先使用有效且启用的 HTTPS 代理，其次 HTTP，只接受单个主机名、IPv4 或带括号 IPv6 与 1–65535 端口，统一作为 HTTP 代理。已有代理环境变量或显式删除 SHALL 优先，不得覆盖。账号终端、Worker、更新/安装命令和探测 SHALL 通过同一进程后端获得代理；Host 的 HTTPS 请求与 Pi/OMP 子进程 SHALL 按相同来源与例外规则查找代理，保留代理请求的 User-Agent。Linux MUST NOT 新增系统代理注入。

#### Scenario: macOS 图形启动未继承环境变量
- **WHEN** Host 没有代理环境变量，而系统启用了有效的显式 HTTP(S) 代理
- **THEN** 新启动的 CLI SHALL 获得 HTTP_PROXY、HTTPS_PROXY 与 NO_PROXY；NO_PROXY SHALL 合并既有值、localhost、127.0.0.1、::1 以及 ExceptionsList 中可表达的主机、域名后缀与精确 IP
- **AND** `*.example.com` 和 `*.local` SHALL 转为 `.example.com` 和 `.local`；CIDR、短网段、任意位置通配、主机端口等非通用形式 SHALL 丢弃

#### Scenario: 只有 PAC 或 SOCKS
- **WHEN** 没有有效显式 HTTP(S) 代理，而 PAC、自动发现或 SOCKS 已启用
- **THEN** Host MUST NOT 执行 PAC、推测代理或注入 SOCKS 变量，来源生命周期内 SHALL 仅记录一次不含原始输出的诊断

#### Scenario: 继承变量或显式删除决定代理
- **WHEN** Host 环境或进程 spec 中任意大小写的 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY 已有非空值，或 spec 明确设为 undefined
- **THEN** 系统代理 MUST NOT 覆盖该进程的环境

#### Scenario: 系统变更或插件停用
- **WHEN** 系统代理关闭、读取失败或插件停用
- **THEN** 关闭/失败 SHALL 在下次过期刷新后不再保留旧值，停用 SHALL 中止读取、等待进程范围退出并撤销 Host 代理查找；同步 spawn 不等待刷新，账号终端与 Host 查询等待 fresh

### Requirement: 全部 CLI 的官方自动更新范围
Host SHALL 为已识别的官方安装开放 PRD 5.3.1 的自带命令、官方安装器或桌面替换流程；npm/Homebrew 归属 SHALL 优先使用原包管理器。Codex 独立版 SHALL 下载内置官方脚本，以 `CODEX_NON_INTERACTIVE=1` 和 `--release <目标>` 执行。Hermes SHALL 在执行前提供迁移配置、更新依赖、可能重启服务及保留原通道的说明；所有更新 MUST 由前台用户发起。

#### Scenario: Codex 独立安装更新
- **WHEN** 已识别的 Codex standalone 安装有新版本
- **THEN** Host 先下载官方脚本到私有目录，再以文件参数执行锁定版本；MUST NOT 使用未经核实的 codex update 参数

#### Scenario: Hermes canary 安装
- **WHEN** install-stamp 的 baseVersion 小于官方 stable 版本且安装通道未知或 canary
- **THEN** Host 显示通道说明，前台使用原入口 update --yes，不暗中切换通道，并以装后重新探测结果判定

### Requirement: 官方发布源与后台只读查询
Host SHALL 按来源使用 sources 内置地址的匿名 GET：Antigravity 平台 manifest、Codex rust-v tag、Kimi native latest、MiMo FDS 文本、Grok stable 文本、OMP npm、Pi managed API、Hermes stable release、Qoder 两版 channels manifest、TRAE public stable，以及桌面专用发布读取器。字段格式、平台工件和清单摘要 SHALL 校验；普通请求统一受 8 秒、512 KiB、3 并发约束。后台发布查询 MUST NOT 启动任何 CLI check/update 子命令或 npm config 命令。

#### Scenario: Grok 后台查新
- **WHEN** 后台需要刷新 Grok 最新版本
- **THEN** 只 GET 官方 stable 文本，不执行会写文件的 grok update --check

#### Scenario: Codex tag 不是 rust-v
- **WHEN** OpenAI latest 返回其他 tag 前缀或非法版本
- **THEN** Host 报发布查询失败，不猜测目标

### Requirement: 无法锁版方法的实际版本核对
不能锁定目标的方法 SHALL 在身份核对后接受实际版本大于更新前版本且仍兼容的结果，即使不等于检查时目标；版本不变 MUST 返回 VERSION_UNCHANGED，降低、未知或越过 OpenCode V1 MUST 返回 VERSION_MISMATCH。成功后 SHALL 以实际版本重算分区并持久化。

#### Scenario: 检查后官方又发布新版
- **WHEN** Qoder 检查目标为 1.2.3，更新前为 1.0.0，实际更新为 1.2.4
- **THEN** 操作成功并显示 1.2.4，不因不等于旧目标失败

### Requirement: Pi 更新与 Worker 适配分离
Pi 更新 SHALL 取官方 latest，MUST NOT 用适配集合限制目标；适配判断 SHALL 共用 pi-installation 的 PI_SUPPORTED_VERSIONS/isSupportedPiVersion。未适配目标 SHALL 带可选 notice「插件尚未适配 Pi X，更新后 Pi Worker 要等插件适配后才能使用」，Worker 身份和协议核对 MUST 保持严格。

#### Scenario: 管理页读取未适配 Pi
- **WHEN** Pi 已安装有效新版本且官方包身份、入口正确，但 Worker 尚未适配
- **THEN** 管理页可读取版本和更新，Worker 仍拒绝不支持的协议

### Requirement: 手动更新原因与桌面应用版本
「需要手动更新」SHALL 仅保留外部管理器、未识别归属、不支持平台或确实没有可用官方源的情况，每条 SHALL 说明原因。ZCode/WorkBuddy 两版 SHALL 调用桌面更新器，下载回调仅返回已完整校验的文件。WorkBuddy 的官方 204 无更新响应 SHALL 映射为 latest，latestVersion 为当前应用版本且无更新计划，不得归检查失败。共享协议 appVersion、notice、channel SHALL 为可选字段。

#### Scenario: WorkBuddy 返回无更新
- **WHEN** 已核实应用版本的 WorkBuddy feed 返回 204
- **THEN** 显示已是最新，不启动安装，也不生成更新 token

#### Scenario: 官方 Windows 工件缺摘要
- **WHEN** 桌面发布读取器确认此平台的官方工件没有摘要
- **THEN** 显示具体手动原因，MUST NOT 下载执行未校验安装程序

#### Scenario: Windows WorkBuddy 应用包封装于 ASAR
- **WHEN** WorkBuddy 已通过安装根、内置 CLI 包和站点核对，且 resources/app/package.json 没有有效应用版本
- **THEN** Host SHALL 只读使用同安装的内置 CLI product.json 中通过应用版本格式校验的 genieVersion；MUST NOT 将 agent-cli 的 package.version 作为应用版本，MUST NOT 启动桌面应用
- **AND** genieVersion 无效或缺失时 SHALL 继续标记应用版本不可核实；版本变化 SHALL 进入现有安装指纹，另一站点的元数据 MUST NOT 被接受

### Requirement: 「更新 CLI」设置页入口与分区
设置窗口 SHALL 在左侧导航「智能体设置」之后、「CLI 连接」之前提供「更新 CLI」入口，图标为原生 `IconDownloadOutlineRegular`。有可更新的 CLI 时，入口右侧 SHALL 显示数量徽标，数量来自缓存，不必先进入该页；有更新或安装进行中时，徽标 SHALL 换成转圈；数量为 0 时 MUST NOT 显示徽标。页面 SHALL 依次显示「检查中」「检查失败」「可更新」「需要手动更新」「已是最新」「未安装」「下载设置」分区，没有内容的分区 MUST NOT 显示。每个分区标题行最右侧 SHALL 有同一个折叠按钮，「未安装」默认收起，其余默认展开，收起状态按分区记在本机。页头 SHALL 只有标题、副标题、「检查更新」和页内唯一的 primary 按钮「全部更新」，MUST NOT 显示状态行。

#### Scenario: 导航徽标来自缓存
- **WHEN** DSH 启动后预加载已得出 3 个可更新的 CLI，用户打开设置窗口但停留在通用页
- **THEN** 「更新 CLI」导航项显示徽标 3

#### Scenario: 没有可更新的 CLI
- **WHEN** 检查完成，所有已安装的 CLI 都是最新或只能手动更新
- **THEN** 导航不显示徽标，页头不显示「全部更新」，「可更新」分区不出现

#### Scenario: 收起状态保留
- **WHEN** 用户收起「已是最新」后关闭设置窗口再打开
- **THEN** 「已是最新」仍为收起，标题里的数量随检查结果更新

### Requirement: 加载与重排
页面 SHALL 先显示可用内容，再原地更新结果，分区归类集中重排。没有任何缓存时，17 个 CLI SHALL 立即列在「检查中」分区：读完本地版本后重排一次，查完最新版本后再重排一次，整个过程 MUST NOT 超过两次重排。有缓存时 SHALL 直接按缓存分区显示，只把缺缓存的 CLI 放进「检查中」，读完后与其他行一起只重排一次，已有结果的行 MUST NOT 重读。重排时，用户展开着的行和正在更新或安装的行 SHALL 原地不动，视口内第一行 SHALL 保持位置。最新版本查询的总等待上限为 30 秒，超时的行归入「检查失败」并写「查询超时」。Host 整体读不到状态时，页面 SHALL 只显示一行原因和「重试」，MUST NOT 显示空分区。

#### Scenario: 全部有缓存
- **WHEN** 17 个 CLI 都有未过期的缓存，用户打开「更新 CLI」页
- **THEN** 页面直接按缓存分区显示，不出现「检查中」分区，也不启动任何探测

#### Scenario: 部分缺缓存
- **WHEN** Kimi 的可执行文件指纹变了，其余 CLI 都有缓存
- **THEN** 只有 Kimi 出现在「检查中」分区，读完后与其他行一起重排一次

#### Scenario: 展开的行不移动
- **WHEN** 用户展开 ZCode 的「查看方法」时，检查结果要求 ZCode 改到别的分区
- **THEN** ZCode 留在原位，等用户收起后的下一次重排再归类

#### Scenario: 单个 CLI 查询超时
- **WHEN** OpenCode 的发布源 30 秒内没有返回
- **THEN** 其他行照常完成；OpenCode 写「查询超时」，随重排进入「检查失败」

### Requirement: 版本检查与兼容范围
Host SHALL 优先读清单；前台清单缺版本时，用实际调用的入口执行已核实的 `--version`：参数数组、stdin ignore、5 秒超时、确认进程范围退出、去 ANSI 后取首个完整合法 SemVer。Kimi MUST 带 `KIMI_CODE_NO_AUTO_UPDATE=1`。后台仅对 sources 标为无文件改动的 CLI 开放，按指纹复用结果；Codex、Qoder/CN 仅前台。Hermes 前后台均不执行版本命令，改读 install-stamp.json 的 baseVersion；缺少可信记录时显示版本未知。ZCode SHALL 读取已核实的桌面应用版本，WorkBuddy SHALL 保留 CLI 版本并另读应用版本用于更新比较。普通 CLI 版本 SHALL 按 SemVer 比较；正式版不提示升级到预发布版。OpenCode V1 之外的版本 SHALL 显示「有新版本 X，插件尚未适配」，MUST NOT 提供更新按钮；Pi 更新不受 Worker 适配集合限制。

#### Scenario: 前后台版本命令权限不同
- **WHEN** 前台或后台检查缺少清单版本的 Codex、Qoder/CN 或 Hermes
- **THEN** 仅前台允许 Codex、Qoder/CN 版本命令，Hermes 两者均跳过；指纹不变的结果不重复执行

#### Scenario: Claude cask 无清单版本
- **WHEN** 前台识别出 Claude 的 Homebrew cask 归属且清单没有版本
- **THEN** Host 从实际入口读取版本，存在兼容更新时生成 `brew upgrade --cask claude-code` 参数数组

### Requirement: 发布元数据查询边界
最新版本 SHALL 从官方发布源读取（npm registry、Homebrew API、官方清单），每请求 8 秒超时、最多 3 并发、普通响应体限 512 KiB，MUST NOT 携带凭据。npm SHALL 先读 dist-tags；仅 compatibility 非 any 且 latest 不兼容时才读取版本列表，流式累计并限 32 MiB。镜像核对/回退顺序及精确版本 integrity/artifact 的 512 KiB 限制 SHALL 保持不变。

#### Scenario: 大包的 latest 已兼容
- **WHEN** dist-tags 返回的 latest 是插件已兼容的版本
- **THEN** Host 只读不超过 512 KiB 的 dist-tags，不读取整份 packument

#### Scenario: 兼容回退的版本列表超限
- **WHEN** latest 不兼容且版本列表实际流式字节数超过 32 MiB
- **THEN** Host 中止响应并报告发布查询失败，不放大其他请求上限

#### Scenario: Pi 出现未适配版本
- **WHEN** Pi 的最新版本不在插件适配集合内
- **THEN** 仍允许更新，行内 notice 显示「插件尚未适配 Pi X，更新后 Pi Worker 要等插件适配后才能使用」

#### Scenario: 探测 Kimi 不触发自动升级
- **WHEN** Host 读取 Kimi 当前版本
- **THEN** 子进程环境含 `KIMI_CODE_NO_AUTO_UPDATE=1`，Kimi 安装目录在探测前后没有变化

#### Scenario: 预发布版本
- **WHEN** 当前为 2.1.40，发布源的 latest 指向 2.2.0-beta.1
- **THEN** 不提示更新

### Requirement: 安装来源识别与更新计划
Host SHALL 解析可执行文件的符号链接，按真实路径识别安装来源：Homebrew（路径属于 Cellar 或 Caskroom，且 brew 元数据对应该 CLI 的包）、npm 全局包（路径含 `node_modules/<包名>/`，包名在该 CLI 的白名单内）、CLI 自带更新命令、官方独立安装器与桌面应用。WinGet、Scoop、Nix、Bun、pnpm 全局 SHALL 归入「需要手动更新」，只给原管理器说明；识别不出时 SHALL 写「没有识别出安装方式」。npm 更新 MUST 在原前缀下进行，MUST NOT 换包管理器。计划 SHALL 记录指纹（CLI、动作、平台、当前版本、可执行文件路径与文件状态、方法、目标版本及锁版能力）；开始执行前 Host SHALL 重新生成计划，指纹不一致时 MUST 拒绝，并提示「CLI 或安装方式已变化，请重新检查」。

#### Scenario: npm 全局安装
- **WHEN** Codex 的真实路径为 `<前缀>/lib/node_modules/@openai/codex/bin/codex.js`
- **THEN** Host 下载 `@openai/codex@<目标版本>` 主包并按官方 sha512 校验，在同一 `--prefix` 下安装已校验的本地 tgz；Node/npm 安装独立于包前缀解析，命令以参数数组执行

#### Scenario: WinGet 安装
- **WHEN** Grok Build 由 WinGet 安装
- **THEN** 归入「需要手动更新」，展开后显示 `winget upgrade` 命令与官方说明，没有「更新」按钮

#### Scenario: Qoder 官方分发入口
- **WHEN** Qoder/CN 真实路径分别为 `<home>/.qoder/entry/qoder` 或 `<home>/.qoder-cn/entry/qodercn`，且发布源存在兼容更新
- **THEN** Host 识别为 self-update、进入可更新，计划为 `[记录入口, 'update']`；entry 下其他名字不据此识别

#### Scenario: Qoder 分发路由冲突
- **WHEN** 即将执行官方分发入口（或其符号链接）的 update，而 homedir 下存在同名路径或无法检查
- **THEN** Host 在启动进程前拒绝并说明冲突，不转入 IDE，不删除用户路径

#### Scenario: Grok 官方下载实体
- **WHEN** Grok 记录入口为 `<home>/.grok/bin/grok`，真实路径位于 `<home>/.grok/downloads/`，官方 stable 文本有新版本
- **THEN** Host 识别为 self-update，生成 `[记录入口, 'update', '--version', 目标版本]`

#### Scenario: 计划过期
- **WHEN** 用户检查后在终端里重装了 Codex，回到页面点「更新」
- **THEN** Host 拒绝执行，提示 CLI 或安装方式已变化，并把该行重新检查

### Requirement: 执行更新与结果核对
更新和安装 SHALL 只能由设置页发起，MUST NOT 注册为主 Agent 或 Worker 的工具。Host 全局同一时间 SHALL 只执行一个更新或安装操作；「全部更新」SHALL 按顺序逐个执行。用户点「更新」后 SHALL 直接开始，行下展开下载进度、实际执行的命令和输出；输出 SHALL 去除 ANSI 控制序列、脱敏，只保留最后 32 KiB，按纯文本显示。命令 MUST 以参数数组执行，MUST NOT 拼接 shell。完成后 Host SHALL 确认进程范围已退出，再重新解析路径并读取版本：能锁版的方法 SHALL 核对目标版本，不能锁版的方法 SHALL 核对版本前进且仍兼容，并显示实际版本；版本没有变化 SHALL 显示「版本没有变化」；退出码为 0 MUST NOT 单独作为成功依据。关闭设置窗口 MUST NOT 取消操作；用户取消时，SHALL 在进程范围确认退出后才显示「已取消」。

#### Scenario: 更新成功
- **WHEN** Codex 从 0.129.0 更新，执行后重新探测得到 0.130.0
- **THEN** 行内显示「已更新到 0.130.0」，该行在下一次重排时进入「已是最新」

#### Scenario: 命令成功但版本未变
- **WHEN** 更新命令退出码为 0，重新探测仍为原版本
- **THEN** 显示「版本没有变化」，不算成功

#### Scenario: 关闭设置窗口
- **WHEN** 更新进行中用户关闭设置窗口
- **THEN** Host 继续更新；重新打开后显示当前阶段与已有输出

#### Scenario: 取消更新
- **WHEN** 用户点「取消更新」
- **THEN** 进程树确认退出后才显示「已取消」；清理无法确认时显示原因并保持该 CLI 的维护锁

### Requirement: 维护锁
目标 CLI 在更新或安装期间，Host SHALL 拒绝该 CLI 的新派遣、续聊执行、账号窗口、模型查询和路径修改，并给出具体原因；其他 CLI 不受影响。该 CLI 有任务在运行、准备、停止中、排队或有未暂停的续聊时，「更新」SHALL 不可用并悬停说明「这些任务结束或停止后才能更新」。准入检查与加锁 MUST 是同一个同步步骤，MUST NOT 先异步判断空闲再加锁。维护状态 MUST NOT 写入用户的启用设置。

#### Scenario: 更新期间派遣
- **WHEN** Codex 正在更新，主 Agent 派遣 Codex Worker
- **THEN** 派遣被拒绝，原因写明 Codex 正在更新；派遣 Kimi 不受影响

#### Scenario: 有任务在用
- **WHEN** Claude Code 有 2 个 Worker 正在运行
- **THEN** Claude Code 行的「更新」置灰，悬停说明需等任务结束或停止

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

### Requirement: 首次安装
「未安装」分区的 CLI SHALL 可以在本页安装。纯 CLI SHALL 装到官方默认位置，MUST NOT 让用户选择位置；同时有 npm 包和官方脚本时，SHALL 用官方推荐的方式，同为推荐时用 npm 包。官方安装脚本 SHALL 只使用 Host 内置的官方地址，先下载到插件私有缓存，再以文件方式交给明确的解释器执行，行内显示脚本地址。ZCode、WorkBuddy CN、WorkBuddy SHALL 可以在行内选择安装位置（只有图标的文件夹按钮，直接打开系统目录选择）；能静默安装的由插件安装到所选位置，不能的打开官方安装程序。位置需要管理员权限、空间不足或目录非空时 SHALL 用错误色提示并禁用「开始安装」。安装前 SHALL 检查前置条件（Node.js、Bun 版本等），不满足时 MUST NOT 安装，只说明所需版本并给出官方说明，MUST NOT 代装运行时。安装后读得出版本才算成功，桌面应用的所选路径 SHALL 写入机器级路径记录，下一步提示登录。

#### Scenario: 安装纯 CLI
- **WHEN** 用户在「未安装」里对 CodeBuddy Code 点「安装」
- **THEN** 插件用 npm 装到全局目录，装完读得出版本，行内提示去登录

#### Scenario: 缺少 Node.js
- **WHEN** 安装需要 Node.js 18.20 以上，本机没有 Node.js
- **THEN** 「安装」不可用，行内写明所需版本并给出官方说明

#### Scenario: 桌面应用选位置
- **WHEN** 用户把 WorkBuddy CN 的安装位置选为 `E:\WorkBuddy CN` 并安装成功
- **THEN** 插件把该位置的入口写入路径记录，「CLI 连接」页直接使用这个路径

#### Scenario: 安装脚本地址
- **WHEN** 安装 Grok Build
- **THEN** 插件只从内置的官方地址下载脚本，以文件方式执行，不经 `curl | bash`

### Requirement: 下载源设置
「下载设置」分区 SHALL 提供「下载源」下拉：跟随 npm 设置（默认）、npm 官方源、国内镜像 npmmirror、自定义地址。自定义地址 MUST 为 https，MUST NOT 含用户名或密码，并可「检查连接」。Host SHALL 在自动模式按所选 registry 标准包路径生成主包 tarball 地址（custom 模式仅用该源元数据的主地址），按 npm 官方源同版本 sha512 验证实际文件，再交给 npm 安装本地 tgz；官方源也 SHALL 使用同一路径。安装 SHALL 传入 `--registry <地址>` 供 npm 正常解析依赖，MUST NOT 修改用户的 `.npmrc` 或全局 npm 配置；官方安装脚本、CLI 自带更新命令、Homebrew 和桌面安装包始终从官方下载。npm 主包的官方 sha512 不可得或实际文件校验失败时 MUST NOT 安装，MUST NOT 降级为信任镜像摘要；`integritySource` SHALL 标明官方源。设置按本机保存，从下一次操作开始生效。

#### Scenario: 选择国内镜像
- **WHEN** 下载源为 npmmirror，用户更新 Codex
- **THEN** 命令含 `--registry https://registry.npmmirror.com`，用户的 npm 配置没有变化

#### Scenario: 自定义地址含密码
- **WHEN** 用户输入 `https://user:pass@npm.example.com`
- **THEN** 地址被拒绝并说明不能包含用户名或密码

### Requirement: 后台预加载的时机与负载
DSH 启动后，插件 Host SHALL 等待 60 秒，再在系统空闲时在后台读取 CLI 状态。空闲指没有 Worker 任务在运行或启动、没有打开的登录窗口、没有更新或安装进行中，且系统 CPU 忙碌低于 50%（用 `os.cpus()` 前后两次采样 2 秒计算）；不空闲时每 30 秒再看一次。预加载 SHALL 一次只跑一个探测，每项至少间隔 2 秒，版本探测沿用低优先级启动，连接查询共用前台原生启动与清理；按 CLI 路径（只核对文件状态）、当前版本（只在指纹变化或没有记录时读取）、账号登录状态（按连接预加载范围）、最新版本（超过 6 小时才查）、缺失的模型目录的顺序进行。每次 DSH 启动只完整执行一遍。预加载 MUST NOT 打开窗口或自动升级 CLI；账号与目录的初始化、原生续期及私有配置写入 SHALL 按「项目连接状态静默预加载与缓存消费」执行，未验证无副作用的版本读取 MUST NOT 在后台运行。

#### Scenario: 系统空闲时开始
- **WHEN** DSH 启动满 60 秒，没有任务，系统 CPU 忙碌 20%
- **THEN** 预加载开始，同一时间最多一个探测子进程

#### Scenario: 文件没变不启动进程
- **WHEN** Codex 可执行文件的真实路径、大小和修改时间与缓存一致
- **THEN** 预加载不运行 `codex --version`，沿用缓存的版本与安装来源

### Requirement: 后台预加载的让路、开关与清理
用户派遣任务、打开登录窗口或开始更新或安装时，预加载 SHALL 立即暂停，正在运行的探测 SHALL 取消并确认进程退出，系统再空闲 30 秒后从没做完的一项继续。预加载 MUST NOT 占用更新锁，MUST NOT 阻止派遣。打开页面时预加载正在进行，页面 SHALL 接上同一个任务，剩余 CLI 改为前台速度，MUST NOT 重复启动探测。「CLI Worker 设置」通用页 SHALL 提供开关「启动后在后台检查 CLI」，默认开；关闭后不做预加载。插件停用或 DSH 退出时，定时器、采样器和子进程 SHALL 全部取消，子进程确认退出后才算清理完成。

#### Scenario: 派遣时让路
- **WHEN** 预加载正在读取 Qoder 账号状态，用户派遣 Codex Worker
- **THEN** 预加载取消该读取并确认子进程退出，派遣正常进行；30 秒空闲后从 Qoder 账号状态继续

#### Scenario: 关闭开关
- **WHEN** 用户关闭「启动后在后台检查 CLI」并重启 DSH
- **THEN** 不做预加载；打开「更新 CLI」页时按加载与重排规则读取

#### Scenario: 插件停用
- **WHEN** 预加载进行中用户停用插件
- **THEN** 正在运行的探测被取消，子进程确认退出后停用才完成

### Requirement: 分层缓存
CLI 状态缓存 SHALL 保存在插件私有目录，按本机保存，目录 0700、文件 0600，MUST NOT 进入 Git。CLI 路径与安装来源 SHALL 长期保存，在文件不存在或不可执行、真实路径变化、用户改了手动路径、本页刚装完或更新完时重读。当前版本 SHALL 长期保存，以真实路径、文件大小、修改时间（桌面应用再加应用包版本号）为指纹，指纹变化时重读。最新版本 SHALL 保存 6 小时，在超时、用户点「检查更新」、换了下载源时重查。账号登录状态 SHALL 保留上次结果用于显示，超过 10 分钟的在打开设置时原地静默重读，登录、退出、切换账号后立即重读；账号状态 SHALL 按 CLI 保存一份，MUST NOT 按项目或会话目录区分，换项目或会话没有目录不视为过期，也不重新探测；项目里的 CLI 配置只在派遣任务和为该项目选择模型时生效。缓存 SHALL 只保存显示需要的内容（版本号、来源、分区、检查时间、登录状态、界面上本来就显示的账号名），MUST NOT 保存令牌、Cookie、API Key 或命令输出。

#### Scenario: 账号状态过期
- **WHEN** 打开设置时某个 CLI 的账号状态缓存已有 15 分钟
- **THEN** 先显示上次的状态，同时原地重读，读完后替换

#### Scenario: 缓存损坏
- **WHEN** 缓存文件无法读取或格式不符，包括内容不是合法 JSON
- **THEN** Host SHALL 整份丢弃，页面按没有缓存加载，不弹错误

#### Scenario: 缓存不含凭据
- **WHEN** 检查缓存文件内容
- **THEN** 只有版本、来源、分区、时间、登录状态与显示用账号名，没有令牌或 Cookie

#### Scenario: 换项目不重读账号状态
- **WHEN** 某个 CLI 的账号状态 3 分钟前读过，用户切到另一个项目的主对话后打开设置
- **THEN** 直接显示同一份状态和同一个检查时间，不启动 CLI 进程

### Requirement: 自动入口与独立 runtime 的更新一致性
Host SHALL 保存自动发现的启动器或符号链接入口，每次使用时重新解析实体；旧 auto 记录命中已核实的托管版本目录时 SHALL 在前台重新发现入口，以 revision 比较写回，MUST NOT 修改 manual 记录。Pi 管理检查 SHALL 从入口重读 current-version，Worker MUST 保持原支持集合。指向插件早期独立 ZCode runtime 的 auto 记录 SHALL 在桌面应用的身份核对与 `--version` 启动检查都通过后，以同一 revision 比较改写为应用自带的入口；manual 记录与显式配置的 zcodeExecutable MUST 保持不变，检查未通过时 MUST 保留原记录并显示提示。

#### Scenario: Pi 更新切换版本指针
- **WHEN** Pi 自带更新将 current-version 从 1.0.4 改为 1.5.2，旧实体仍存在
- **THEN** 更新后检查读出 1.5.2，旧版本缓存失效；Worker 拒绝未适配 1.5.2，不回退旧实体

#### Scenario: ZCode 自动入口为应用自带的 CLI
- **WHEN** 自动入口位于已核实的 ZCode 桌面应用内
- **THEN** 更新对象为 desktop-app；检查行显示「应用 3.18.2 · CLI 0.17.1」，应用版本用于桌面更新，CLI 版本取自按启动方式执行的 `--version`，并随应用版本、入口大小与修改时间失效；不再显示独立 runtime 的说明

#### Scenario: ZCode 自动记录仍为独立 runtime
- **WHEN** auto 记录为插件早期的独立 ZCode runtime，且桌面应用的身份（macOS bundle id `dev.zcode.app`，Windows PE ProductName `ZCode` 与配套服务商文件）与启动检查均通过
- **THEN** Host SHALL 把记录改写为应用自带的入口，revision 加一，独立 runtime 的文件保持原样

#### Scenario: 更新核对期间不迁移 ZCode 记录
- **WHEN** 更新页的只读身份识别正在解析入口，或 ZCode 的安装、更新、修复操作占用中
- **THEN** Host MUST NOT 迁移独立 runtime 的 auto 记录，更新前后的身份识别 SHALL 得到同一入口；迁移留给操作结束后的下一次普通解析

#### Scenario: ZCode 自动入口为独立 runtime
- **WHEN** auto 记录为独立 runtime，但没有桌面应用、身份不符或 `--version` 启动检查失败
- **THEN** Host SHALL 保留原记录与 revision，继续以独立 runtime 运行；默认应用 bundle id 已核实时更新对象仍为 desktop-app 并读取应用版本，检查行及更新结果说明独立 runtime 未随桌面应用更新，并提示安装或修复 ZCode 桌面应用

#### Scenario: ZCode 应用身份不符
- **WHEN** 固定 runtime 对应的默认应用不存在或 bundle id 不符
- **THEN** 不将该 runtime 映射到桌面应用，不猜测版本或来源

### Requirement: 下载中断恢复与外部命令证据重试
Host SHALL 将连接关闭、重置、超时、fetch 网络错误及正文提前结束与下载停滞纳入同一 200 次续传和 2 小时预算；不可恢复的 HTTP、证书、Range 协议错误及缓存超限 MUST 直接失败；完整文件长度或摘要不符 SHALL 删除临时文件后干净重下一次，仍失败报告“下载的文件校验不通过”，该重下 MUST NOT 消耗或重置 200 次恢复预算或重置 2 小时总上限。

#### Scenario: 中断后按已写入字节续传
- **WHEN** 插件下载发生可恢复网络中断
- **THEN** Host SHALL 发送匹配已写入长度的 Range，并区分中断与停滞文案；200 响应从头覆盖，206 严格核对范围

#### Scenario: 外部下载退出但未更新
- **WHEN** 外部命令非零退出或版本未前进，原始输出包含下载中断证据，且进程范围退出已确认
- **THEN** Host SHALL 重跑同一 argv，保留脱敏输出及分隔行，用独立的自动重试次数表示，共用 200 次及 2 小时恢复预算，并允许取消
- **AND** 无中断证据、版本已前进、身份变化、进程清理未确认时 MUST NOT 自动重跑

### Requirement: 官方本地工件交接
Host SHALL 优先使用已核实的官方本地工件入口，在私有目录下载并校验官方工件，再交由官方安装器；URL MUST 来自内置官方模板或受限发布源，禁止用户输入下载地址或复刻 MiMo 安装步骤。MiMo macOS 默认原生更新 SHALL 下载内置官方 zip，校验 HEAD 长度、content-md5 与 zip 结构、精确提取根成员 mimo，交私有官方脚本 --binary 安装；SHALL 明示同源 MD5 不代表独立签名。 TRAE CN 的接管见「Windows 自带更新的插件下载接管」。

#### Scenario: 官方安装器支持本地工件
- **WHEN** 官方提供本地工件入口及可核对的摘要或长度
- **THEN** Host SHALL 先完成可续传下载、校验及安全的本地工件准备，再调用官方入口；不支持的方式保留按中断证据重跑

#### Scenario: 校验失败只允许一次干净重下
- **WHEN** 完整文件与官方长度或摘要不符
- **THEN** Host SHALL 先删除临时文件，再不带 Range 从零重下；既有恢复计数及总超时保持，第二次仍不符删除文件并报校验失败

#### Scenario: MiMo 本地安装不越过维护锁与复核
- **WHEN** MiMo macOS 默认原生安装使用官方本地工件入口
- **THEN** Host SHALL 在维护锁内先下载后启动安装阶段，官方脚本只从内置地址下载到私有目录并以参数数组执行；安装后身份与目标版本均符合才成功，不清理安装器自有残留目录

### Requirement: Windows 自带更新的插件下载接管
Windows 上 Claude Code、Antigravity、OMP 与 TRAE CN 的官方默认布局更新 SHALL 由插件下载器取得官方工件（可续传、低速重连、真实进度），按官方清单摘要校验后交给官方入口或按官方脚本相同的位置放置；不执行官方脚本中的 PATH 或 shell 配置。TRAE CN 改用官方 offline-install 时 MUST 保留更新前的自动更新标记状态（2026-11-14 用户批准，撤销 9.1 的不接管决定）。

#### Scenario: TRAE 接管下载并保留自身自动更新配置
- **WHEN** 更新 TRAE CN（官方 install_v2 布局）
- **THEN** Host SHALL 按官方发布清单下载主工件、全部 sidecar、Windows 沙箱辅助件与 ripgrep 依赖，逐个按官方 sha256 与长度校验，组成与官方 offline-download 相同结构的私有离线包并以参数数组调用 offline-install；更新前存在的 `auto-update-version` 标记 SHALL 恢复为新 release 目录名，更新前不存在则不创建；首次安装保留既有官方脚本

#### Scenario: Windows 官方脚本只做放置时由插件放置
- **WHEN** Windows 上更新 Claude Code、Antigravity 或 OMP 的官方默认布局
- **THEN** Host SHALL 从内置官方清单取得版本、地址与摘要（Claude manifest sha256、Antigravity manifest sha512、OMP 构建服务 sha256），用可续传下载器取得工件并校验，再按官方脚本的位置写入：Claude 写入 `versions/<版本>` 后替换 `.local/bin/claude.exe`；Antigravity 与 OMP 先写同目录临时文件再替换 `agy.exe`、`omp.exe`；替换失败（文件被占用）SHALL 保留原文件并报告失败，不留下临时文件

#### Scenario: 更新后的首次版本启动较慢
- **WHEN** 更新完成后新程序因首次启动扫描等原因超过常规 5 秒版本命令预算
- **THEN** 更新后校验 SHALL 使用 60 秒总预算及 45 秒版本命令预算，身份及版本符合要求后成功；常规和后台版本检查的默认预算保持不变

#### Scenario: 更新后版本校验仍超时
- **WHEN** 更新后版本命令达到 45 秒或校验达到 60 秒总预算
- **THEN** Host SHALL 在进程范围退出确认后返回 VERIFY_TIMEOUT，说明已替换但首次启动超时、需要稍后重新检查；MUST NOT 因此重新安装或回滚已写入文件
- **AND** 用户取消 SHALL 保留 cancelled；进程范围清理未确认 SHALL 保留 CLEANUP_UNCONFIRMED 与维护隔离，不被 VERIFY_TIMEOUT 覆盖

#### Scenario: 接管下载显示真实进度
- **WHEN** 更新由插件下载器执行
- **THEN** 行内 SHALL 显示已下载字节、总大小、速度与续传/换源次数，不再显示「下载进度无法读取」

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

### Requirement: npm 主包自动换源尊重所选源与官方校验
Host SHALL 为 npm 主 tarball 提供官方 registry 与 npmmirror 的多源列表，所选 registry 优先，follow 时使用 npm 当前 registry；显式 custom 模式 MUST NOT 自动换源（含 MiMo）。tarball 地址 SHALL 按各 registry 标准包路径生成，最终 integrity MUST 始终来自官方精确版本 packument 的 sha512，MUST NOT 采用镜像 integrity。中断/低速恢复 SHALL 复用 HEAD 身份检查、Range/If-Range、200 次和 2 小时预算；共享进度 SHALL 提供可选 sourceHost 表示实际下载 host。桌面包仅在匿名 HEAD 证实同对象第二官方域名与长度/摘要一致时配置备用源；证据不足 SHALL 保持单源。

#### Scenario: npm 官方和镜像双向恢复
- **WHEN** 所选官方或 npmmirror 主 tarball 下载过慢或中断，备用 HEAD 长度和 ETag/摘要一致
- **THEN** Host SHALL 从原已写字节换源，按目标源原始 ETag 发送 If-Range，推送 sourceHost 和切换输出，完成后仍按官方 sha512 校验

#### Scenario: 镜像元数据不能替换信任根
- **WHEN** 镜像 packument 的 integrity 或 tarball 地址被替换
- **THEN** 自动多源模式 SHALL 使用官方 sha512 和标准构造地址；实际文件校验失败只干净重下一次，仍失败不安装

#### Scenario: 自定义地址与未核实桌面备用源
- **WHEN** 下载设置为 custom 或桌面安装包没有同对象第二源证据
- **THEN** Host MUST NOT 自动切换下载 host；同源 Range 恢复及原校验规则保持

#### Scenario: npm 镜像 CDN 精确跳转
- **WHEN** npmmirror 标准 tarball 的 HEAD 返回跳转
- **THEN** Host SHALL 仅接受同包/版本预构造的 cdn.npmmirror.com/packages 精确目标；HEAD 可用严格的 Range 总长度，GET 禁止再次重定向；任意其他目标 SHALL 被拒绝

#### Scenario: 操作启动后修改下载源
- **WHEN** 操作已启动，用户在异步准备期间从 custom 改为官方源或反向修改
- **THEN** 当前操作 SHALL 使用启动时锁定的 registry 与自动换源策略，修改仅影响下一次操作

### Requirement: 桌面首次安装来源与版本复核
macOS 桌面首次安装 SHALL 复用官方桌面发布读取器及共享发布请求预算；URL、摘要、应用名、包内入口和开发者 Team ID MUST 来自 Host 核实的来源。ZIP SHALL 在私有目录解包，DMG SHALL 只读挂载；签名与 Gatekeeper 核对通过后才复制。应用版本 MUST 与计划目标一致才写入原 CLI 路径记录；仅国际版 WorkBuddy 官方 macOS DMG 在 feed SHA-256 核对通过且装后仅提供三段应用版本时，SHALL 按目标前三段比较，四段装后版本仍 MUST 完整相等，指纹 MUST 保留实际读取的版本。Windows 首次安装的发布者与实际落点未核实时 SHALL 仅提供官方说明。

#### Scenario: 国际版包内脚本没有执行位
- **WHEN** 国际版 WorkBuddy 安装后的包内 mjs 可读但无执行位
- **THEN** Host SHALL 交由安装身份读取器核对包名、站点、runtime 与入口，不以可执行文件查找拒绝 mjs，不启动包内程序或为其增加执行位
- **AND** 身份核对失败产生 WorkBuddyUnavailableError 时，VERSION_MISMATCH SHALL 保留其固定 reason 原因码，不暴露原始产品 JSON 或任意底层错误文本

#### Scenario: 国际版只有三段装后应用版本
- **WHEN** 官方 DMG 的 feed SHA-256 已核对，目标为 5.9.4.42593613，装后应用版本为 5.9.4、CLI 版本为 2.165.0
- **THEN** Host SHALL 接受应用短版本与目标前三段一致，保留真实应用/CLI 版本并写回核实的入口，不将 feed build 冒充装后读取值
- **AND** 装后应用版本为 5.9.3 或 5.9.4.42593612 时 MUST 拒绝并保留旧路径记录；CN、ZCode 和 Windows 不适用此三段匹配规则

#### Scenario: 官方摘要与当前桌面包不一致
- **WHEN** 桌面包两次完整下载均与官方摘要不符
- **THEN** Host SHALL 报 INTEGRITY_MISMATCH、删除片段，不执行解包或安装、不写路径，MUST NOT 用本机实际摘要替换官方摘要

#### Scenario: 解包或版本复核失败
- **WHEN** ZIP 解包、签名、复制或目标应用版本复核失败
- **THEN** Host SHALL 保留旧路径记录，清理已确认退出的私有暂存；进程范围清理无法确认时保留隔离，不提前删除其使用中的解包目录

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
- **WHEN** 账号或目录读取因该 CLI 正在更新或安装（MAINTENANCE）被拒
- **THEN** 连接缓存 MUST NOT 把它记为读取错误（不显示红点）；首次安装操作结束并释放维护锁后，Host SHALL 作废该 CLI 的连接显示缓存，让设置页重新读取

#### Scenario: CLI 更新或版本变化不作废账号与模型
- **WHEN** 某个 CLI 经「更新 CLI」页更新结束（成功、失败或取消），或 CLI 自行升级后 Host 发现其版本指纹变化
- **THEN** Host MUST NOT 因此作废该 CLI 的账号与模型显示缓存或增加 revision；账号与模型照常按 CLI 自身的登录规则和 10 分钟有效期重读，CLI 更新后仍保留登录时插件也显示已登录

### Requirement: 国际版 WorkBuddy macOS 官方 DMG 工件选择
Host SHALL 仅对国际版 WorkBuddy 的 darwin feed，将已核实 HTTPS 主机 `download.codebuddy.ai` 下同版本同架构的 `/workbuddy/saas/darwin-{arch}/WorkBuddy-darwin-{arch}-{version}-{8位hex}.zip` 末尾替换为 `.dmg`，保持主机与路径其余部分不变。原 URL MUST 无凭据、端口、查询、片段及编码/规范化歧义，架构 MUST 与请求一致。首次安装和更新 SHALL 严格用 feed 的 `sha256hash` 校验 DMG，不替换摘要、不回退 ZIP。DMG SHALL 复用只读挂载、固定 Team ID `FN2V63AD2J` 与签名 identifier `com.workbuddy.workbuddy-ai`、spctl、ditto 和确认卸载流程；更新 SHALL 保留应用忙闲检查、替换回滚与装后应用版本核对。CN ZIP/ZCode MUST 不变；Windows 见专门规则。

#### Scenario: 国际版 macOS 首次安装或更新
- **WHEN** arm64 或 x64 官方 feed 返回匹配版本与架构的已核实 ZIP 地址及有效 SHA-256
- **THEN** Host 只下载同路径 DMG，并将 feed 摘要用于完整性校验；通过后才只读挂载、核对固定签名与 Gatekeeper、暂存复制和确认卸载
- **AND** 安装/更新后应用版本未达到目标 MUST NOT 报告成功，首次安装 MUST NOT 写回路径

#### Scenario: 来源异常或摘要变化
- **WHEN** 主机、路径、架构、版本或 `.zip` 后缀不符，或下载 DMG 与 feed 摘要不一致（含未来 feed 改为 ZIP 摘要）
- **THEN** Host 拒绝该来源或工件，不启动挂载/解包/签名/安装命令，不自动尝试 ZIP 或替换摘要

#### Scenario: CN 保持 ZIP
- **WHEN** WorkBuddy CN 的 darwin feed 返回 ZIP 与匹配摘要
- **THEN** Host 使用原 ZIP 地址和摘要，继续既有解包流程，不应用国际版映射

#### Scenario: DMG 更新卸载未确认
- **WHEN** 国际版 DMG 更新期间挂载失败、取消或签名失败
- **THEN** Host 仍尝试卸载；卸载未确认 SHALL 进入清理隔离并保留相关目录，MUST NOT 替换旧应用或报告成功

### Requirement: CodeBuddy 官方原生安装与稳定入口
Host SHALL 将当前 home 与官方 XDG_DATA_HOME/LOCALAPPDATA 布局下精确的 CodeBuddy Code 原生入口识别为 self-update，使用参数数组 `[入口, 'update']`；npm 与已核实 Homebrew 安装 SHALL 继续使用原包管理器。Host MUST NOT 将 WorkBuddy 内置 codebuddy-lite、其他 CLI、相似目录、备份文件或未核实的 `.codebuddy/bin` 前缀识别为 CodeBuddy 原生安装。

#### Scenario: Unix 与 Windows 官方布局
- **WHEN** 真实入口位于 Unix 数据根 `codebuddy/versions/<semver>/codebuddy` 或对应稳定 `bin/codebuddy`，或 Windows `%LOCALAPPDATA%/codebuddy/Data/versions/<semver>/codebuddy.exe` 或同根 `bin/codebuddy.exe`
- **THEN** Host SHALL 识别为原生自更新并记录不含版本的 updateRoot；Windows 比较忽略大小写，Unix 保持大小写敏感，MUST NOT 从版本目录名推断实际版本

#### Scenario: 自动记录随版本迁移
- **WHEN** 自动记录或首次发现指向原生版本实体
- **THEN** 前台 SHALL 优先核对并记录同根稳定入口，后台 SHALL 暂缓旧 auto 实体的探测；手动路径与部署配置 MUST NOT 被迁移，稳定入口越界或不可用 MUST NOT 被静默采信

#### Scenario: 更新后入口或实体变化
- **WHEN** 更新完成后重新读取身份
- **THEN** 同一安装 SHALL 要求来源、通道和更新根一致，realpath 符合该根精确布局，所选入口保持相同或变化前后均为该根精确入口；允许原位替换或同根版本迁移，跨根/跨来源/其他文件 MUST 拒绝；之后 SHALL 单独核实实际版本前进，版本探针禁自动升级，原生残留不由插件清理

### Requirement: Windows ZCode 固定 runtime 的桌面关联
Host SHALL 仅为非 manual、未显式配置 executable 的插件固定 ZCode runtime 检查 `%ProgramFiles%\ZCode` 和 `%LOCALAPPDATA%\Programs\ZCode`，依次选择有效安装；MUST NOT 读注册表或启动进程。候选根 MUST 是实际目录而非链接/junction，ZCode.exe MUST 是普通文件，其 PE StringFileInfo.ProductName MUST 精确为 ZCode，并存在 resources/glm/zcode.cjs 文件。PE 读取 MUST 有偏移/长度与总量上限，异常返回无版本；应用版本 SHALL 取 VS_FIXEDFILEINFO ProductVersion 前三段。

#### Scenario: Windows 已安装所有用户版 ZCode
- **WHEN** 固定 runtime 对应的 ProgramFiles ZCode 满足目录、EXE 产品名与内置 CLI 核对，固定版本为 3.14.5.7961
- **THEN** Host SHALL 关联为 desktop-app，appPath 为应用根、appVersion 为 3.14.5，保留独立 runtime 未随桌面更新的 notice，并允许现有 Windows 桌面更新器生成计划

#### Scenario: 仅当前用户目录有效或两个目录均无可核实应用
- **WHEN** ProgramFiles 候选缺失或身份不符
- **THEN** Host SHALL 检查 LOCALAPPDATA 默认候选；两者均无效时 SHALL 保留可信 INSTALL-MANIFEST 的 plugin-runtime 版本和原手动提示，MUST NOT 猜应用版本

#### Scenario: 官方安装程序替换 EXE
- **WHEN** 用户发起更新，校验官方工件后安装程序把同根 ZCode.exe 替换为固定版本 3.18.2.9000
- **THEN** Host SHALL 等整个进程范围退出后重新读取 appVersion=3.18.2，并用原 runtime 路径与同一应用根核对安装身份；EXE 大小/mtime 变化 MUST NOT 导致 IDENTITY_CHANGED，应用根变化 MUST 拒绝，Windows 路径大小写变化 SHALL 视为同一路径
- **AND** 计划 token SHALL 绑定实际应用版本；插件 MUST NOT 提权或添加静默参数，UAC 与向导由官方安装程序处理

### Requirement: Windows 国际版 WorkBuddy 受限安装与无摘要发布
Host SHALL 仅开放国际版 workbuddy + win32 + x64 桌面首次安装；其他未核实 Windows 桌面首次安装 SHALL 保持 manual。首次安装与已有安装更新 SHALL 共用发布验证，只在国际版 Windows feed 的 sha256hash 明确为空字符串时采用 COS 替代；缺失或非法摘要 MUST 拒绝。有 SHA-256 时 SHALL 使用原摘要，摘要失败 MUST NOT 降级。下载 URL SHALL 为严格同版本同架构的 HTTPS download.codebuddy.ai/workbuddy/saas/win32-{arch}-user/WorkBuddy-win32-{arch}-user-{version}-{8位hex}.exe，MUST 拒绝其他主机、路径、后缀、凭据、端口、查询、片段及规范化歧义。

#### Scenario: 无摘要但四重核验通过
- **WHEN** 国际版 Windows feed 摘要为空，官方同 URL HEAD 返回有效 content-length、x-cos-meta-md5、x-cos-hash-crc64ecma
- **THEN** Host SHALL 在私有缓存下载并核对完整文件长度（也等于 feed size，若有）、MD5、CRC-64/XZ；运行前 SHALL 用固定 PowerShell 参数读取 Get-AuthenticodeSignature -LiteralPath，要求 Status=Valid 且 Subject 的 CN/O 精确等于 Tencent Technology (Shenzhen) Company Limited
- **AND** HEAD SHALL 使用 redirect:error；签名 MUST NOT 绕过摘要不符；仅全通过后进入 awaiting-user，仅以 exe 路径启动官方向导，不附加静默/位置参数，不主动提权

#### Scenario: 任何完整性或签名核验失败
- **WHEN** 长度、MD5、CRC64、签名状态或发布者任意不符，或官方元数据/URL 不合法
- **THEN** Host MUST NOT 运行安装程序，SHALL 删除失败下载/执行副本；取消 SHALL 阻止后续执行，已启动进程的停止仍须确认整个进程范围退出，否则保留隔离状态

#### Scenario: 安装后核对实际站点与版本
- **WHEN** 官方安装程序整个进程范围退出
- **THEN** Host SHALL 依次在页面选择的位置、所选目录名不是 WorkBuddyAI 时向导追加的「所选目录\WorkBuddyAI」、ProgramFiles/WorkBuddyAI 与 LOCALAPPDATA/Programs/WorkBuddyAI 查找 WorkBuddyAI.exe 和 resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs，通过现有 resolveWorkBuddyInstallation 核对国际站点、包名、入口及版本后才写路径
- **AND** 国内版、错误版本、取消或进程退出未确认 MUST NOT 写入；实际三段 5.9.4 可匹配已完成完整性与签名核验的四段发布前三段，实际四段版本 MUST 完全相等，MUST NOT 把 feed build 伪装成本地版本

### Requirement: Windows 官方安装程序窗口可见且等待用户时不限时
Host SHALL 仅对 Windows 桌面方式的首次安装与更新，以 Host 内部标记让隐藏中继以可见窗口启动官方安装程序；该标记 MUST NOT 进入 SDK 规格或来自 Client。Worker、CLI 命令、npm 与脚本安装 SHALL 保持隐藏窗口。官方安装程序等待 UAC 与向导期间 MUST NOT 因时限被终止，控制台安装命令 SHALL 保留 10 分钟时限；取消仍 SHALL 确认整个进程范围退出。

#### Scenario: 官方安装程序等待用户超过 10 分钟
- **WHEN** Windows ZCode 更新或国际版 WorkBuddy 首次安装启动官方安装程序，用户 3 小时内未完成向导
- **THEN** 安装程序窗口 SHALL 可见，Host MUST NOT 终止它，仍显示等待用户

#### Scenario: 普通 CLI 与控制台安装
- **WHEN** Host 启动 Worker、CLI 命令或 npm 安装
- **THEN** 中继 SHALL 以隐藏窗口启动，控制台安装超过 10 分钟 SHALL 以 INSTALL_TIMEOUT 结束

### Requirement: 完整检查清除上次操作结果
用户触发的全部检查 SHALL 清空页面保存的上次操作结果；打开页面时只检查缺失项的检查 SHALL 保留这些结果。

#### Scenario: 旧错误在重新检查后消失
- **WHEN** 某 CLI 上次安装显示 VERSION_MISMATCH，用户点「检查更新」
- **THEN** 检查开始后该错误 SHALL 不再显示，行按新检查结果分组

### Requirement: Windows 安装程序结束页启动应用时的完成判定
Host SHALL 以官方安装程序自身退出作为安装结束，输出管道 MUST NOT 无限阻塞完成。进程范围随后仍有进程时，Host SHALL 记录随范围结束而消失的应用主程序进程，并在安装核对成功后经系统外壳重新打开已核实安装目录内的主程序；无法重新打开时 SHALL 提示手动打开。快照进程自身清理未确认 MUST 按清理未确认处理。

#### Scenario: 结束页勾选运行
- **WHEN** 官方安装程序退出时，其结束页启动的应用仍持有输出管道或留在插件 Job 内
- **THEN** Host SHALL 继续核对安装并写入路径记录；被结束的应用 SHALL 经外壳重新打开，页面不报失败

#### Scenario: 签名核验较慢
- **WHEN** 首次安装核对约 500 MB 安装包的 Authenticode 签名耗时超过 5 秒
- **THEN** Host SHALL 继续等待至 120 秒；超时 SHALL 报 VERIFY_TIMEOUT 并且 MUST NOT 运行安装程序

### Requirement: 已有安装只在原安装上更新或修复
Host SHALL 把安装判为不存在、存在但归属未核实、归属已核实三种状态；只有不存在时才允许按默认方式首次安装。已有安装的更新、重新安装与修复，结果 MUST 落在原安装的 root、prefix 或 appPath。下载与执行的渠道不限（官方更新器、npm 安装包、镜像、插件接管），但 MUST NOT 在其他位置另装一份，MUST NOT 把插件的路径记录改到其他根目录。无法确认能在原安装上完成时，Host SHALL 说明原安装的位置和管理渠道并拒绝；损坏的安装 MUST NOT 被当作不存在。

#### Scenario: Windows 托管 Pi 更新
- **WHEN** Pi 的官方托管安装位于 `~\.pi\agent`，版本 1.1.0，用户在「更新 CLI」页更新到 1.5.2
- **THEN** 无论经官方 `pi update --self`、插件接管还是以 npm 安装包为来源，新版本都写入 `~\.pi\agent`；npm 全局目录中不出现新的 Pi，插件记录仍指向原托管安装

#### Scenario: Pi 托管安装损坏
- **WHEN** Pi 的 managed-install.json、current-version 或 releases 存在，但入口损坏
- **THEN** Host SHALL 保留托管安装身份，经官方更新器、同目录接管或以 npm 安装包为来源，把修复结果写回原托管目录；无法写回原目录时拒绝并说明，MUST NOT 在 npm 全局或其他位置另装一份

#### Scenario: npm 安装在非默认前缀
- **WHEN** Windows npm 位于 `C:/tools/lib/node_modules`，入口为 `.cmd` 或其内层 JS
- **THEN** Host SHALL 保留 `C:/tools/lib` 前缀，执行前包根必须等于该前缀下的 node_modules 白名单包；只有 POSIX 才使用 `lib/node_modules`

#### Scenario: 原生、brew 或无法核实的安装
- **WHEN** 已有 CodeBuddy 原生安装、brew 安装或来源无法核实的安装，用户点「重新安装」
- **THEN** Host SHALL 用原更新器或同前缀 brew 修复，或者明确拒绝，MUST NOT 另装到默认的 npm 全局前缀

#### Scenario: 官方脚本不能指定目录
- **WHEN** 官方脚本只能装到默认根目录，而现有安装不在默认根目录
- **THEN** Host SHALL 使用已核实的同目录接管或拒绝，MUST NOT 猜测脚本参数，也 MUST NOT 装到默认根目录

#### Scenario: 没有已有安装
- **WHEN** 该 CLI 在 PATH、插件记录与已知目录中都不存在
- **THEN** Host 按该 CLI 的默认方式全新安装，并写入路径记录

### Requirement: 路径记录在安装身份复核后提交
管理页的安装发现 SHALL 不写路径记录。更新或修复 SHALL 先核实仍是同一 owner、root、prefix 或 appPath，且版本与完整性正确，然后才提交路径记录；失败时 MUST 保持记录和 revision 不变。

#### Scenario: 更新后发现是另一份安装
- **WHEN** 更新命令成功退出，但核对时识别到另一个根目录或另一个管理器
- **THEN** Host SHALL 报告失败，保留原记录及 revision

#### Scenario: Windows 安装向导装到了别处
- **WHEN** 可见的官方安装程序整个进程范围退出后，注册表或应用查找指向 X，而原 appPath 为 Y
- **THEN** Host SHALL 报告「安装程序把新版本装到了 X，原安装 Y 未更新」，不改路径记录；窗口可见与退出确认规则不变

### Requirement: ZCode Worker 运行桌面应用自带的 CLI
Host SHALL 把 ZCode 的自动入口解析为桌面应用自带的 `glm/zcode.cjs`，并用该应用自己的可执行文件以 `ELECTRON_RUN_AS_NODE=1` 启动、预加载插件的解析钩子；插件早期部署的独立 runtime 只作为最后一个候选，MUST NOT 优先于已安装的应用，Host MUST NOT 删除它。Worker 参数、`app-server`、`login`、`logout` 的其余参数、工作目录与宿主代理变量 MUST 保持不变。

#### Scenario: 自动入口的查找顺序
- **WHEN** 没有显式配置和路径记录
- **THEN** macOS 先取 `/Applications/ZCode.app`，再取 `~/Applications/ZCode.app`，Windows 取已核实安装目录下的 `resources\glm\zcode.cjs`；都没有时才使用独立 runtime

#### Scenario: 应用自带入口的启动参数
- **WHEN** Worker、账号登录或退出使用 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`
- **THEN** argv 以 `<应用>/Contents/MacOS/ZCode --require <插件>/zcode-app-resolve.cjs <入口>` 开头（Windows 为 `<安装目录>\ZCode.exe`），其后参数与此前相同；环境变量增加 `ELECTRON_RUN_AS_NODE=1` 与资源目录变量，服务商配置取同一安装的 `config/provider/zcode-builtin.json`

#### Scenario: 应用运行环境没有通过启动检查
- **WHEN** 以上述方式执行 `--version` 失败或没有输出版本号
- **THEN** Host SHALL 改用宿主自带的 Node 运行同一入口，并在账号行与更新行显示提示；应用的可执行文件或入口变化后 SHALL 重新检查

#### Scenario: macOS 上的临时目录
- **WHEN** Host 在 macOS 启动任一 ZCode 进程（Worker、app-server、模型目录读取、`--version` 启动检查、更新页版本读取、`--help`、登录、退出、账号终端）
- **THEN** 该进程的 `TMPDIR`、`TMP`、`TEMP` SHALL 指向 `/tmp/cwn-XXXXXX` 形式的 0700 私有目录，使 ZCode 在其中创建的 Unix 套接字路径短于 104 字节；Windows 与 Linux 不改临时目录

#### Scenario: 启动检查期间路径被修改
- **WHEN** `--version` 启动检查进行中，CLI 路径记录的 revision 发生变化
- **THEN** Host SHALL 在检查结束后再比较 revision，本次解析报告路径已更新，MUST NOT 覆盖新的记录或把它报告为可用

#### Scenario: 账号终端入口
- **WHEN** 入口旁解析不到 `@zcode/tui`（桌面应用自带的 CLI）
- **THEN** 账号状态不提供「账号终端」动作，设置页隐藏该入口；登录与退出仍可用。能解析到该包的完整 runtime 保留账号终端

### Requirement: ZCode 解析钩子只补两个包
预加载的解析钩子 MUST 只在正常解析失败后，把 `@napi-rs/keyring` 与 `playwright-core` 两个包名改从同一安装的 `app.asar` 解析；MUST NOT 改写其他导入，MUST NOT 下载或写入文件。资源目录未给出、`app.asar` 不存在或运行环境不支持同步解析钩子时，钩子 SHALL 不生效。

#### Scenario: 其他包解析失败
- **WHEN** 自带 CLI 导入 `@zcode/tui` 或其他不在名单内的包而解析失败
- **THEN** 钩子保留 CLI 原本的错误，不做第二次解析

#### Scenario: 名单内的包
- **WHEN** 自带 CLI 导入 `@napi-rs/keyring` 或 `playwright-core`，按入口自身路径解析失败
- **THEN** 钩子改从同一安装的 `app.asar/node_modules` 解析；仍失败时报告 CLI 原本的错误

### Requirement: 插件 ZCode 账号目录使用文件密钥
插件自己的 ZCode 账号目录尚未选定密钥来源时，Host SHALL 在该目录创建权限 0600、内容为 32 个随机字节 base64url 的 `credential-secret` 文件，由 ZCode 按其原生规则读取。Host MUST NOT 同时提供两个密钥来源，MUST NOT 改写已有文件，MUST NOT 触碰用户自己的 `~/.zcode`。

#### Scenario: 尚未选定密钥来源
- **WHEN** 账号目录已存在，没有 `credential-source` 标记和 v2 记录，且未设置 `ZCODE_CREDENTIAL_SECRET` 或 `ZCODE_CREDENTIAL_SECRET_FILE`
- **THEN** Host 创建 `credential-secret`，不通过环境变量传递其内容

#### Scenario: 已有密钥来源
- **WHEN** 目录已固定到系统凭据库、已有 v2 记录、已设置任一变量或文件已存在
- **THEN** Host 不创建也不改写任何文件，原样传递用户设置的那一个变量

#### Scenario: 并发启动与中断
- **WHEN** 多个 ZCode 进程同时首次启动，或 Host 在写入密钥期间中断
- **THEN** Host SHALL 先把密钥写入同目录的 0600 临时文件并落盘，再以不覆盖已有文件的方式发布；其他启动只会看到没有密钥文件或完整的密钥文件，后到者沿用已发布的密钥

#### Scenario: 已有密钥文件不可用
- **WHEN** `credential-secret` 已存在但为空、短于 32 字节、长于 4096 字节或权限不是仅本人可读写
- **THEN** Host MUST NOT 覆盖该文件，也 MUST NOT 用它启动 ZCode；Worker 与账号入口 SHALL 返回指出该文件路径的错误

### Requirement: ZCode 规划模式按独立规划状态确认且保持只读
CLI 声明 `independentPlanState` 时，Host SHALL 先把会话权限设为 `build` 再开启规划，并在发送输入前和本轮结束后，从临时 v4 会话快照确认 `config.mode === 'build'` 且 `config.planEnabled === true`；无法确认时 MUST 拒绝启动或报告本轮失败，不得退到可写模式。未声明该能力的旧 CLI 保持原有 `mode.current` 检查。

#### Scenario: 恢复曾用 yolo 的会话进入规划
- **WHEN** 续聊的 ZCode 会话上次使用 yolo 或 guarded，本轮选择规划模式
- **THEN** Host SHALL 先设为 build 再开启规划，快照确认 build 与 planEnabled 后才发送输入

#### Scenario: 大会话快照分片
- **WHEN** 快照超过单帧上限，按 wireVersion 3 分成多片
- **THEN** Host SHALL 按标识、序号、长度和 CRC32 重组后再确认；缺片、重复片、校验失败、身份不符或超过 16 MiB／1024 片时 MUST 拒绝

#### Scenario: 快照之后到达增量帧
- **WHEN** 首个快照完整后、退订回执前到达 online 增量帧
- **THEN** Host SHALL 单独校验该帧；不含权限变化时照常确认，带有权限配置时仍须证明 build 与 planEnabled

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
- **WHEN** 重试进程退出后，回执仍是重试前那一份未完成回执，或回执缺失、读不出、仍在运行、不对应当前 HEAD
- **THEN** Host 如实说明「Hermes 没有写出新的完成回执，无法确认后续步骤已完成」，保持未完成状态和「重试」，MUST NOT 报告成功或执行成功后的清理

#### Scenario: 自动重试等待中取消
- **WHEN** 第一次运行留下未完成回执，用户在自动重试的等待中取消
- **THEN** 取消后核对 SHALL 重新读回执；仍未完成时该行保持「可更新」、警示色和「重试」，MUST NOT 显示为已是最新

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
