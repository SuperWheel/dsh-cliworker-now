# Tasks

## 1. 协议与 Host 原生写入 〔后端｜6h〕
- [x] 1.1 核实各 CLI（Pi、OMP、OpenCode、Hermes、Kimi、TRAE CN）自定义服务商的原生格式、位置与命令，design.md 记录证据与取舍
  - 2026-11-14：已核对六个 CLI；design.md 逐 CLI 记录安装路径、版本/源码 checkout、行号、隔离 HOME 帮助命令与官方标签源码。Pi 1.5.2、OpenCode 1.19.5、Hermes checkout 3b42157858 提供表单；OMP 18.20.0、Kimi Code 2.6.1、TRAE CN 0.215.0 的完整安全写入契约未核实，明确返回 null。
  - 调研只读源码及隔离 --help/--version；没有读取真实凭据、登录/退出或调用模型。Hermes 隔离 --version 返回依赖环境错误，保留源码证据，不当作运行成功。
- [x] 1.2 `src/shared/custom-provider.ts` 协议与 Host Remote：表单描述、提交、校验
  - src/host/index.ts 注册 customProviderForm / saveCustomProvider；协议 src/shared/custom-provider.ts 无修改。parent/CLI/执行权限/维护租约/清理暂停/账号 reservation 均受保护；token 绑定入口与 revision、父会话、目标，10 分钟失效，父会话和 Host 关闭清理。
  - tests/custom-provider-remotes.test.ts：9 项模拟通过，覆盖来源切换、互斥、禁用、规划、取消、父会话关闭、缓存失效与磁盘缓存失败，无真实账号/网络。
- [x] 1.3 各已核实 CLI 的原子写入、凭据保护与缓存作废，模拟测试覆盖成功、冲突、校验失败、写入失败回滚
  - src/host/custom-provider.ts 与 custom-provider-files.ts 实现各自字段、原生配置/凭据分离、输入/冲突校验、原格式增量编辑、临时文件 + fsync + rename、第二文件失败回滚、回滚失败保留私有备份。成功走统一缓存失效；不启动子进程、不改代理环境。
  - tests/custom-provider.test.ts：41 项模拟通过，三个支持 CLI 均覆盖成功、冲突、必填/URL/API/模型校验、暂存失败、第二次 rename 失败、取消及新文件回滚；补充 JSONC、外部编辑、原生账号锁、符号链接、凭据/名称冲突和密钥不回显、不记录日志。
  - 最终关联命令：pnpm_config_verify_deps_before_run=false corepack pnpm test --configLoader runner --no-cache --reporter=json --outputFile=.cache/custom-provider-tests.json tests/custom-provider.test.ts tests/custom-provider-remotes.test.ts tests/accounts.test.ts tests/settings-connection-cache.test.ts tests/cli-management-remotes.test.ts tests/settings-catalog-cache.test.ts；6 文件、227 项通过、0 失败（新增 50 项；accounts 141、cli-management-remotes 9、settings-connection-cache 10、settings-catalog-cache 17）。

## 2. 通用表单模板与账号窗口接入 〔前端｜5h｜前置 1〕
- [ ] 2.1 通用服务商表单模板（Host 描述驱动），样式与登录窗口一致，doc/settings-ui-design.md 补规则
- [ ] 2.2 「其他服务商」接入表单，保留原生终端备选；不支持的 CLI 保持原行为
- [ ] 2.3 前端模拟测试与 build:preview

## 3. 验收 〔测试｜2h｜前置 2〕
- [ ] 3.1 typecheck、关联测试、全量 vitest、严格校验
  - 本次 Host 范围：pnpm_config_verify_deps_before_run=false corepack pnpm typecheck 通过（Host/Client，DSH 0.2.2-rc.3）；同环境 corepack pnpm build:preview 通过，产物 .cache/preview-package；同环境 corepack pnpm spec validate vnext-custom-provider-form-leeyl --strict 通过。git diff --check 通过。
  - 新 worktree 初次 typecheck 因缺少生成 Remote 声明失败；隔离 build:preview 后只把生成 lib 复制到此 worktree 的忽略目录，再运行 typecheck 通过。软链依赖触发 pnpm 的自动重装保护，因此按命令禁用依赖重检；Vitest 默认加载器写软链 node_modules 被拒绝，改用 runner 和 --no-cache，未改主仓库依赖。
  - （未执行：全量 vitest 不属于本次 Host 最小验收；前端由另一 agent 实施，整项保留待办。）
- [ ] 3.2 Mac Desktop 实机：Pi 等已核实 CLI 的表单显示与写入（使用测试用服务商与测试密钥，不调用模型）
  - （未执行：本次只做 Host 与临时 HOME 模拟验收；没有真实账号写入、模型调用、Desktop 或 Windows 验收。）
- [x] 3.3 README、doc/design.md 同步
  - README.md、README.en.md、doc/design.md 同步 Host 支持范围、原生写入、回滚/凭据边界及前端独立验收状态；版本号未改，src/client/** 未改。
