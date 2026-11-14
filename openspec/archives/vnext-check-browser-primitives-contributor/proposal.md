## Why

问题 #11 暴露了替代界面能够通过 Host 完整性校验，却因宿主浏览器缺少某个原语导出而让输入栏崩溃的缺口。当前 main 已有可恢复该故障环境的界面基线，缺少的是可复用的候选产物检查和准确的验收边界。

## What Changes

- 新增显式指定宿主前端的只读开发检查入口，比对四个替代界面的具名原语依赖与浏览器注入导出。
- 添加缺失 useAnchoredPosition、结构不支持、空扫描及不执行外部代码的回归。
- 记录脱敏后的 Desktop 验收与分发产物核对方式。
- 不修改生产代码、发布版本、安装配置或用户数据。

## Capabilities

### New Capabilities
- `browser-primitive-verification`：浏览器原语具名导出存在性检查。

### Modified Capabilities

无。

## Impact

仅开发 scripts、测试、package.json 的开发命令和文档。使用已有 TypeScript 开发依赖，无新增依赖。不读取个人 profile，不上传本地安装路径、对话、凭据或原始日志。
