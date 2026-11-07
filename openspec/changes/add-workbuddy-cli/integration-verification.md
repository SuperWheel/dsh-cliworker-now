# v0.8.8 集成验证（2026-11-07）

本次仅合并 `claude/add-workbuddy-cli-d95548` 到 `feat/v0.8.8-integration`，没有归档 OpenSpec、修改版本、正式构建、更新 Desktop、执行真实 CLI、推送或发布。

合并提交：`2e6ff23`（`merge: add-workbuddy-cli into v0.8.8 integration`）。Git 全部通过 `/Library/Developer/CommandLineTools/usr/bin/git`；首次 merge/add/commit 因共享 Git 元数据位于 worktree 外被沙箱拒绝，随后使用获准的沙箱外命令完成。

## 冲突处理（22 个文件）

| 文件 | 处理 |
| --- | --- |
| `AGENTS.md` | 保留 CodeBuddy、TRAE，追加 WorkBuddy/WorkBuddy AI 试验性说明，并保留 Qoder CN。 |
| `README.en.md` | 保留 Grok、CodeBuddy、TRAE 表行，追加两版 WorkBuddy 试验性表行。 |
| `README.md` | 保留 Grok、CodeBuddy、TRAE 表行，追加两版 WorkBuddy 试验性表行。 |
| `scripts/build.mjs` | 保留 native-codebuddy/native-traecn，追加 native-workbuddy/workbuddy-bootstrap 与 helper 打包资源。 |
| `src/client/i18n-messages.ts` | 保留 CodeBuddy/TRAE 词条，追加 WorkBuddy 英文词条。 |
| `src/client/icons.tsx` | 保留 CodeBuddy/TRAE 导入与参数，追加两版 WorkBuddy 图标映射。 |
| `src/host/accounts.ts` | 合并所有账号分支；保留 CodeBuddy 15 秒预算、TRAE 登录流程，WorkBuddy 独立 25 秒预算且无账号操作。 |
| `src/host/adapters.ts` | 保留 CodeBuddy/TRAE 模型与 argv 分支，追加 WorkBuddy 独立发现、模型、原生桥限定分支。 |
| `src/host/authorized-catalog.ts` | 保留 CodeBuddy 快照和二次绑定检查、TRAE 前后绑定检查；追加 WorkBuddy 自校验元数据快照。 |
| `src/host/cli-account-binding.ts` | 保留 CodeBuddy 导入与绑定逻辑，追加 WorkBuddy 元数据绑定。 |
| `src/host/cli-native-capabilities.mjs` | 按 codebuddy、traecn、workbuddycn、workbuddy 保留全部能力项。 |
| `src/host/index.ts` | 保留 CodeBuddy/TRAE 路径配置，追加两版 WorkBuddy 配置；保留自动合并的选版流程。 |
| `src/host/native-attachments.mjs` | 同一支持集合保留全部 CLI，顺序 codebuddy、traecn、workbuddycn、workbuddy。 |
| `src/host/native-bridge.mjs` | 保留 CodeBuddy/TRAE runner；两版 WorkBuddy 绑定独立 native-workbuddy runner。 |
| `src/host/native-worker.ts` | 保留 CodeBuddy/TRAE transport，追加两版 WorkBuddy transport 及其启动准备。 |
| `src/host/process.ts` | 保留 CodeBuddy/TRAE 路径配置类型，追加两版 WorkBuddy 类型。 |
| `src/host/settings-catalog-cache.ts` | 保留 TRAE 总是重新核验绑定的规则，仅将 WorkBuddy 加入无缓存时的自校验发现分支。 |
| `src/shared/account-links.ts` | 集合按指定顺序保留全部单账号 CLI。 |
| `src/shared/conversation-features.ts` | 保留 CodeBuddy 分支限制、TRAE 功能；追加 WorkBuddy 分支限制及两 transport。 |
| `src/shared/types.ts` | CLI_IDS、CLI_LABELS、CLI_SHORT_NAMES 均按指定顺序保留全部 CLI。 |
| `src/shared/worker-permissions.ts` | 保留 CodeBuddy 原生 Auto 与 TRAE 无 Ask 的规则，追加两版 WorkBuddy Ask/Auto。 |
| `tests/fixtures/legacy-runtime.ts` | 合并 Qoder、TRAE、WorkBuddy 原生 ACP 路径条件；CodeBuddy 原有测试行为不变。 |

## ACP 与安全核对

- `src/host/native-acp.mjs` 未产生冲突，与合并第一父提交逐字节一致；单一 `deniedCancelEndsTurn` 默认关闭，WorkBuddy runner 已显式传 `true`，没有重复实现或新增共享开关。
- `native-codebuddy.mjs`、`native-traecn.mjs` 与合并第一父提交逐字节一致。CodeBuddy 与 WorkBuddy runner 保持独立，没有去重。
- `workbuddy-key-helper.cjs`、`workbuddy-bootstrap.mjs`、`native-workbuddy.mjs`、`workbuddy-metadata.ts` 与 WorkBuddy 分支逐字节一致，没有削弱脱敏。密钥读取及派生只在 helper；只经 socket 投递，helper stdout 只有固定成功/失败类别，stderr 不转发；缓冲区清零。Host 元数据仅投影 models、endpoint、安装/站点绑定，未保存密钥。
- 核对隔离包中的 8 份 WorkBuddy 资源与源码字节一致，包括两处 helper 和 runner。
- 安全测试使用模拟密钥，检查 helper stdout、协议事件、fixture 日志、stderr、错误和元数据不含模拟密钥/派生值。完整 socket 路径受下述环境问题阻塞；本次不能据静态审阅声称完成真实密钥或真实 Desktop 验收。

## 合并后修复

`tests/workbuddy-registration.test.ts` 的旧断言认为 WorkBuddy 立即位于 Qoder CN 之后，导致两项注册测试失败。改为验证 Qoder CN 之后的完整后缀 `codebuddy、traecn、workbuddycn、workbuddy`；未改产品行为。

## 命令与结果

所有 pnpm 命令使用 `PATH="$PWD/.cache/bin:$PATH" TMPDIR="$PWD/.cache/tmp-neutral"` 前缀。

```sh
PATH="$PWD/.cache/bin:$PATH" TMPDIR="$PWD/.cache/tmp-neutral" pnpm build:preview
PATH="$PWD/.cache/bin:$PATH" TMPDIR="$PWD/.cache/tmp-neutral" pnpm typecheck
PATH="$PWD/.cache/bin:$PATH" TMPDIR="$PWD/.cache/tmp-neutral" pnpm test tests/workbuddy-*.test.ts tests/native-workbuddy.test.ts tests/codebuddy-*.test.ts tests/native-codebuddy.test.ts tests/traecn-*.test.ts tests/native-traecn.test.ts tests/native-acp*.test.ts tests/worker-permissions.test.ts tests/*routing.test.ts tests/*accounts.test.ts tests/cli-account-binding.test.ts tests/runtime-account-isolation.test.ts tests/native-qoder.test.ts tests/kimi-*.test.ts
PATH="$PWD/.cache/bin:$PATH" TMPDIR="$PWD/.cache/tmp-neutral" pnpm test
PATH="$PWD/.cache/bin:$PATH" TMPDIR="$PWD/.cache/tmp-neutral" pnpm spec:check
/Library/Developer/CommandLineTools/usr/bin/git diff --check
```

- `pnpm build:preview`：退出 0，Host/Client 构建通过；输出 `.cache/preview-package`。
- `pnpm typecheck`：退出 0，Host/Client 均通过，DSH 0.2.2-rc.1。
- 关联测试（31 文件、1203 项），沙箱内首次：28 文件通过、3 文件失败；1161 项通过、42 项失败。40 项受 socket `listen EPERM`／包装的 `ready-listen-failed` 阻塞；2 项为上述旧顺序断言。
- 修改顺序断言后，原关联命令沙箱外重跑：29 文件通过、2 文件失败；1163 项通过、40 项失败。旧顺序问题已消失，剩余为 WorkBuddy socket 长路径，见下节。
- 全量 `pnpm test` 沙箱内：255 文件通过、17 文件失败、4 文件跳过；5648 项通过、347 项失败、14 项跳过（6009 项），另有 20 个未处理错误，退出 1。包含 localhost/socket EPERM 及连带超时；未据此修改产品代码。
- 全量 `pnpm test` 原命令沙箱外重跑：270 文件通过、2 文件失败、4 文件跳过；5955 项通过、40 项失败、14 项跳过（6009 项），退出 1，无额外未处理错误。仅剩上述两个 WorkBuddy 文件的长 socket 路径失败，其余沙箱内失败均消失。
- `pnpm spec:check`：退出 0，60 通过、0 失败。另有既有 `cli-model-discovery` 增量的 archive 重复标题 INFO；本次未归档任何变更。
- `git diff --check`：退出 0。

日志均在被忽略的 `.cache/workbuddy-{build-preview,typecheck,related-sandbox,related-unsandboxed,full-sandbox,full-unsandboxed,spec-check}.log`，不进入 Git。

## 指定 TMPDIR 的限制

严格使用用户指定的工作树内绝对 `TMPDIR`，其路径为 107 字节，`dshwb-XXXXXX/r.sock` 示例为 127 字节。沙箱外的 bootstrap fixture 在 `server.listen` 成功后对完整路径执行 `chmod` 得到 `ENOENT`；runner 也在创建 ready socket 阶段失败。这与 macOS Unix socket 路径长度限制一致，未通过改权限、弱化脱敏或跳过断言掩盖。

受阻文件：`tests/workbuddy-bootstrap.test.ts`（21/34 失败）、`tests/native-workbuddy.test.ts`（19/38 失败）。没有改 WorkBuddy 产品行为。要在此机器完整跑通这 40 项，需要允许使用足够短的绝对临时目录；本次“留在该工作树并使用指定 TMPDIR”的约束下未擅自改用工作树外路径。
