# DSH 0.2.2-rc.5 原生会话扩展

官方 tag `dsh-v0.2.2-rc.5` 对应提交 `9c2670d3bce5275e0d1610272958121af87787bb`。扩展沿用 [rc.3 已核对的补丁](../dsh-0.2.2-rc.3/README.md)，并在 ui-subagent 页头通过可选的根 Slot 属性读取插件改名。四包 Client 由官方预设从源码编译。Host、基线声明和资源继承官方同版本 npm 包。扩展接口用补丁源码单独做类型检查。

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

本次补丁共 50 个文件，SHA256 为 `54d15e80f63e2df11e5eed95c206cf222d66120689f1d35f99114324804be920`。在原 48 文件基础上增加页头组件及其测试文件。独立测试树和构建树均从干净 tag 应用同一补丁，通过反向应用及差异空白检查。

Node 24.22.1 保留代理运行上游四包 Vitest，128 个文件、2,219 项通过，0 失败、0 跳过。ui-session 36 项，ui-conversation 964 项，ui-subagent 124 项，ui-chat 1,095 项。新增的 2 项组件用例覆盖冷启动、按父 ID 切换和释放订阅、嵌套目录、描述与活动状态，以及主区和侧栏导航的原始父子 ID。干净 tag 2,081 项、旧补丁 2,217 项属于前次 rc.5 基线记录。

构建依赖锁含 991 项。生成器从 rc.3 的清单读取并核对实际安装目录，保留 863 条别名，其中 303 条版本变化均属于 DSH。根项目迁往 pmspec 后删除了旧的规划 CLI 别名 `@fission-ai/openspec`。四包源码类型检查均通过，202 个继承的 Host／声明文件及一张 ui-chat 图片与官方 npm 包逐字节一致。无参数 vendor 复核要求四包及 manifest 匹配当前默认目标。rc.3 产物使用显式 `--target 0.2.2-rc.3` 复核。
