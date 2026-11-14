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
- [ ] 4.1 Kimi 三平台 (b)：版本清单 sha256、双源、冒烟等于目标、不降级
- [ ] 4.2 Qoder、Qoder CN (c)：按官方规则选条目（Windows build、legacy、Linux CPU 标志）、relink、version.txt、尊重有效 update.lock；musl 与 Windows arm64 不开放
- [ ] 4.3 MiMo Linux（扩展名 `.tar.gz`）与 Windows (d)+(b)
- [ ] 4.4 Antigravity macOS/Linux (d)、Claude 原生 macOS/Linux (c)
- [ ] 4.5 TRAE CN macOS/Linux (a)：私有 TMPDIR、PATH 含 `~/.local/bin`、Linux bubblewrap；核实并处理 `trae-installation.json` 的 `auto_update`（Windows 同步）
- [ ] 4.6 Codex 独立安装 macOS/Linux (c)：逐成员校验解压、预置 release 目录后由官方脚本收尾
- [ ] 4.7 Hermes 阶段进度条（回执 6 步「第 N/6 步」、日志阶段行、fetch 已接收字节、已用时间）、20 分钟活动续期、失败读 stop_class 后自动重跑一次
- [ ] 4.8 Grok 接管：Unix (c) 加 Windows (b)＋grove＋MinGit；md5＋长度＋冒烟＋平台签名；四项前提；删过期 models_cache.json
- [ ] 4.9 Pi 托管布局接管：122 个 tarball sha512 校验、环回 registry 交官方 `pi update --self`（不行则退回私有缓存＋`npm ci --offline`）；官方阶段显示包计数

## 5. 「更新 CLI」页进度显示 〔前端｜6h｜前置 3〕
- [ ] 5.1 通道标签、多文件合计、阶段文字与已用时间、直接接管原因；长主机名截断悬停显示（13.5 发现）

## 6. 验收与文档 〔测试｜10h｜前置 4,5〕
- [ ] 6.1 模拟回归、类型检查、隔离构建、严格校验；README、`doc/design.md` 同步
- [ ] 6.2 Windows 实机：Kimi、MiMo、Grok（官方阶段）、Qoder、Qoder CN、Hermes 的官方或接管更新；断流时切换与残留清理；失败记忆生效
- [ ] 6.3 Mac 实机：有新版本的 CLI 逐个验收官方进度条与切换（待新版本发布）
- [ ] 6.4 13.5 遗留：接管下载期间取消

## 7. 待决定与后续调研 〔产品｜2h〕
- [x] 7.1 Grok 接管校验强度
  - 2026-11-14 用户定「grok接管」：md5＋长度＋冒烟＋平台签名，见设计决定 7
- [x] 7.2 Pi 与 Hermes 方案
  - 2026-11-14 用户定「pi用插件，hermes按照推荐（但也要有进度条）」：Pi 本版接管；Hermes 不接管、显示阶段进度条，见设计决定 7
- [ ] 7.3 OpenCode Windows、CodeBuddy 原生更新的进度与接管调研
