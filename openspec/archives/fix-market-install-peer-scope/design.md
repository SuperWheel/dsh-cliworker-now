# Design

## Context

根因见 [proposal.md](proposal.md)。`NativeCliModelDirectory` 每实例创建官方 snapshot store，只使用 `getSnapshot`、`subscribe`、`set`，不与宿主共享 store 身份。现有 Client 构建通过 `clientBundleDependencies()` 统一控制内联和外部依赖。

## Goals / Non-Goals

**Goals:** 在不改变模型目录行为的情况下，消除对宿主范围外包的运行时依赖，并以当前锁定的 Harness 安装图回归验证。

**Non-Goals:** 不改变 Host/Client 协议、存储路径、订阅生命周期或权限；不改宿主可见范围与市场校验规则，不执行真实 Desktop 安装，不归档或发布。

## Decisions

- 保留官方 store 实现，仅在 Client 的 `alwaysBundle` 增加 `@deepseek-ai/dsh-client-store`、`zustand/vanilla`、`zustand/middleware`、`zustand/shallow` 和 `immer`。这些依赖已在开发清单与锁文件中；不新增依赖或改锁定版本。相比新写本地 store，配置修改更小，也保留官方同步通知、异常订阅隔离、快照引用及冻结语义。
- 仅移除 store 的 peer 声明，保留构建 devDependency。`neverBundle` 中的 React、React DOM、Cordis、UI primitives 保持；测试同时检查 React 子路径，防止内联状态工具时带入第二份 React。
- 内联后发现 Immer 在模块初始化时读取 `process.env.NODE_ENV`，而 Zustand ESM 使用 `import.meta.env`。Client 构建统一通过 `clientBundleDefines()` 将二者替换为 production 常量，不依赖浏览器中不存在的 Node/Vite 全局。回归在不提供 process 的 VM 内运行实际打包模型目录，模拟宿主单例探针，核对 set/getSnapshot、同步通知、同引用去重和取消订阅。
- 从 `node_modules/@deepseek-ai/dsh/package.json` 开始，使用 app-boot 相同的声明者 Node 搜索路径遍历 dependencies + peerDependencies，按首次可解析包名及真实 manifest 路径去重；不遍历 devDependencies，package.json 不受 exports 限制。缺失的依赖分支不扩大可见范围。回归包含原错误 peer 的负例，以及模拟嵌套包/可选 peer 夹具。
- 本地 npm SDK 的实际闭包另缺 `react`、`react-dom`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-slots`。按 Desktop 0.12.1 app.asar 复算的宿主可见范围包含这四项，因此仅在最终 peer 断言显式允许它们。计算器本身不补种子或修改闭包；store 必须在原始闭包负例中单独报缺失，并硬性断言不在 peerDependencies/peerDependenciesMeta。其他必选单例越界仍严格失败。
- 用实际模型目录入口进行内存 Client 打包，断言外部引用与打包源；再检查隔离 preview 的完整产物。包大小与同次未改代码的 preview 基线比较，避免将旧构建漂移误当本次增量。

## Risks / Trade-offs

- [客户端体积增加] → 记录原始及 gzip 大小差异，仅内联本地状态依赖。
- [未来 SDK 的闭包或 store 依赖变化] → 从已安装的锁定 SDK 实算并检查真实打包结果，失败后修正构建声明，不跳过 peer 校验。
- [本地安装图不同于 Desktop 实机] → 仅声称本地自动回归通过；保留真实市场安装与平台验证未执行边界。

## Migration Plan

仅准备源码与隔离产物，所有版本字段保持 0.8.2，在 `doc/tasks.md` 记录 v0.8.3（未发布）。发布与真实市场安装交由后续授权；回退恢复 peer 清单和打包配置即可，无账号、会话或持久化迁移。
