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
