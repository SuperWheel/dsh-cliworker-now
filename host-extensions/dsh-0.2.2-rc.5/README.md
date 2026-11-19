# DSH 0.2.2-rc.5 原生会话扩展

官方 tag `dsh-v0.2.2-rc.5` 对应提交 `9c2670d3bce5275e0d1610272958121af87787bb`。扩展只迁移 [rc.3 已核对的补丁](../dsh-0.2.2-rc.3/README.md)，四包 Client 由官方预设从源码编译。Host、基线声明和资源继承官方同版本 npm 包。扩展接口用补丁源码单独做类型检查。

## 重建四包

从插件根目录执行，要求根项目已按 `pnpm-lock.yaml` 冻结安装。将官方仓库的独立 checkout 放入 `.cache/dsh-host-source-022rc5`，先检出上述 tag，再执行以下命令。构建目录和依赖目录仅供本次构建使用。

```sh
/Library/Developer/CommandLineTools/usr/bin/git -C .cache/dsh-host-source-022rc5 apply --3way "$PWD/host-extensions/dsh-0.2.2-rc.5/source.patch"
mkdir -p .cache/dsh-host-build-deps-022rc5
cp host-extensions/dsh-0.2.2-rc.5/build-dependencies/* .cache/dsh-host-build-deps-022rc5/
corepack pnpm --dir .cache/dsh-host-build-deps-022rc5 install --ignore-scripts --frozen-lockfile --store-dir "$PWD/.cache/pnpm-store"
node host-extensions/dsh-0.2.2-rc.5/generate-dependency-links.mjs
node scripts/build-host-extension.mjs --target 0.2.2-rc.5 --prepare-links
node host-extensions/dsh-0.2.2-rc.5/check-client-types.mjs
node scripts/build-host-extension.mjs --target 0.2.2-rc.5
node scripts/build-host-extension.mjs --target 0.2.2-rc.5 --verify
node scripts/vendor-host-extensions.mjs --from artifacts/dsh-host-extension-022rc5-data
node scripts/vendor-host-extensions.mjs
```

补丁迁移与反向应用在指定上游工作树执行。上游 Vitest 使用该源码仓库自身的冻结依赖，浏览器构建使用另一份相同提交和补丁的 checkout。这样两套工具链可以分别占用各自的 `node_modules`。上游 Vitest 配置沿用官方配置，仅从 setupFiles 排除会清除代理变量的 `scripts/test-proxy-environment.ts`。具体路径、测试数字和摘要见[适配任务记录](../../openspec/changes/v0.9.2-dsh-rc5-adapt-leeyl/tasks.md)。

## 本次构建记录

补丁共 48 个文件，SHA256 为 `e96e40bea9924a54d1058adfdaf16fb9a95864659aec19b12c6dcc480f279439`，与 rc.3 完全相同。两个上游工作树在 Node 24.22.1 和同一官方冻结依赖下运行四包测试，干净树 2,081 项、补丁树 2,217 项全部通过。

构建依赖锁含 991 项。生成器从 rc.3 的清单读取并核对实际安装目录，保留 863 条别名，其中 303 条版本变化均属于 DSH。根项目迁往 pmspec 后删除了旧的规划 CLI 别名 `@fission-ai/openspec`。四包源码类型检查均通过，202 个继承的 Host／声明文件及一张 ui-chat 图片与官方 npm 包逐字节一致。无参数 vendor 复核要求四包及 manifest 匹配当前默认目标。rc.3 产物使用显式 `--target 0.2.2-rc.3` 复核。
