## 1. 排查重复安装的来源 〔后端｜2h〕

- [x] 1.1 审查 `src/host/cli-management/` 中 17 个 CLI 的更新与重新安装路径
  - 2026-11-17 只读审查（Codex gpt-6-astra high）：
    - 普通更新在标准布局下不换位置。
    - 「重新安装」重新选择默认方式并调用 `setManual()`（`install.ts:77-105,195-200,255-261`）；Pi 识别失败时会被放行到这条路（`:80-85`）。
    - Windows npm 前缀被误剥 `lib`（`identity.ts:99`）；`.cmd` 规范成内部 JS 后识别不出安装方式。
    - 更新后的核对晚于写入路径记录（`service.ts:506-508`）。
    - Windows 安装向导不核对新版装到了哪里（`desktop-update.ts:209-211`）。
- [x] 1.2 盘点 Mac 上每个 CLI 的所有副本
  - 2026-11-17 只读盘点：17 个 CLI 中，插件记录的路径都是 PATH 上排第一的那份。
  - 多出来的副本：
    - Pi：npm 全局 1.1.0（10-12）与插件私有运行时 1.0.2（10-05），都没在用；
    - OMP：Bun 全局 17.0.1。
  - Codex、Grok、Qoder、TRAE 在各自目录里保留了自我更新前的旧版本。
  - ZCode：插件私有运行时 0.16.9，而 ZCode.app 自带 0.17.1。
- [x] 1.3 盘点 Windows 上每个 CLI 的所有副本，找出由插件更新产生的第二份
  - 2026-11-17 只读盘点（SSH，未运行任何 CLI）。由插件产生、且插件选用的路径不在 PATH 最前的，只有 Pi 一例：
    - 托管安装 `.pi\agent` 1.1.0 在 PATH 第 34 项；
    - npm 1.5.2 创建于 2026-11-15 20:00:33，在 PATH 第 44 项；
    - 插件记录（r2）指向 npm 那份。
  - 其余多份副本不是插件造成的：
    - MiMo 原生安装之外还有 6-19 手动安装的 npm 0.1.1（插件与 PATH 都选原生）；
    - Qoder、Qoder CN 在各自目录里保留了旧版本；
    - Claude 的 `.local\bin\claude.exe` 与 `versions\2.1.325` 是官方安装器的两份同版本文件；
    - Grok 的 `grok.exe` 与 `agent.exe` 是逐字节相同的同名别名；
    - Hermes 有多个启动器与环境目录。
  - 两台机器上，插件记录的 ZCode 都是插件私有运行时 0.16.9，没有跟上桌面应用自带的 CLI，另行排查（任务 4）。
  - Windows 的 `cli-management` 目录没有更新历史或接管记录，「由插件产生」只能根据时间戳推断。

## 2. 更新与重新安装就地进行 〔后端｜8h｜前置 1〕

- [x] 2.1 已有安装分为不存在、存在但识别不出、已识别三种状态；重新安装与修复的结果写回原安装，移除 Pi 识别失败时转去默认安装的分支
  - 2026-11-17（Codex gpt-6-astra high）：
    - `install.ts:82`：判定三种状态，只有「不存在」才允许默认安装，npm 重新安装沿用原前缀。
    - 新增 `repair.ts` 与 `pi-repair.ts`：经原管理器或原根目录修复。托管 Pi 可以走官方 `pi update --self`，可以走插件接管（以经过校验的 npm tarball 作来源），也可以走绑定原根目录的官方脚本。
    - 运行后核对三点，任一不符即报失败、记录不变：原根目录的 `current-version` 已到目标版本；npm 前缀、APPDATA、PATH 及 Pi 环境变量指定的根目录里没有出现新的 Pi；路径记录仍在原根目录。
  - 第二份副本的来源已全部封住：
    - 旧 `install.ts:80-85,195-200,255-261` 的默认安装；
    - `pi-install.ps1:1133`（未绑定根目录时取默认根）、`:1742`（legacy 走 npm 全局）、`:2056`（经 PATH 发现迁移）；
    - Pi 1.5.2 的 `package-manager-cli.js:990,1023`（自定义更新命令、未绑定根目录时回退为包管理器更新）。
  - 用户澄清（只约束落点，不禁止 npm）后，报错文字、注释、测试、README 与设计中「禁止 npm」类表述全部改为「在原安装上更新、没有新副本」。
- [x] 2.2 修正 Windows npm 前缀推导与 `.cmd` 识别；Windows 路径比较不区分大小写；初次识别时读取 Pi 托管元数据
  - `identity.ts:87,269`：只在 POSIX 剥除 `lib`；按包根目录识别 npm；Windows 路径比较不区分大小写；识别时读取 `managed-install.json` 与 `current-version`。
  - 模拟测试覆盖：`C:/tools/lib`、自定义前缀 `.cmd`、`C:/Users/Admin` 大小写不一致。
- [x] 2.3 官方脚本绑定已核实的目录；无法绑定时走同目录接管或拒绝
  - 官方脚本已存入 `tests/fixtures/official-installers/` 并带 SHA-256；摘要不符时拒绝运行。
  - 环境变量依据：
    - `PI_LEGACY_INSTALL`：`pi-install.ps1:682`、`pi-install.sh:829`
    - `PI_MANAGED_INSTALL_ROOT`：`ps1:1133-1148`、`sh:896-913`
    - `PI_CODING_AGENT_DIR`：`ps1:686-690,1148`、`sh:912-913`
    - `CODEX_INSTALL_DIR` 与 `CODEX_HOME`：`codex-install.sh:16-24`
  - MiMo（macOS）与 OpenCode（Unix）的脚本没有已证实的目录参数：根目录不是默认根时拒绝，不猜测参数。
- [x] 2.4 更新后先核对再写路径记录
  - `adapters.ts:466` 增加只读发现模式；`service.ts:469,692` 在同一安装与版本核对通过后才写记录；核对出另一份安装时，记录与 revision 都不变。
- [x] 2.5 Windows 安装向导结束后核对新版位置
  - `desktop-update.ts:214,335`：保留可见向导；安装程序整个进程范围退出后读取卸载注册表并核对产品身份，位置不同时报「安装程序把新版本装到了 X，原安装 Y 未更新」，记录不变。
  - 修复了一处 ZCode 注册表查询串的错误。
  - 未执行：NSIS `/D=`、Inno `/DIR=` 的目录参数未能从官方证据确认，因此不传参，只做安装后的位置核对。
  - 测试：
    - `tests/cli-management-in-place.test.ts` 28 项模拟用例；
    - `tests/cli-management*.test.ts` 39 个文件 1338 项通过；
    - 其他受影响的 41 个文件 1507 项通过、1 项跳过；
    - typecheck 通过。
    - 全部是模拟测试，未在 Windows 实机运行，未执行真实 CLI 修复。

## 3. 验收与清理 〔后端｜3h｜前置 2〕

- [ ] 3.1 全量 vitest、类型检查与 Windows 隔离回归
  - 2026-11-17：在 ZCode 合并前的提交 3939054 上：
    - Mac 全量 vitest：356 个文件，8564 项通过、14 项跳过；typecheck 通过，`build:preview` 通过。
    - Windows 隔离回归（config-d.json）新增 `os-credential-store`、`cli-account-binding`、`cli-management-in-place` 三个测试文件。
      - 首轮 8adc1889：853/867 通过、8 项失败，全部是测试在 Windows 上的移植问题（POSIX 路径、`pi.cmd`、npm 前缀布局、模拟凭据库没记录 Windows 目标名），没有发现产品代码缺陷。
      - 修复后 d9f2c237：861 项通过、0 失败、6 项跳过。
    - 另外补了一条 win32 账号摘要的断言：`\\?\` 规范路径，sha256 取前 16 位，对照上游 codex rust-v0.169.0 的 `compute_store_key`。
- [ ] 3.2 列出两台机器上已有的重复副本，经用户确认后处理
- [ ] 3.3 同步 README、`doc/usage-details.md` 与设计文档中的更新说明

## 4. ZCode 插件运行时跟随桌面应用 〔后端｜3h｜前置 1〕

- [x] 4.1 查明插件私有运行时停在 0.16.9 的原因，并找出跟随桌面应用的方案
  - 原因：私有运行时是 2026-10-05 从官方源码自建的（`.cache/stage-zcode-runtime.mjs`），插件里没有任何刷新它的逻辑；`versions.ts:99` 返回的是桌面应用版本 3.18.2，所以更新页看不出 Worker 实际跑的是 0.16.9。
  - 直接运行自带 CLI 的核实结果（未调用模型）：自带的 0.17.1 协议兼容，但缺 `@zcode/tui`、`playwright-core`、`@napi-rs/keyring`。Windows 自带的文件与 Mac 逐字节相同（SHA-256 08726b5e…）。
  - Fable 的分析：
    - ZCode.app 用自己的 Electron 以 `ELECTRON_RUN_AS_NODE=1` 运行 `glm/zcode.cjs`。Mac 与 Windows 的 RunAsNode 开关都开着（fuse wire 101000011）。
    - 加一个解析钩子，把 `@napi-rs/keyring` 与 `playwright-core` 指向同一个应用的 `app.asar`，两个平台都能解析到。
    - Mac 上 app-server 握手、会话建立、切换模式、关闭均通过。
    - `@zcode/tui` 没有随桌面应用发布。
    - npm 上和 GitHub 上都没有官方的独立 CLI 发行版。
  - 用户 2026-11-17 决定：采用这一方案，管理终端入口隐藏；凭据密钥用插件 ZCode 账号目录里的 `credential-secret` 文件（0600）。
- [ ] 4.2 按桌面应用的方式运行自带 CLI：解析钩子、密钥文件、迁移自动路径记录、更新页同时显示应用版本与 CLI 版本、隐藏管理终端
- [ ] 4.3 迁移成功后，经用户确认删除旧的私有运行时
