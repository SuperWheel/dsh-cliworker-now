# DSH 0.2.1-rc.5 原生会话扩展

官方 tag `dsh-v0.2.1-rc.5` 固定于 `b830ec950faba0a46dda564be3e2d854afed94f1`。本次未解析官方 app 的构建标记，不把任何应用标记写成 tag commit。

rc.3 的 48 文件扩展在 rc.5 上直接应用、无冲突；导出的补丁与 rc.3 增删行完全相同，只有上下文与索引行不同。rc.4/rc.5 的官方改动（`ui-chat` 推理显示文本与 Body Slot `rawText`、`ui-conversation` 视图标签提示）随源码保留。旧 rc.3 目录及产物保留。

## 隔离重建

所有命令从插件根执行；使用项目 pnpm，禁用依赖安装脚本。先克隆真实 tag checkout 到 `.cache/dsh-host-source-021rc5`（同时取 rc.3 tag 供三方合并）并应用 source.patch。将 build-dependencies 三文件复制到 `.cache/dsh-host-build-deps-021rc5`，执行 `pnpm --dir .cache/dsh-host-build-deps-021rc5 install --ignore-scripts --frozen-lockfile --store-dir <repo>/.cache/dsh-host-pnpm-store-021rc5`。build-dependencies 由 rc.3 三文件改 DSH pin 为 rc.5 得到，第三方依赖与 rc.3 相同（953 个包）。

`dependency-links.json` 由 `generate-dependency-links.mjs` 按 rc.3 清单逐行映射到 rc.5 安装位置，并从磁盘重新读取版本与 package.json 摘要；865 行中 304 个 DSH 包为 rc.5，其余版本不变。

```sh
node host-extensions/dsh-0.2.1-rc.5/generate-dependency-links.mjs
node scripts/build-host-extension.mjs --target 0.2.1-rc.5 --prepare-links
node host-extensions/dsh-0.2.1-rc.5/check-client-types.mjs
node scripts/build-host-extension.mjs --target 0.2.1-rc.5
node scripts/build-host-extension.mjs --target 0.2.1-rc.5 --verify
node scripts/vendor-host-extensions.mjs --from artifacts/dsh-host-extension-021rc5-data
```

四包官方 Host/声明继承同版 npm 基线，新增扩展类型由源码检查验证；浏览器重新构建。上述命令不安装或启动官方 app。上游四包的 Vitest 用例本次未在本机执行（自动模式不允许运行外部仓库代码）；实际验证与未验证边界见 `openspec/changes/upgrade-host-rc5/tasks.md`。
