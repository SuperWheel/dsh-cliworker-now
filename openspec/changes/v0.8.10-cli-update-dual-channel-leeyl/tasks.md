## 1. 统一下载器与工件描述 〔后端｜10h〕
- [x] 1.1 定义工件描述类型（manifest、files、extras、placement、after、officialProbe），描述与放置实现集中到 `src/host/cli-management/artifacts/`
  - 2026-11-14 决定 7 补充：files.bytes 增加 `RANGE` 长度来源，通过 GET `bytes=0-0` 的 Content-Range 获取整件长度；HEAD 与清单数值路径继续兼容。尚未新增 Grok/Pi 描述（任务 4）。
  - 实施：新增 `artifacts/types.ts`、`windows.ts`、`local.ts`、`probes.ts`、`legacy.ts`、`bundle.ts`、`download.ts`、`placement.ts`，描述含 manifest/files/extras/placement/after/officialProbe；七条既有接管路径通过同一文件循环下载。旧低层下载接口仍供 npm/桌面复用；`.gitignore` 精确放行新源码目录。
  - 验证：`corepack pnpm typecheck` 输出 `Host/Client typecheck passed against DSH 0.2.2-rc.3`；`corepack pnpm exec vitest run tests/cli-management* tests/settings-connection-cache.test.ts`：`Test Files 25 passed (25)`、`Tests 770 passed (770)`（2026-11-14 最终复跑）。
  - 边界：没有增加任务 4 的 CLI/平台描述；已有 Linux OMP/OpenCode 路径复用同一 Unix 描述，支持范围不扩张。
- [x] 1.2 下载器支持多文件聚合进度、响应头 md5（x-goog-hash）、gzip/zstd 解压后二次校验、预签名 403 重取清单；核实 DSH 宿主是否有 `zlib.createZstdDecompress`
  - 2026-11-14 决定 7 补充：122 个模拟 SHA-512 小文件逐个校验、落盘，Range 0-0 探测响应体立即取消，124 次探测包含两次中断续传；合计字节、合计续传、122/122 包步数保持一致。长度全部确认前明确 unknown-total，不提前显示百分比；拒绝忽略 Range、未知/错误 Content-Range、错误 Content-Length、超过 2 GB、弱 ETag、编码响应与 GET 身份漂移。
  - 补充验证：`corepack pnpm exec vitest run tests/cli-management-artifact-descriptions.test.ts tests/cli-management-official-watch.test.ts`：`Test Files 2 passed (2)`、`Tests 39 passed (39)`；指定完整回归 `Test Files 25 passed (25)`、`Tests 782 passed (782)`，完整命令见 3.4。未下载真实 Pi tarball，环回 registry 与官方安装交接仍属任务 4.9。
  - 实施：多文件合计字节/总量/续传；Content-MD5 与 x-goog-hash base64 MD5；gzip/zstd 解压后独立摘要和长度核对；OMP 403 重取清单，版本/长度/摘要不变才续传；保留 10 秒停滞、100 KB/s、200 次/2 小时、多源身份和 2 GB 预算。npm 镜像回官方源允许缺失同对象的可选 MD5 头，但仍核对 HEAD ETag/MD5 身份和官方 SHA-512。
  - 验证：`corepack pnpm exec vitest run tests/cli-management* tests/settings-connection-cache.test.ts`：`Test Files 25 passed (25)`、`Tests 770 passed (770)`（2026-11-14 最终复跑）。 新增 `cli-management-artifact-descriptions.test.ts` 覆盖两种解码、缺失 zstd、双重摘要、403 同对象与三种漂移、聚合、预算和重定向白名单；既有下载/慢速/npm 源测试保留。
  - 运行时只读核对：开发 Node v22.23.1 的 createZstdDecompress 为 function；通过 Desktop 自带 Electron 的 `ELECTRON_RUN_AS_NODE=1 ... -e` 核对 Node v24.21.0 / Electron 44.7.0，同样为 function；模拟用例显式注入缺失解码器并断言 PREREQUISITE_MISSING。没有真实大型下载或 Desktop 内更新任务验收。
  - 兼容偏离：OpenCode 原路径没有发布者摘要，保留原 HTTPS 长度 + 归档 CRC，并以 archiveCrc 显式声明；官方安装脚本 extras 沿用内置 HTTPS 来源。未虚构摘要，新增描述默认仍拒绝缺失摘要。见 design.md Implementation Notes。
- [x] 1.3 放置方式 (a)–(d) 共用实现：同目录临时文件 + rename、白名单路径、Windows 占用重试、失败回滚
  - 实施：(a) 参数数组官方入口，(b) 同目录临时文件原子覆盖，(c) 版本文件加启动器/链接并回滚，(d) 指定根成员解压后替换；精确目标白名单及父目录检查，Windows 占用重试 500/1000 ms。回滚若再失败保留备份；不清理 OMP 的既有 .bak。
  - 验证：`corepack pnpm exec vitest run tests/cli-management* tests/settings-connection-cache.test.ts`：`Test Files 25 passed (25)`、`Tests 770 passed (770)`（2026-11-14 最终复跑）。 既有 Windows EBUSY/EPERM/EACCES、旧版本回滚和大小写保留断言全部保留；新增短暂占用成功、白名单、符号链接父目录、版本链接与 a–d 放置模拟。
  - 边界：Windows 占用与重命名由夹具模拟；真实 Defender/Windows 文件系统行为未验证。

## 2. 迁移现有接管路径 〔后端｜8h｜前置 1〕
- [x] 2.1 Windows Claude、Antigravity、OMP、TRAE CN 改用统一描述，行为不变，原有测试全部保留通过
  - 实施：Claude/Antigravity/OMP/TRAE 的清单校验迁到 artifacts/windows.ts，原兼容入口保留；13.6 agy.EXE 磁盘大小写、13.7 核验总预算 60 秒/版本命令 45 秒及 TRAE 自动更新标记恢复不变。TRAE 主件、host、可选两项辅助件、ripgrep 聚合；脚本 extras 单独显示准备阶段。
  - 验证：`corepack pnpm exec vitest run tests/cli-management* tests/settings-connection-cache.test.ts`：`Test Files 25 passed (25)`、`Tests 770 passed (770)`（2026-11-14 最终复跑）。 `cli-management-local-artifacts-windows.test.ts` 原用例/断言均保留；旧服务接管用例增加“已有官方失败记忆”前置，官方优先由独立新文件验证。
  - 边界：本次没有 Windows 实机或真实 CLI 更新；trae-installation.json 的 auto_update 核实继续留在 4.5，不以标记恢复宣称策略文件已验证。
- [x] 2.2 macOS MiMo、OpenCode、OMP 改用统一描述，行为不变
  - 实施：MiMo/OpenCode/OMP 迁到 artifacts/local.ts；MiMo 保留原双 FDS 源与 MD5/CRC、解压后官方 --binary 交接；OpenCode 保留已核实 signed HEAD 跳转与精确成员；OMP 保留 PI_BUILD_URL 私有本地清单。子进程 PATH 补入安装目录，保留宿主代理变量，不改 shell 配置。
  - 验证：`corepack pnpm exec vitest run tests/cli-management* tests/settings-connection-cache.test.ts`：`Test Files 25 passed (25)`、`Tests 770 passed (770)`（2026-11-14 最终复跑）。 原 Unix 本地工件测试保留；服务接管测试增加失败记忆前置，未删除原断言。
  - 兼容偏离：MiMo 按“迁移行为不变”保留 (d) 解压 + (a) 官方 --binary，而非直接覆盖。边界：没有真实 macOS/Linux 更新或账号调用。

## 3. 官方优先、看门狗与失败记忆 〔后端｜10h｜前置 1〕
- [x] 3.1 官方进度探针：暂存文件（启动前快照、名称规则、修改时间）、阶段（输出/日志/状态文件）、无；私有 TMPDIR/TEMP 注入（可指定的 CLI）
  - 实施：official-watch.ts 提供文件/阶段/无探针；启动前快照、名称规则与 mtime 同时满足才计字节，旧目录中新建文件也排除，符号链接及硬链接不计。清单或 HEAD 给总量，MiMo 按观察到的文件名 HEAD 并注入私有 TMPDIR；OpenCode/OMP 差分只给阶段；显式日志/状态文件支持变化读取。
  - 验证：`corepack pnpm exec vitest run tests/cli-management* tests/settings-connection-cache.test.ts`：`Test Files 25 passed (25)`、`Tests 770 passed (770)`（2026-11-14 最终复跑）。 `cli-management-official-watch.test.ts` 覆盖旧文件增长、旧目录中新文件、mtime、根目录/文件符号链接、Claude 目录清理、MiMo 私有 TMPDIR/总量和日志阶段。
  - 边界：探针路径依据指定只读调研；本次未运行官方更新器观测路径，实际路径改变时回退阶段与总预算。
- [x] 3.2 看门狗按设计决定 2 判定不可用；TERM 后终止进程树，进程范围退出后清理本次暂存，再切换接管；`recovery.ts` 的中断证据改为切换接管
  - 实施：service.ts 官方优先双通道；recovery.ts 对匹配描述/布局使用接管，其他 CLI 保持原恢复。看门狗执行决定 2 的停滞/回落/低速/硬时限/总预算与中断证据；宿主 terminate 的 grace 限制最多 5 秒，waitForExit 确认范围退出后只删本次暂存并接管。非零退出先读版本，已前进则采用官方结果；已是最新不接管。
  - 验证：`corepack pnpm exec vitest run tests/cli-management* tests/settings-connection-cache.test.ts`：`Test Files 25 passed (25)`、`Tests 770 passed (770)`（2026-11-14 最终复跑）。 新增双通道用例覆盖 curl(28)、官方只跑一次、非零但版本前进、已是最新、有效/未知锁、取消、清理未确认隔离和暂存删除时序；纯时钟用例覆盖全部看门狗阈值。
  - 边界：TERM/KILL 顺序对照本机 dsh-subprocess-local/src/spawn.ts 的实现并断言 spawn grace；真实进程树/代理断流/Windows Job 实机未验证。
- [x] 3.3 失败记忆 `channel-memory.json`（0600，7 天，CLI × 本机 × 布局）；取消、已是最新、有效锁冲突、接管失败不计入
  - 实施：channel-memory.json 原子 0600，父目录 0700；键为 CLI/platform/arch/executable+updateRoot 散列，Windows 路径折叠大小写；7 天 TTL，官方成功清除。官方失败先记录，接管失败/取消清除该键；已是最新、锁冲突不计入。进度保留直接接管原因。
  - 验证：`corepack pnpm exec vitest run tests/cli-management* tests/settings-connection-cache.test.ts`：`Test Files 25 passed (25)`、`Tests 770 passed (770)`（2026-11-14 最终复跑）。 覆盖重建对象读回、TTL 边界/时钟倒退、平台/架构/布局隔离、文件权限、损坏/符号链接文件、首次接管失败清除与下次恢复官方。
  - 边界：仅使用测试私有目录验证持久化，没有写真实用户运行数据。
- [x] 3.4 共享协议：进度增加通道、阶段文字、多文件合计、是否字节进度；必要的原因码
  - 2026-11-14 决定 7 补充：新增成组的 currentStep/totalSteps/stepName，支持 Hermes N/6 与 Pi N/122；新增 byteProgressState（none/unknown-total/known-total），实际下载与官方探针均发布对应状态。schema 校验步骤缺项/越界、阶段与字节状态矛盾、未知总量不得带 totalBytes；步骤与字节进度独立，模拟 JSON 往返保留字段。README 与 doc/design.md 已同步。
  - 补充最终验证：`corepack pnpm typecheck`：`Host/Client typecheck passed against DSH 0.2.2-rc.3`；`corepack pnpm exec vitest run tests/cli-management* tests/settings-connection-cache.test.ts`：`Test Files 25 passed (25)`、`Tests 782 passed (782)`（18.44s，比前次增加 12 个模拟用例）；`corepack pnpm build:preview`：`Isolated package ready: /Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now/.cache/preview-package`；`OPENSPEC_TELEMETRY=0 node_modules/.bin/pmspec validate v0.8.10-cli-update-dual-channel-leeyl --strict --no-interactive`：`Change 'v0.8.10-cli-update-dual-channel-leeyl' is valid`；`/Library/Developer/CommandLineTools/usr/bin/git diff --check` 通过。
  - 补充边界：本轮只补通用能力，Hermes 实际回执/日志六步、fetch 探针与重试策略，Pi 官方包计数及 Grok/Pi 接管仍属 4.7–4.9；前端、真实 CLI 更新及跨平台实机未验证。仅局部添加 1.1/1.2/3.4 证据，4.x–7.x 和本变更 proposal/design/spec 保持补充开始时内容。
  - 实施：共享进度新增可选 channel、stage、elapsedSeconds、byteProgress、fileCount/completedFiles、reason；原 downloadedBytes/totalBytes/resumeCount 表示主工件合计，兼容旧字段。增加 UPDATE_LOCKED/OFFICIAL_UNAVAILABLE，双通道发布时用 cliDownloadProgressSchema 校验。README 与 doc/design.md 同步官方优先、7 天失败记忆和进度来源。
  - 验证：`corepack pnpm exec vitest run tests/cli-management* tests/settings-connection-cache.test.ts`：`Test Files 25 passed (25)`、`Tests 770 passed (770)`（2026-11-14 最终复跑）。 schema 模拟拒绝非法通道、负数字节、阶段伪字节及文件计数矛盾；`corepack pnpm typecheck` 通过；`corepack pnpm build:preview` 输出 `Isolated package ready: .../.cache/preview-package`。
  - 规格验证：`OPENSPEC_TELEMETRY=0 node_modules/.bin/pmspec validate v0.8.10-cli-update-dual-channel-leeyl --strict --no-interactive` 通过；`/Library/Developer/CommandLineTools/usr/bin/git diff --check` 通过。
  - 边界：未修改 client/、版本号或 Desktop 链接；前端标签/多文件版式、真实账号/模型/平台验收仍属于主任务 4–7。本轮不归档、不提交、不推送。

## 4. 新增接管描述 〔后端｜14h｜前置 2,3〕
- [x] 4.1 Kimi 三平台 (b)：版本清单 sha256、双源、冒烟等于目标、不降级
  - 实施：`artifacts/native.ts` 锁版 manifest，cdn.kimi.com / cdn.kimi.ai 双源，zstd 与解压后 SHA-256；无 zstd 解码器时用同清单裸二进制 SHA-256。目标同目录临时件 --version 全等目标后原子发布，Windows 先将旧 exe 改名 .old；所有版本探测、官方更新及冒烟均带 KIMI_CODE_NO_AUTO_UPDATE=1。官方探针只读 bin/.staging/kimi-*.part，区分压缩/裸件总量；已有版本更高及官方 already up to date 不降级、不记失败。
  - 模拟验证（本轮 4.1–4.9 共用最终回归）：`corepack pnpm exec vitest run tests/cli-management* tests/settings-connection-cache.test.ts`，原文 `Test Files 30 passed (30)`、`Tests 843 passed (843)`。新增 task4-native 三平台清单/冒烟、版本不符保留旧入口、较低目标不下载及冒烟进程退出未确认时保留暂存断言；既有双通道已是最新用例保留。
  - 追加协议：`officialFailedAt` 为可选非负有限 epoch 毫秒，仅允许 reason=OFFICIAL_RECENT_FAILURE；service 从 channel-memory.failedAt 填入并跨接管进度保留。schema 拒绝负值、NaN/Infinity、其他原因，服务模拟核对记忆时间；未改 src/client/。
  - 边界：没有执行真实 Kimi 或其他 CLI 更新；Windows 占用/原子替换与暂存路径仅脚本、调研及模拟证据。
- [x] 4.2 Qoder、Qoder CN (c)：按官方规则选条目（Windows build、legacy、Linux CPU 标志）、relink、version.txt、尊重有效 update.lock；musl 与 Windows arm64 不开放
  - 实施：`platform.ts` 共用选择器供 versions.ts 与锁版描述使用，Windows build≥17763 排除 legacy 且检查 min_windows_build，Linux CPU 标志选 baseline，macOS Rosetta 选 arm64。版本文件同目录 tmp+rename、相对链接（权限不足复制）、Windows 旧入口 .old、version.txt 和 curl-bash 标记同步；有效锁同时要求 PID 存活及 qodercli/qoderclicn 命令行，无法核实则拒绝。官方私有 TMPDIR/TEMP 探针匹配 <bin>-update-<uuid>，硬时限 300 秒。
  - 模拟验证：4.1 所列完整命令 `30 passed (30)` / `843 passed (843)`；新增 legacy 排在首项、min build 不符、缺任一 CPU 标志、musl/arm64 拒绝、两品牌放置/标记/版本文件、锁 PID 命令行与无法读取、Rosetta 用例。
  - 边界：未实跑官方 updater；私有临时目录效果、Linux/Windows 归档真实结构、Windows 符号链接权限与占用行为待实机核实，不增加未经验证第二源。
- [x] 4.3 MiMo Linux（扩展名 `.tar.gz`）与 Windows (d)+(b)
  - 实施：放开官方 Linux 原生布局，按平台生成 .tar.gz / windows-x64-baseline.zip 等工件；FDS 双源长度/MD5 后安全提取唯一根 mimo/mimo.exe，再同目录事务替换；Windows 仅 .mimocode/bin/mimo.exe，npm 仍走 npm。macOS 既有 --binary 官方交接保留。
  - 模拟验证：4.1 完整命令 `30 passed (30)` / `843 passed (843)`；扩展名、baseline、npm 排除、Linux 能力判断、ZIP 路径/CRC 与原有 macOS 更新回归通过。
  - 边界：本轮没有真实 Linux/Windows 包下载或更新；归档只用微型模拟夹具。
- [x] 4.4 Antigravity macOS/Linux (d)、Claude 原生 macOS/Linux (c)
  - 实施：Antigravity tar.gz 仅取 antigravity，SHA-512，修正 NATIVE_RELEASES 模板及 _musl；Claude 锁版清单 SHA-256、Linux -musl 键，写 versions/<v> 后更新原有版本链接，普通启动器拒绝。两者 Unix 官方探针明确 phaseOnly，只显示阶段。
  - 模拟验证：4.1 完整命令 `30 passed (30)` / `843 passed (843)`；新增阶段描述、平台摘要、根成员、普通 Claude 启动器拒绝；已有版本链接/回滚测试保留。
  - 未验证：两者 Unix 暂存路径和字节含义仍是调研推断，未启用字节探针；musl/跨平台未实机更新。
- [x] 4.5 TRAE CN macOS/Linux (a)：私有 TMPDIR、PATH 含 `~/.local/bin`、Linux bubblewrap；核实并处理 `trae-installation.json` 的 `auto_update`（Windows 同步）
  - 实施：统一离线包描述扩至 Unix，参数数组 sh install_v2.sh offline-install，私有 TMPDIR，PATH 只追加 ~/.local/bin；Linux 包含 bubblewrap 并使用 unknown-linux-musl release 目标。Windows/Unix 均恢复更新前可读取的 auto_update 布尔值与自动更新标记，未存在/无法读取时不猜默认值。
  - 只读核实：官方 install_v2.sh / ps1 的离线安装写 false 已由脚本证实；本机 traex 二进制字符串见 trae-installation.json、TraeInstallation、auto_update 和 local CLI installation policy changed，但不能单凭字符串确认后台自动更新读取哪份文件。消费路径明确未核实，采取保留已有布尔值的保守处理，未运行 traex 更新或读凭据。
  - 模拟验证：4.1 完整命令 `30 passed (30)` / `843 passed (843)`；三平台包依赖、私有 TMPDIR/PATH、旧 true 经官方 false 后恢复及标记；原 Windows 用例继续通过。真实策略生效、Linux bubblewrap 和 shell 配置不写入行为待实机验证。
- [x] 4.6 Codex 独立安装 macOS/Linux (c)：逐成员校验解压、预置 release 目录后由官方脚本收尾
  - 实施：release.json 的 SHA-256、releases.openai.com/GitHub 双源及 release-assets 白名单；流式安全 tar（含 PAX/GNU 长名），逐成员校验路径/链接/特殊类型，按官方设置执行权限，核对 package metadata、codex、host、rg、可选 execServer、Linux bwrap 和目标版本；.staging 完成后 rename，再运行官方脚本 --release <v>。脚本固定默认 CODEX_HOME/安装目录及非 daemon 模式，PATH 追加默认 bin，保留代理。macOS getconf 临时目录、Linux 私有 TMPDIR，硬时限 300 秒；retrying from GitHub Releases 沿用不可用判定。
  - 模拟验证：4.1 完整命令 `30 passed (30)` / `843 passed (843)`；摘要/双源、300 秒/getconf、环境边界、完整目录后脚本交接、tar 越界/重复/设备/硬链接/链接穿透/PAX/GNU 与 ZIP CRC 拒绝、Rosetta 通过。
  - 偏离与边界：已有同名目标 release 目录拒绝覆盖，避免破坏其他进程产物；.staging 名追加随机后缀以隔离并发。未额外 GET SHA256SUMS（release.json 摘要已提供）；官方跳过下载的条件据脚本核对，未下载真实整包或实跑收尾。
- [x] 4.7 Hermes 阶段进度条（回执 6 步「第 N/6 步」、日志阶段行、fetch 已接收字节、已用时间）、20 分钟活动续期、失败读 stop_class 后自动重跑一次
  - 实施：`hermes-watch.ts` 仅官方 (e)，读 HERMES_HOME/logs/update.log、运行中 update_receipts 六阶段与私有 HERMES_UPDATE_STATUS_FILE；按已识别安装根找 .git/objects/pack/tmp_pack_*，仅新件给 unknown-total 已收字节。20 分钟期限随日志/回执/状态活动续期，连续 5 分钟无变化停止；失败输出 stop_class 并自动重跑 --yes 一次，退出码 2 不重跑。仍不执行 hermes --version，不清理检出目录。
  - 模拟验证：4.1 完整命令 `30 passed (30)` / `843 passed (843)`；真实夹具阶段 3/6→5/6、fetch 4 字节无 totalBytes、旧日志排除/活动续期/5 分钟停止、退出 1 重跑和退出 2 不重跑、检出 keep 文件保留。
  - 边界：所有进程、日志与回执均为明确命名的模拟夹具；HERMES_UPDATE_STATUS_FILE 注入效果、Windows 检出/ZIP 回退及实际服务重启未实跑。fetch 仅有可观察的 Git pack 才显示字节。
- [x] 4.8 Grok 接管：Unix (c) 加 Windows (b)＋grove＋MinGit；md5＋长度＋冒烟＋平台签名；四项前提；删过期 models_cache.json
  - 实施：四项归属/策略检查通过才下载，x.ai/cli 与 GCS 双源、长度和响应 MD5；Unix downloads 版本文件+两个相对链接，Windows 两 exe+完整 grove 三件事务替换；MinGit 版本目录存在跳过，否则 ZIP SHA-256 后相邻 .staging 解压改名。发布前版本冒烟、macOS codesign 严格验证及 TeamIdentifier、Windows 参数数组 PowerShell Authenticode Valid 且 CN=X.AI LLC；完成后删过期模型缓存，官方仅阶段/总预算。
  - 模拟验证：4.1 完整命令 `30 passed (30)` / `843 passed (843)`；Cursor/installer/上下限/required/布局逐项拒绝、Unix 双链接与缓存删除、Windows grove 完整性/MinGit 跳过、macOS 错误团队拒绝、Windows 错误主体/状态拒绝及参数数组、多目标取消/越界/父链接拒绝通过。
  - 边界：未实跑任何真实签名工具、Grok 或 MinGit 安装；Linux 无上述平台签名机制，仅长度/MD5/版本。官方更新器内部及暂存行为仍按只读字符串推断；已完成的独立 MinGit 版本目录在后续主件失败时可保留，不删除其他版本。
- [x] 4.9 Pi 托管布局接管：122 个 tarball sha512 校验、环回 registry 交官方 `pi update --self`（不行则退回私有缓存＋`npm ci --offline`）；官方阶段显示包计数
  - 实施前最小原型：`corepack pnpm exec vitest run tests/cli-management-pi-registry-prototype.test.ts`，原文 `Test Files 1 passed (1)`、`Tests 1 passed (1)`；真实 npm + 微型模拟包、私有 cache/config、随机令牌环回，确认 resolved=registry.npmjs.org 被 npm_config_registry（含路径前缀）替换。无公网请求，保留宿主代理；因此采用 (a)，不改为手写 npm 缓存。
  - 实施：锁版 lock/发布清单匹配版本并补齐 8 个缺失 SHA-512，122 条目逐件 RANGE+摘要校验。本地只读官方样本实际为 121 个唯一 URL，重复条目须摘要一致，registry 复用首份映射；条目数量漂移拒绝。服务只监听 127.0.0.1、随机端口/令牌，只读精确映射，拒绝路径穿越、未登记请求、写方法和文件替换。官方 pi update --self 保留代理、私有 npm cache；成功/失败/取消均关闭。官方与交接安装阶段数本次 staging 的真实 package.json，npm 全局布局排除。
  - 模拟验证：4.1 完整命令 `30 passed (30)` / `843 passed (843)`；122 条目/8 个摘要补齐/重复 URL 摘要不一致拒绝、环回安全、成功/失败/取消关闭、代理保留、包计数（包括归档保留旧 mtime）均通过。环回监听在沙箱报 EPERM 后使用已授权的沙箱外测试权限，无真实 CLI 更新。
  - 未验证：按版本的 `pi.dev/api/installer/releases/<v>` 发布清单端点是调研推断（本地只有 /latest 样本）；本轮未 GET 公网或运行真实 Pi updater，官方锁定/暂存/冒烟/指针切换仍待实机核实。
  - 4.x 最终公共验证（2026-11-14）：完整模拟回归 `Test Files 30 passed (30)`、`Tests 843 passed (843)`、`Duration 19.02s`；`corepack pnpm typecheck` 原文 `Host/Client typecheck passed against DSH 0.2.2-rc.3: /Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now/node_modules`；`corepack pnpm build:preview` 原文 `Isolated package ready: /Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now/.cache/preview-package`；`OPENSPEC_TELEMETRY=0 node_modules/.bin/pmspec validate v0.8.10-cli-update-dual-channel-leeyl --strict --no-interactive` 原文 `Change 'v0.8.10-cli-update-dual-channel-leeyl' is valid`；`/Library/Developer/CommandLineTools/usr/bin/git diff --check` 退出 0。README 与 doc/design.md 已同步；仅局部补丁更新本文件 4.x，未勾选其他任务、未归档、未改版本号/客户端、未提交/推送。

## 5. 「更新 CLI」页进度显示 〔前端｜6h｜前置 3〕
- [ ] 5.1 通道标签、多文件合计、阶段文字与已用时间、直接接管原因；长主机名截断悬停显示（13.5 发现）

## 6. 验收与文档 〔测试｜10h｜前置 4,5〕
- [x] 6.1 模拟回归、类型检查、隔离构建、严格校验；README、`doc/design.md` 同步
  - 前端进度行（画板 16、17，用户 2026-11-14 确认后实现）：本地提交 be99f86；`doc/settings-ui-design.md` 增加「进度来源」规范；前端 4 个测试文件 94 项通过。
  - Codex 审查（gpt-6-astra high）发现 5 项，主会话修 4 项：Pi 不再覆盖 `PI_INSTALLER_API_BASE`（本机 Pi 1.5.2 源码核实官方默认基址含 `/releases`，原覆盖会让元数据地址错误）；tar 符号链接改为逐段解析整条链接链，拒绝 `dir/a -> ../other` 再 `../../outside` 这类词法规范化看不出的越界与循环；Grok 在 Windows 的签名校验加进程级 `-ExecutionPolicy Bypass`；MinGit 解压与改名放进同一个清理范围。第 5 项（npm 访问环回 registry 会经宿主代理）按用户「所有都走代理，按照默认走」保持不变，Clash 下能否完成留待 6.2 实机验证。
  - 修复后复测：`corepack pnpm typecheck` 通过；`vitest run tests/cli-management* tests/settings-connection-cache.test.ts tests/cli-update-page.test.tsx tests/client-i18n.test.tsx tests/cli-update-layout.test.ts tests/cli-update-data.test.ts`：34 个文件、939 项通过；`build:preview` 通过；pmspec 严格校验通过；`git diff --check` 通过。新增模拟用例：链式越界、链接循环、Pi 不覆盖基址、PowerShell 执行策略参数。
- [ ] 6.2 Windows 实机：Kimi、MiMo、Grok（官方阶段）、Qoder、Qoder CN、Hermes 的官方或接管更新；断流时切换与残留清理；失败记忆生效
- [ ] 6.3 Mac 实机：有新版本的 CLI 逐个验收官方进度条与切换（待新版本发布）
- [ ] 6.4 13.5 遗留：接管下载期间取消

## 7. 待决定与后续调研 〔产品｜2h〕
- [x] 7.1 Grok 接管校验强度
  - 2026-11-14 用户定「grok接管」：md5＋长度＋冒烟＋平台签名，见设计决定 7
- [x] 7.2 Pi 与 Hermes 方案
  - 2026-11-14 用户定「pi用插件，hermes按照推荐（但也要有进度条）」：Pi 本版接管；Hermes 不接管、显示阶段进度条，见设计决定 7
- [ ] 7.3 OpenCode Windows、CodeBuddy 原生更新的进度与接管调研
