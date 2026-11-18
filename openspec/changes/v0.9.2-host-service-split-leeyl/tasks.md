## 1. 领域切分与基线 〔后端｜4h〕

- [x] 1.1 列出 74 个 Remote 方法与内部辅助方法各自使用的 `this` 字段，确定领域划分与上下文对象内容，写入 design.md
  - 基准提交 `086b865`，TypeScript AST 核得 80 个 Remote（74 个直接调用、6 个流）、48 个内部方法及构造函数。决定 5 逐方法列出依赖，机器清单在 `.test-data/baseline/methods.json`。
- [x] 1.2 记录拆分前基线：预览包的 `lib/typert.remote-client.d.ts`、`lib/` 文件清单与 SHA-256、全量测试通过数
  - `corepack pnpm build:preview` 成功。五份 Typert 原件、发布包 1324 个文件及整个预览目录 12244 个普通文件的 SHA-256，另有 845 个依赖链接的目标清单，均在 `.test-data/baseline/`。本 worktree 的忽略项 `lib` 仅链接其隔离预览的 lib，供 Client 自引用类型解析。
  - `corepack pnpm typecheck` 通过；`corepack pnpm lint` 0 error、333 warning（no-explicit-any 252、no-floating-promises 1、import-x/no-cycle 31、no-empty 25、exhaustive-deps 24）。
  - `corepack pnpm exec vitest run --config .test-data/vitest-local.ts`：362 个文件通过、4 个跳过；8841 例通过、15 跳过、0 失败。临时配置合并原配置，仅为两组 Unix 套接字夹具设置可从子进程目录解析的短 TMPDIR，为使用仓库 cwd 的 Qoder 夹具选择空 HOME。其余共用 worktree 内临时目录与 HOME。保留代理；本机监听需要沙箱外运行。详见 `.test-data/baseline/verified.log`。

## 2. 按领域拆分 〔后端｜16h｜前置 1〕

- [ ] 2.1 Harness 会话与 DSH 子 Agent
- [ ] 2.2 历史、运行中消息设置与角色预设
- [ ] 2.3 Worker 管理（改名、目标、删除、恢复、分叉）
- [ ] 2.4 通用设置与 CLI 启用
- [ ] 2.5 CLI 管理与更新
- [ ] 2.6 连接与账号
- [ ] 2.7 模型目录、选型与权限
- [ ] 2.8 消息发送与续聊队列
- [ ] 2.9 index.ts 少于 1000 行、每个领域模块不超过 1000 行；每个领域单独提交，提交前类型检查与全量测试通过

## 3. 契约与回归验证 〔测试｜4h｜前置 2〕

- [ ] 3.1 拆分后预览包与基线对比：远程契约逐字节一致，`lib/` 只新增领域模块产物
- [ ] 3.2 `pnpm lint` 0 error，不新增 warning 与 import 循环；`pnpm spec:check` 通过
- [ ] 3.3 Windows 远程隔离运行 Windows CI 测试文件
- [ ] 3.4 Mac Desktop 实测：设置页、派遣、续聊、停止与 CLI 更新页

## 4. 文档 〔产品｜1h｜前置 2〕

- [ ] 4.1 `doc/design.md` 更新 Host 模块结构说明
