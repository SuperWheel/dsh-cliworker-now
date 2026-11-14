# DSH 0.2.2-rc.3 原生会话扩展

官方 tag `dsh-v0.2.2-rc.3` 固定于 `38a6a5c965aa99ab525161efb7cc5cf1fe62fced`。在插件本工作树 `.cache/dsh-host-source-022rc3` 建立独立 detached worktree；主仓库 rc.2 源码与依赖目录只读，Git 仅更新其共享 worktree 元数据。

## 补丁迁移

三方应用 rc.2 的 48 文件补丁，无冲突，无人工合并。导出补丁与 rc.2 逐字节相同，SHA256 `f4e0b86507dc0d6282427aef46ed7a008779e8b491c9546f029eed4e040832b4`。保留官方 rc.3 行为、版本及 ui-primitives 新图标，插件扩展沿用 rc.2；没有新增语言词条。rc.2 对 CSS anchor、occurrence、file intake 和子会话输入的合并决定继续保留，详见 [rc.2 记录](../dsh-0.2.2-rc.2/README.md)。

## 隔离依赖与重建

依赖目录 `.cache/dsh-host-build-deps-022rc3`，store `.cache/dsh-host-pnpm-store-022rc3`，类型检查输出 `.cache/dsh-host-typecheck-022rc3`，构建产物 `artifacts/dsh-host-extension-022rc3-data/`。从 rc.2 三文件迁移；直接 DSH 依赖固定 `0.2.2-rc.3`，发布期限例外追加 rc.3。先 `install --ignore-scripts` 重新解析锁，再同步实际三文件并冻结安装复核；保留宿主代理环境。

浏览器从扩展源码按官方预设构建；tsdown、tsx、TypeScript 来自隔离依赖，避免跨 rolldown 实例。Host 与声明继承官方 rc.3 npm 包，扩展接口另经四包源码类型检查。vendor 默认 rc.3，旧 rc.1/rc.2 显式目标保留。运行资源排除 src 和 map，保留 ui-chat 图片与 `./assets/*` 导出。

完整锁文件的非 DSH 包版本集合只有 zod 一项变化：rc.2 为 `4.6.6`、`4.6.7`，rc.3 只保留 `4.6.6`；其余非 DSH 包版本集合不变。安装解析 991 项，冻结复核显示 `Lockfile passes supply-chain policies (991 entries)`；安装脚本未执行。pnpm 自动追加的唯一发布期限例外 `@deepseek-ai/dsh-deepseek-chat-import@0.2.2-rc.3` 已同步回冻结 workspace。三文件与实际安装目录逐字节一致。

## 实际构建与验收命令

均从本插件工作树根执行，使用 `corepack pnpm`，没有删除代理环境变量。首次两条 Git 命令在沙箱内退出 128，随后以相同参数提权重试成功；两条安装命令首次遇到 DNS 错误，中断后以相同参数提权重试成功，见下节。

```sh
/Library/Developer/CommandLineTools/usr/bin/git -C <主仓库>/.cache/dsh-host-source-022rc2 worktree add --detach <插件工作树>/.cache/dsh-host-source-022rc3 dsh-v0.2.2-rc.3
/Library/Developer/CommandLineTools/usr/bin/git -C .cache/dsh-host-source-022rc3 apply --3way ../../host-extensions/dsh-0.2.2-rc.2/source.patch
node scripts/build-host-extension.mjs --target 0.2.2-rc.3 --export-patch
# Python 迁移 rc.2 构建三文件到 rc.3 extension 和独立依赖目录；锁文件从 rc.2 原样复制再解析。
corepack pnpm --dir .cache/dsh-host-build-deps-022rc3 install --ignore-scripts --store-dir "$PWD/.cache/dsh-host-pnpm-store-022rc3"
cp .cache/dsh-host-build-deps-022rc3/pnpm-lock.yaml host-extensions/dsh-0.2.2-rc.3/build-dependencies/pnpm-lock.yaml
cp .cache/dsh-host-build-deps-022rc3/pnpm-workspace.yaml host-extensions/dsh-0.2.2-rc.3/build-dependencies/pnpm-workspace.yaml
corepack pnpm --dir .cache/dsh-host-build-deps-022rc3 install --ignore-scripts --frozen-lockfile --store-dir "$PWD/.cache/dsh-host-pnpm-store-022rc3"
node artifacts/dsh-host-rebuild-022rc3/audit.mjs --lock-only
node host-extensions/dsh-0.2.2-rc.3/generate-dependency-links.mjs
node scripts/build-host-extension.mjs --target 0.2.2-rc.3 --prepare-links
node host-extensions/dsh-0.2.2-rc.3/check-client-types.mjs
node scripts/build-host-extension.mjs --target 0.2.2-rc.3
node scripts/build-host-extension.mjs --target 0.2.2-rc.3 --verify
node scripts/vendor-host-extensions.mjs --from artifacts/dsh-host-extension-022rc3-data
node scripts/vendor-host-extensions.mjs
node artifacts/dsh-host-rebuild-022rc3/audit.mjs
corepack pnpm vitest run tests/build-dependencies.test.ts tests/host-runtime-package.test.ts tests/clean.test.ts
/Library/Developer/CommandLineTools/usr/bin/git -C .cache/dsh-host-source-022rc3 diff HEAD --check
/Library/Developer/CommandLineTools/usr/bin/git -C .cache/dsh-host-source-022rc3 apply --reverse --check ../../host-extensions/dsh-0.2.2-rc.3/source.patch
/Library/Developer/CommandLineTools/usr/bin/git diff --check -- scripts/build-host-extension.mjs scripts/vendor-host-extensions.mjs tests/build-dependencies.test.ts tests/host-runtime-package.test.ts tests/clean.test.ts
cp -R <主仓库>/artifacts/dsh-host-extension-022rc2-data artifacts/dsh-host-extension-022rc2-data
node scripts/build-host-extension.mjs --target 0.2.2-rc.2 --verify
node artifacts/dsh-host-rebuild-022rc3/verify-legacy-vendor.mjs
# 验收记录完成后重新构建以纳入本 README，再验证并确认 runtime 字节不变。
node scripts/build-host-extension.mjs --target 0.2.2-rc.3 --replace
node scripts/build-host-extension.mjs --target 0.2.2-rc.3 --verify
node scripts/vendor-host-extensions.mjs --from artifacts/dsh-host-extension-022rc3-data
node scripts/vendor-host-extensions.mjs
node artifacts/dsh-host-rebuild-022rc3/audit.mjs
```

`verify-legacy-vendor.mjs` 只在本工作树 `.cache/rc2-vendor-audit/` 内复制并运行当前 vendor 脚本，显式传 `--target 0.2.2-rc.2 --from <本工作树 rc.2 产物绝对路径>`；主工作树 runtime 不被覆盖。辅助检查、文件迁移与读取命令清单见 `artifacts/dsh-host-rebuild-022rc3/commands.md`。

## 本次已执行的检查

- 三方补丁 48 文件，0 冲突；反向应用检查和源码 `diff HEAD --check` 退出 0。
- `generate-dependency-links`：864 条，0 新增、0 删除，303 条版本变化，非 DSH 别名版本变化 0；旧 rc.2 版本或缓存路径残留 0。
- `--prepare-links` 成功；session、conversation、subagent、chat 类型检查各退出 0。日志在 `.cache/dsh-host-typecheck-022rc3/`。
- 构建、显式 `--verify`、vendor、无参数 vendor 复核均成功：构建 630 文件，runtime 4 包、217 文件（均不含 manifest 自身）。
- 四包版本均为 `0.2.2-rc.3`，来源为上述官方 commit；202 个继承 Host/声明文件与隔离安装的官方 npm rc.3 包逐字节一致。
- runtime 无 `src` 目录、无 `.map`、无 `./src/*` 导出。ui-chat 所有 `lib/assets/*` 文件集合、文件内容和 `./assets/*` 导出均与官方包一致。
- 鲸鱼图片 `running-whale@2x-06738fa29b2f.png` 为 21,631 字节，SHA256 `0fd990d118113d19af7af4480f2b55d610b103451a08be6f7bf5a146823f8bd3`。
- 指定回归：3 个测试文件、37 个测试全部通过，0 失败、0 跳过。新增 rc.3 图选择与缓存保护，保留 rc.2 回归，未支持版本示例移至 rc.4。
- 旧 rc.2 构建 `--verify` 通过 630 文件；旧 vendor 在独立夹具中通过 4 包、217 文件；未重建 rc.2 或更早目标。
- 审计基线覆盖 1,042 个受保护文件：根 package.json / pnpm 配置和锁、预先修改的 build-dependencies.mjs、src、OpenSpec、rc.2 extension 均与操作前 SHA256 相同；不覆盖其他协作者后续独立更改。没有根目录 install。
- 详细审计见 `artifacts/dsh-host-rebuild-022rc3/audit.json`，非 DSH 锁差异见 `non-dsh-lock-changes.json`，安装、类型检查、构建、测试日志同目录。

| runtime Client | SHA256 |
| --- | --- |
| ui-session | `bc2249038f76e2dbe1504fa4de047143a6aecec9ba8bc2fe8eef9b12f0e45ffc` |
| ui-conversation | `5af537507ba81e8a6a000f7f49b62e5c4800dc8341dd0c87a92b0f991c0be563` |
| ui-subagent | `cb5de29974f026bc37d2878254ad9e79d877c6f1b3ff5c0ebffbd375a3aa1af3` |
| ui-chat | `4a53af0fac1dc9eb35d1262cf6aa2c0a2db58194a74c6a2e7d9db3889328cfe3` |

## 失败、重试与非致命警告

共 4 次未成功命令尝试，均已处理，实际代码/类型检查/测试没有失败：

1. 首次 `worktree add` 退出 128：`fatal: could not create directory of '.../.cache/dsh-host-source-022rc1/.git/worktrees/dsh-host-source-022rc3': Operation not permitted`。共享 Git 元数据位于主仓库只读范围；相同命令提权后成功。
2. 首次 `git apply --3way` 退出 128：`fatal: Unable to create '.../.cache/dsh-host-source-022rc1/.git/worktrees/dsh-host-source-022rc3/index.lock': Operation not permitted`。相同命令提权后成功，无补丁冲突。
3. 首次普通隔离安装出现 npm registry `ENOTFOUND`，在重试期间以 Ctrl-C 中断，退出 130；相同命令保留代理环境、提权重试后退出 0（40.5s）。日志 `install.log`、`install-retry.log`。
4. 首次冻结锁复核同样出现 `ENOTFOUND`，Ctrl-C 中断退出 130；相同命令提权重试后退出 0（3.7s），991 项策略检查通过。日志 `install-frozen.log`、`install-frozen-retry.log`。

成功安装另外报告：1 条 tarball 低速警告（36 KiB/s，37 KiB 包）、3 个弃用子依赖（`@smithy/core@3.36.0`、`node-domexception@1.0.0`、`tsconfck@3.1.6`）以及 peer dependency 提示。未为消除警告扩大依赖更新范围，未执行 `pnpm peers check`。构建的 `deps.onlyBundle` 信息是官方预设的提示，未改变预设。

## 未执行与边界

未执行上游四包 Vitest、根项目全量测试/typecheck、整体 preview/build、Desktop 安装/启动/退出和界面验收、真实 CLI/账号/模型调用、Windows 验证；不把源码类型检查、模拟回归或静态文件审计视为这些验收。本次只运行指定的三个根项目测试文件。未触及 `~/.dsh`、用户配置和凭据；未提交、推送或修改插件 Git 分支。主仓库 checkout 与 rc.2 缓存未修改，只有 DSH 共享 Git 元数据为新工作树创建/应用补丁而写入。
