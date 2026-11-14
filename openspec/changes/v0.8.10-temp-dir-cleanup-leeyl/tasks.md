# Tasks

## 1. 规格与源码核对 〔后端｜1h〕

- [x] 1.1 核对泄漏路径、mkdtemp 范围、OMP/Pi 能力与正式运行边界，补齐变更产物
  - 已读 AGENTS.md、doc/openspec.md、配置及 host-lifecycle-durability 主规格；四处删除路径与 catalog 失败保留已确认。Pi 1.5.2 dist 350 个 JS 无 PI_NATIVES_DIR，OMP 二进制存在该字符串；Windows 解包量来自用户提供证据。

## 2. 回收与共享缓存 〔后端｜4h｜前置 1〕

- [x] 2.1 实现尽力重试删除、失败/未确认退出边界与关联回归
  - temporary-tree.mjs 统一 rm 的 6 次/150 ms 重试；四处重点路径及 OMP approval、ZCode 临时目录已接入。真实 Node rm 注入 EBUSY/EPERM/ENOTEMPTY 后重试成功；失败返回 false，catalog 成功结果不被锁定删除覆盖，确认拒绝删除/未确认保留均通过。
- [x] 2.2 实现限定范围清扫、节流与 Host 生命周期，验证链接/年龄/名称边界
  - temporary-sweep.ts 按一小时年龄与实际 mkdtemp 名称筛选，lstat 排除 symlink/junction，进程号目录标记保护存活所有者；十分钟节流、在途合并、卸载 abort/join。tests/temporary-cleanup.test.ts 5 项通过；Windows 账号终端关联模拟测试通过。
- [x] 2.3 实现 OMP 探测共享缓存与版本淘汰，验证环境注入并同步存储说明
  - 身份、登录选项、目录与权限帮助探测使用 <state>/omp-natives；保留最新三个真实版本，年轻/锁定版本延后。原生 bridge 模拟进程读回路径一致，正式 Worker 进程未注入该变量（新增定向测试 1 项通过）。README 与 doc/design.md 已同步。

## 3. 验证与交付 〔测试｜2h｜前置 2〕

- [x] 3.1 执行关联 vitest、typecheck、隔离构建与严格规格和差异检查，记录结果
  - `corepack pnpm exec vitest run tests/temporary-cleanup.test.ts tests/extended-catalog-cleanup.test.ts tests/pi-omp-identity.test.ts tests/native-login-providers.test.ts tests/qoder-accounts.test.ts tests/qodercn-accounts.test.ts`：6 文件，190 通过、1 平台跳过。
  - 首次扩大回归时 `tests/pi-omp-adapter.test.ts` 因沙箱 `listen EPERM 127.0.0.1` 失败；原测试不变，提权执行 `corepack pnpm exec vitest run tests/pi-omp-adapter.test.ts tests/pi-omp-windows-directories.test.ts`：2 文件，141 通过。
  - 新增 bridge 子进程读回测试后，提权执行 `corepack pnpm exec vitest run tests/pi-omp-adapter.test.ts -t 'OMP metadata and approval help share natives'`：1 通过，其余 130 按名称过滤跳过。
  - `corepack pnpm exec vitest run tests/temporary-cleanup.test.ts tests/extended-catalog-cleanup.test.ts tests/windows-account-terminal.test.ts`：3 文件，25 通过。最后补充锁定清扫重试场景后重跑 `tests/extended-catalog-cleanup.test.ts`：7 通过。以上分批去重共覆盖 9 文件、345 通过、1 平台跳过，均为合成进程/文件夹测试。
  - `corepack pnpm typecheck`：Host/Client 对 DSH 0.2.2-rc.3 通过。`corepack pnpm build:preview`：最终隔离包 `.cache/preview-package` 构建通过；ESM 辅助模块在包顶层和 types/host 均能 import。仅既有 Client ESM/CJS 打包建议，无构建错误。
  - `OPENSPEC_TELEMETRY=0 node_modules/.bin/pmspec validate v0.8.10-temp-dir-cleanup-leeyl --strict` 与 `/Library/Developer/CommandLineTools/usr/bin/git diff --check` 通过。没有提交、推送、版本变更或正式 Desktop build；原有未跟踪 PRD/video 文件保持不动。
- [ ] 3.2 Windows 实机复验 native 复用、锁定清理及磁盘占用
  - （未执行：由用户在 Windows 实机执行；本次只做本机自动测试，不安装 Desktop、不调用真实模型。）
