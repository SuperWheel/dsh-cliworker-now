# Proposal

## Why

DSH Desktop 0.12.1 的市场安装器在安装后要求必选宿主单例 peer 可从 Harness 安装闭包解析。当前 `package.json` 把 `@deepseek-ai/dsh-client-store` 声明为必选 peer，而官方包只将它作为开发依赖打包，导致市场安装报 `generation peer validation failed`。

## What Changes

- 从 peerDependencies 移除 `@deepseek-ai/dsh-client-store`，保留构建所需 devDependency，不改为可选 peer。
- 在 `scripts/build-dependencies.mjs` 将官方 snapshot store 及 Zustand/Immer 一并内联；保留 React、React DOM、Cordis、UI primitives 外部单例。
- 为内联状态引擎编译浏览器 production 环境常量，避免 CJS 客户端读取 Node/Vite 专属全局；运行实际打包 store 核对同步状态行为。
- 增加从已安装 Harness app manifest 沿 dependencies 与 peerDependencies 解析的闭包回归，以及实际客户端构建的外部依赖检查。
- 在 `doc/tasks.md` 新增 v0.8.3（未发布）记录；所有实际版本保持 0.8.2，变更保持活动状态。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `package-distribution`：限制必选宿主 peer 为 Harness 宿主可见范围内的包，客户端本地状态不依赖范围外的外部导入。

## Impact

涉及开发清单、Client 构建策略、安装契约测试和设计/验收文档。现有唯一调用见 `src/client/native-cli-model-directory.ts`；其每实例本地状态与 Host 无共享身份，不改 Host、Gateway 或 CLI 协议。仅做本地隔离验证，不安装 Desktop、不运行真实模型、不正式构建、提交、发布或修改市场卡片描述。
