# Design

## 宿主行为（DSH 0.2.2-rc.5 源码）

- `packages/boot/app-boot/src/profile.ts`：`bundlePatchFiles()` 接受字符串或字符串数组；`loadProfileDirectory()` 对每个选中的 bundle 依次 `loadOverlayPatches()`，任何一个补丁读取失败即把整个 bundle 记入 `skippedBundles`，不加入配置层。
- `packages/boot/app-boot/src/index.ts`：`loadOverlayPatches()` 读文件失败抛错；内容必须是顶层 YAML 数组，空数组合法。
- `packages/boot/plugin-manager/src/index.ts`：`selectBundle()` 启用时先调用 `bundleRows()` 读取并组合全部补丁，之后才 `saveManifest()` 写入启用列表；`operations.ts` 安装时也逐个读取补丁。

## 决定

1. 用「必需补丁」表达「构建已完成」：标记文件放在 `lib/` 下，随 `files: ["lib", …]` 进入 npm 与 Release 包；源码检出、ZIP 下载和半途失败的构建都没有它。
2. 标记最后写，并在写之前核对关键入口：`lib/index.js`、`lib/client.js`、`lib/native-runtime-guard/index.mjs`、`lib/native-runtime-guard/host-runtime.mjs`、`lib/typert.host.js`、`lib/typert.remote-client.js`，以及四个 `runtime-host/dsh-client-ui-*/lib/{index,client}.js`。先写临时文件再改名，避免读到半个文件。
3. `--host-only` 构建在客户端之前退出，不生成标记；这种产物本来就不完整，不应被启用。
4. 补丁顺序保持 `cordis.patch.yml` 在前，标记在后；标记为空，不改变组合结果。

## 备选方案

- 让官方四行的 `disabled` 跟随预检结果（`!!js` 条件）：rc.5 支持表达式，但现有预检要求官方行已禁用才算通过，形成循环前提；切换时机也没有原子保证。
- 预检通过后再由插件运行时切换四行：改动大，需要处理 HMR 锁、异步销毁、重复启停与回滚，容易留下半套状态。
- `prepare` 生命周期：实测 pnpm 11.25.0 的 `add <目录>`、`link <目录>` 都不运行 `prepare`，拦不住本地目录链接。
- 只改 README：不能保护已经按错误方式安装的用户。
