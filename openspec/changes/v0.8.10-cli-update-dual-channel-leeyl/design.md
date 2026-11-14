## Context

这些 CLI 有自带的更新器，更新时由各自的官方命令完成：Antigravity、Claude 原生安装、Codex 独立安装、Kimi、MiMo、Grok、OMP、Pi、Hermes、OpenCode、Qoder、Qoder CN、CodeBuddy、TRAE CN。

插件目前有两种接管下载：Windows 上的四项（Claude、Antigravity、OMP、TRAE CN）一律先由插件接管；macOS 上的三项（MiMo、OpenCode、OMP）由插件下载后交官方本地入口。两套接管各写在 `windows-artifacts.ts` 和 `local-artifacts.ts` 里。

2026-11-14 用 Fable 做了四轮只读调研，报告在 `.cache/cli-update-research/task-p/`，不入 Git：

- `report-agy-claude-omp-trae-codex.md`
- `report-kimi-grok.md`
- `report-qoder.md`
- `report-mimo-hermes-pi.md`

本设计按调研结论，收敛为「官方优先、看门狗判定、插件接管兜底、失败记忆」四部分，接管统一使用一个下载器。

## Goals / Non-Goals

**Goals**

- 每个自带更新的 CLI 都显示真实进度：能观察字节的显示字节进度，不能的显示阶段文字和已用时间。
- 官方渠道不可用时自动切换到插件接管，切换前清理官方留下的半成品。
- 一个下载器，加上每个 CLI 一份描述和五类放置方式。

**Non-Goals**

- 包管理器安装的进度条。
- 复用官方已下载的部分（第一版不做）。
- 修改 CLI 自身的自动更新设置。
- 降级。

## Decisions

### 决定 1：官方优先，失败记住 7 天（2026-11-14 用户定「改，但记住失败」）

每次更新的执行顺序如下：

1. 查失败记录。有效期内有记录，就直接接管。
2. 否则执行官方命令，同时运行看门狗和官方进度探针。
3. 官方成功：清除失败记录。
4. 判为不可用：写入失败记录，然后终止、清理、接管。
5. 接管失败：报告失败，不写记录，下次仍先试官方。

记录键为 `cli + platform + arch + 安装布局指纹`，布局指纹取 identity 的 executable 与 updateRoot。记录存放在 `cli-management/channel-memory.json`，文件权限 0600。

Windows 上已验收的四项，也从「接管优先」改为这一流程。在 Clash 代理会断流的机器上，首次更新多花的时间是「官方断流后 30 秒」加上接管的时间；之后 7 天内直接走接管。

### 决定 2：看门狗统一阈值

| 判据 | 动作 |
| --- | --- |
| 非零退出且版本未前进 | 切换接管 |
| 输出出现下载中断证据（`recovery.ts` 的 `DOWNLOAD_INTERRUPTION_EVIDENCE`、`retrying from GitHub Releases`、`Download stalled`、`timeout: 300000ms` 等） | 立即切换接管，不再原样重跑 |
| 暂存文件 30 秒不增长 | 切换接管 |
| 暂存文件大小回落（官方内部从零重试） | 切换接管 |
| 60 秒窗口平均速度低于 100 KB/s | 切换接管 |
| 下载满 30 秒后，按当前速度预计撞上官方硬时限（Codex 300 秒、Qoder 300 秒） | 切换接管 |
| 启动 20 秒后仍找不到暂存文件、且没有新输出 | 改用总预算：清单大小 ÷ 200 KB/s，下限 3 分钟、上限 10 分钟，超出即切换 |
| 锁冲突（Qoder `Another update process is running`、Kimi `already in progress`） | 先按 PID 判断锁是否有效。锁有效就报告，不计入失败记录；锁失效就按停滞处理 |

终止顺序：先发 TERM，最多等 5 秒，再终止整个进程树。TRAE 和 Codex 的脚本收到 TERM 后会自己清理，可以省掉大部分清理工作。清理只删本次运行产生的文件，判断依据有三条：启动前对目录做快照、文件名符合规则、修改时间不早于启动时间。

### 决定 3：统一下载器与工件描述

描述的字段：

- `manifest`：清单地址模板、版本核对字段、平台键映射。
- `files[]`：
  - `sources[]`；
  - `bytes`：取清单值，或标记为用 HEAD；
  - `integrity`：sha256、sha512，或从响应头 `x-goog-hash` 读取的 md5；
  - `compression`：none、gzip 或 zstd；
  - `decodedIntegrity`；
  - `dest`；
  - `presigned`；
  - `redirectHosts`。
- `extras[]`：官方脚本、依赖清单、需要改写的元数据。
- `placement`：(a)–(e) 中的一类及其参数。
- `after`：放置后的补充动作，例如 TRAE 恢复自动更新标记。
- `officialProbe`：
  - 暂存目录；
  - 文件名规则；
  - 总量来源；
  - 是否可以给子进程指定私有 TMPDIR 或 TEMP。

下载器新增的能力：

- 多文件聚合进度（修正 TRAE 进度按文件重置）；
- 响应头摘要；
- zstd 解压后二次校验；
- 预签名地址遇 403 时重新取清单。

`zlib.createZstdDecompress` 需要 Node 22.15 及以上，DSH 宿主是否具备待核实；不具备时，Kimi 描述改用裸二进制（如果官方提供），否则报告前提缺失。

### 决定 4：各 CLI 方案

| CLI | 平台 | 官方进度探针 | 接管工件与校验 | 放置 | 状态 |
| --- | --- | --- | --- | --- | --- |
| Antigravity | Windows | 暂存 `%LOCALAPPDATA%\agy\bin\.new`，总量取 HEAD | 平台清单的 url 与 sha512 | (b) | 迁移 |
| Antigravity | macOS、Linux | 暂存路径 `~/.local/bin/.new` 为推断，核实前只显示阶段 | 同一清单的 `darwin_*`、`linux_*`，musl 主机加 `_musl` | (d) 只解出 `antigravity` | 新增 |
| Claude 原生 | Windows | 暂存 `~/.cache/claude/staging/<v>.*/claude.exe`，总量取清单 size | 清单的 sha256 与 size，主站与 GCS 双源 | (c) 写 `versions/<v>` 再复制到启动器 | 迁移 |
| Claude 原生 | macOS、Linux | 同上，路径为推断 | 同一清单，平台键 `darwin-*`、`linux-*[-musl]` | (c) 写 `versions/<v>` 再原子替换符号链接；启动器不是指向 versions 的链接时拒绝 | 新增 |
| OMP | Windows | 暂存 `omp.exe.*.new`，总量取清单 size；走差分时只显示阶段 | 构建清单的 sha256 与 size，R2 预签名地址 | (b) | 迁移 |
| OMP | macOS、Linux | 暂存 `~/.local/bin/omp.*.new` | 同上 | (a) `install.sh --binary` 加 `PI_BUILD_URL=file://` | 迁移 |
| TRAE CN | Windows | 暂存 `%TEMP%\traecli-install-*\`，总量取清单 size 之和 | 发布清单加 ripgrep 清单，逐项 sha256 与 size | (a) `install_v2.ps1 offline-install` | 迁移 |
| TRAE CN | macOS、Linux | 子进程用私有 TMPDIR，轮询 `traecli-install.*/*.gz` | 同上，Linux 多 bubblewrap | (a) `install_v2.sh offline-install`；子进程 PATH 须含 `~/.local/bin` | 新增 |
| Codex 独立 | macOS、Linux | 暂存 `$(getconf DARWIN_USER_TEMP_DIR)tmp.*/codex-package-*.tar.gz`（Linux 用私有 TMPDIR），总量取 HEAD | `release.json` 的 sha256，可与 SHA256SUMS 交叉核对，主站与 GitHub 双源 | (c) 预置 `releases/<v>-<目标>`，再由官方脚本收尾 | 新增，有条件 |
| Kimi | 三平台 | 暂存 `bin/.staging/kimi-*.part`，总量取 HEAD | 版本清单的 sha256，zst 件与解压结果各一个，`cdn.kimi.com` 与 `cdn.kimi.ai` 双源 | (b) 冒烟测试 `--version` 等于目标后改名替换 | 新增 |
| Qoder、Qoder CN | macOS、Linux glibc、Windows x64 | 暂存 `os.tmpdir()/<bin>-update-<uuid>.*` | 锁定版本清单的归档 sha256，按官方规则选条目 | (c) `binDir/<bin>-<v>` 加 relink 加 version.txt | 新增；Windows 有条件 |
| MiMo | macOS | 私有 TMPDIR 下暂存 zip | 双 FDS 源，md5 加长度 | (d) | 迁移 |
| MiMo | Linux、Windows | 同上（Windows 在 `%TEMP%`） | 同上，Linux 改为 `.tar.gz` | (d)；Windows 为 (d) 加 (b) | 新增 |
| OpenCode | macOS、Linux | 未调研，只显示阶段 | 现有描述 | (a) | 迁移 |
| Grok | 全部 | 只显示阶段（官方无可观测暂存） | 响应头 md5（base64）加长度，`x.ai/cli` 与 GCS 双源；冒烟 `--version` 含目标版本；平台签名必做（macOS TeamIdentifier 5Y6N3AJ54S，Windows Authenticode CN=X.AI LLC） | Unix 为 (c) `downloads/grok-<v>-<平台>` 加 `bin/grok`、`bin/agent` 链接；Windows 为 (b) 复制两份，grove 三件全有或全无，MinGit 版本目录已在则跳过 | 新增（决定 7） |
| Pi | 全部（托管布局） | 阶段文字加包计数（第 N/122 个包） | 版本锁文件 122 个 tarball，sha512（8 个取自发布清单），长度取 Range 0-0 | (a) 环回 registry：插件下载校验后经 127.0.0.1 临时服务交 `pi update --self` | 新增（决定 7） |
| Hermes | 全部 | 阶段进度条：回执 `stages[]` 的 6 步（plan、snapshot、apply、deps、build、restart）显示「第 N/6 步」加日志最新阶段行；fetch 阶段另显示 `.git/objects/pack/tmp_pack_*` 已接收字节（无总量）；已用时间 | 分段预取 git（决定 8） | (e) | 慢了就接管：fetch 段由插件分段预取后交回官方；依赖段停滞则停掉重跑（决定 8） |
| CodeBuddy | 全部 | 未调研 | 未调研 | — | 后续调研 |

### 决定 5：放置的安全边界

- 只在官方默认布局下接管。npm 全局安装的副本继续走 npm，例如 Windows 测试机上的 MiMo、Pi。
- 目标版本必须高于已装版本，Kimi 指针回退时不降级。
- 写入只发生在白名单目录内，统一先写同目录临时文件，再 rename。
- 不改 shell 配置和 PATH。调用官方脚本时，要保证子进程 PATH 含 `~/.local/bin`，避免脚本自行追加 PATH。
- 保留宿主的代理环境变量。
- macOS 上不删除仍被映射的 `.bak`（OMP，涉及 TCC 归属）。
- 官方 TRAE 离线安装会把 `trae-installation.json` 的 `auto_update` 写成 false。traex 的自动更新读的是标记、这个策略文件，还是两者都读，需要核实。如果读策略文件，接管后应恢复成更新前的值。

### 决定 6：前端

进度行显示通道标签「官方」或「插件接管」。有字节时显示合计字节、速度、来源主机和续传次数；没有字节时显示阶段文字和已用时间。直接接管时，说明「官方渠道近期在本机失败（N 天内）」。长主机名截断后悬停显示全文。前端由 Opus 子 agent 实现，按 `doc/settings-ui-design.md` 的规则。

## Risks / Trade-offs

- 暂存路径依赖官方的内部命名，官方改版后探针会失效。失效时表现为「20 秒内找不到暂存文件」，会退回总预算判定，不显示错误进度。
- 先试官方会让首次更新变慢，换来的是官方渠道可用时行为与官方一致。
- 统一迁移现有七条接管路径，有回归风险。迁移任务要求原有测试全部保留并通过。
- Codex 的「预置目录后跳过下载」只读过脚本，没有实测。整包解压要逐个成员校验路径。
- Qoder 在 Windows 上新建符号链接可能没有权限，需要回退到复制。

## Migration Plan

1. 先实现统一下载器和描述，把现有七条路径迁移过去，行为不变。
2. 加上看门狗和失败记忆，改为官方优先。
3. 再逐个新增接管描述。
4. 每一步都保留原有测试。实机验收按平台和是否有新版本分批进行。

### 决定 7：Grok 接管、Pi 接管、Hermes 阶段进度条（2026-11-14 用户定）

用户原话：「grok接管，pi用插件，hermes按照推荐（但也要有进度条）」。

- **Grok 接管。** 校验组合为：HTTPS 官方域名、响应头 md5 加长度、冒烟测试 `--version` 含目标版本、平台签名。签名在接管时必做：macOS 用 `codesign --verify --strict` 并核对 TeamIdentifier，Windows 核对 Authenticode 状态为 Valid、主体为 X.AI LLC。下列四项前提任一不满足，就不接管：
  - `bin/grok` 的真实路径在 `~/.grok/downloads/` 下；
  - 没有 Cursor 接管（`grok-switch.json` 不处于 active 或 pending）；
  - `config.toml` 中 `[cli] installer` 为 `internal`；
  - 没有版本上下限把目标版本排除在外。

  接管后删除过期的 `~/.grok/models_cache.json`。官方渠道只显示阶段文字，看门狗用总预算与输出停滞判定。
- **Pi 由插件接管。** 首选「环回 registry」做法：
  1. 插件按版本锁文件下载 122 个 tarball，逐个用 sha512 校验，其中 8 个缺摘要的取自 `pi.dev/api/installer/releases/<v>` 发布清单；
  2. 启动一个只监听 127.0.0.1、随机端口、随机路径令牌的临时静态服务，只提供已校验的文件；
  3. 以 `npm_config_registry=<环回地址>` 执行官方 `pi update --self`，由官方完成锁、暂存、冒烟、切换与清理；
  4. 结束后关闭服务。

  代理按宿主默认：子进程继承宿主的代理环境变量，不额外添加 NO_PROXY 或 noproxy 排除，npm 访问环回地址也按它的默认代理行为处理（2026-11-14 用户定「所有都走代理，按照默认走」）。下载阶段显示 122 个文件的合计字节；官方渠道阶段显示「第 N/122 个包」。原型若证明环回做法不可行，退回到「私有 npm 缓存加 `npm ci --offline`」做法。npm 全局安装的副本不在接管范围。
- **Hermes 不接管，但显示阶段进度条。** 进度条按回执 `stages[]` 的 6 个真实阶段推进，显示「第 N/6 步」，并附日志最新阶段行和已用时间。fetch 阶段另显示已接收字节，取 `tmp_pack_*` 的增长，因为没有总量，不显示百分比。进度条只表示阶段步数，不能伪装成字节百分比。

  总时限为 20 分钟，日志或回执有活动就续期；日志和回执连续 5 分钟都无变化，判定停滞。失败后读 `stop_class` 给出原因，自动重跑一次，仍失败就提示用户。退出码 2（已有更新在运行）不重跑。


### 决定 8：Hermes 慢了就接管（2026-11-14 用户改定）

用户原话：「hermes我允许接管，只要下的太慢就接管」。起因是 Windows 实机：Hermes 第一次 git fetch 失败（`curl 56 schannel`），重跑后整次更新超过 7 分钟。本决定取代决定 7 中「Hermes 不接管」一条，阶段进度条保留。调研报告见 `.cache/cli-update-research/task-p/report-hermes-takeover.md`（不入 Git）。

Hermes 没有可替换的发布包，所以接管的含义是：插件预取并校验内容，再让 `hermes update --yes` 用这些内容自己完成安装。插件不替 Hermes 改检出、依赖、配置或服务。

- **判慢按阶段。** 阶段取自状态文件、`update.log` 和最新修改的回执；0.21.7 在 apply 之后会把剩余工作交给新树的子进程，子进程另开回执，所以以最新回执为准，并核对其中的 pid 是否存活。
  - fetch：沿用 `tmp_pack_*` 增长量；首字节前宽限 60 秒，之后 30 秒无增长、或 60 秒均速低于 100 KB/s 判慢。
  - deps 中的工具下载：`<Hermes 根>/cache/partials/*.part` 30 秒无增长判慢。
  - uv 与 Node 依赖：解包、链接、编译期间没有下载，不按均速判；缓存（`cache/uv`、`cache/pnpm/store`）与日志连续 120 秒都无变化才判停滞。
  - plan、snapshot、build 只受总预算约束；apply 与 restart 不判慢，不中途停止。
- **fetch 接管：分段预取。** 确认 Hermes 进程树已退出后，插件用 Hermes 实际使用的 git（参数数组，保留宿主代理变量，`GIT_TERMINAL_PROMPT=0`）：
  1. `git ls-remote --tags origin` 取当前版本与目标版本之间的稳定标签；
  2. 逐段执行 `git fetch --progress --no-tags --no-write-fetch-head --negotiation-tip=<上一段> --negotiation-tip=HEAD origin refs/tags/<标签>`，每段受同一看门狗约束，慢了只重取当前段；
  3. 校验目标标签解出的提交等于计划目标 sha，且 `git cat-file -e <sha>^{commit}` 成立；对象哈希由 git 收包时校验；
  4. 重新执行同一条 `hermes update --yes`，它的 fetch 变为空操作，其余由 Hermes 完成。

  不写引用、不动工作区和索引，只从 origin 取包（保留部分克隆的 `.promisor` 标记）；不使用 bundle、alternates、浅克隆或 codeload 源码 zip（后者没有长度和摘要）。进度显示「第 k/N 段（标签）」和已接收字节，不显示字节百分比。
- **依赖段：停掉重跑。** uv 在 `--frozen` 下只按锁文件绝对地址下载，没有可用的挂钩，插件不接管 wheel。判定停滞后停掉 Hermes 再跑一次 `hermes update --yes`；各缓存按文件保留，相当于文件粒度续传。最多重跑 3 次，每次都必须比上次多落盘内容才继续。
- **npm 依赖跟随下载源（2026-11-14 用户定「加，跟随下载源」）。** Hermes 官方读取 `npm_config_registry`（或 `.npmrc` 的 `registry`），把锁文件里的 npm 地址换到该 registry，内容仍由锁文件的 sha512／sha256 校验（`pm/index_config.py` 的 `npm_registry_url`、`pm/artifact_mirror.py`）。插件下载源为「跟随」时不额外设置，Hermes 自己读用户的 npm 配置；为「官方」「npmmirror」「自定义」时，以 `npm_config_registry=<该 registry>` 执行 `hermes update --yes`（含接管后的重跑）。代价：该变量进入 Hermes 可复用安装的指纹，之后不带它的更新会重装一次 Node 依赖，包已在本地仓库中，不重新下载。git 代码没有官方镜像，Python wheel 在 `--frozen` 下只按锁文件绝对地址下载，二者不随下载源变化。
- **Windows 网关。** Windows 在 fetch 之前暂停网关，Hermes 被停后网关保持暂停，直到下一次 `hermes` 运行。所以插件停掉 Hermes 后必须再跑一次 `hermes update --yes`；最终仍失败时，提示用户网关可能处于暂停，需要启动一次 Hermes。
- **本版不做。** PM 工具预置（`tools/fetch-<sha256>/` 属内部布局，Hermes 自带下载器已能续传、有官方镜像）和 pnpm 环回 registry（未实测，且会改变 Hermes 可复用安装的指纹），待 Windows 实测后再定。
- **兜底。** 现有「日志和回执连续 5 分钟无活动才停、失败自动重跑一次、退出码 2 不重跑」保留，作为以上规则之外的兜底。
- **提示文字。** Hermes 官方阶段的提示改为如实描述上述规则，不再套用其他 CLI 的「30 秒没有新数据……改由插件下载」。

## Implementation Notes（主任务 1–3 的迁移边界）

- 依照本轮“迁移行为不变”，MiMo macOS 保留单成员解压后交官方 `--binary`，以 `official-local.extract` 表达；未改成直接覆盖入口。OpenCode 旧路径仅有官方 HTTPS 长度和归档 CRC，采用显式 `archiveCrc` 兼容项，没有虚构发布者摘要；新增描述默认仍要求摘要。官方脚本 extras 的原信任边界保持不变。
- 失败记忆按决定 1 先写入；若接管下载、放置、核验失败或取消则清除此键，满足“接管失败，下次仍先试官方”。
- 官方进度中的 MiMo HEAD 按本次暂存实际文件名查询，避免 baseline 选择不同造成错误百分比；无法获取总量仍可显示已确认字节，不显示百分比。
- TRAE 主工件进度包含主件、host、存在时的两项辅助件与 ripgrep；官方安装脚本、改写元数据属于 extras，显示单独准备阶段。自动更新策略文件 `auto_update` 仍按任务 4.5 留待核实，本轮只保持现有标记恢复行为。
- `.gitignore` 原有全局 `artifacts/` 规则会忽略新源码目录，添加仅针对 `src/host/cli-management/artifacts/` 的反向规则，其他工件目录仍忽略。
