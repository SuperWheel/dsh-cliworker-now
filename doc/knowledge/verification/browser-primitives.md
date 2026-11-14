# 替代界面与宿主浏览器原语检查

关联问题：[#11](https://github.com/SuperWheel/dsh-cliworker-now/issues/11)。

插件的四个 `runtime-host` 界面包保留官方模块身份，但其浏览器依赖来自宿主前端注入。Host 能启动、模块能找到或 runtime manifest 校验通过，都不代表所需的浏览器导出存在。若 ContextMeter 调用了缺失的 `useAnchoredPosition`，可能使整个 `conversation.composer.bar` 渲染失败。

## 使用方法

安装冻结开发依赖后，明确指定待验证宿主的 `dsh-web-frontend/dist` 目录。可以使用官方 npm 包的解包目录，不需要读取个人 profile、对话、凭据或运行日志。

```sh
pnpm check:browser --frontend <frontend-dist>
pnpm check:browser --frontend <frontend-dist> --runtime <unpacked-plugin-root>
```

默认检查当前仓库的四个 `runtime-host` 界面包；第二条可检查已解包的插件候选包。先验证 runtime manifest，再以 TypeScript 解析 JavaScript AST，比较替代界面的具名原语引用与宿主实际注入的导出表。不会执行被检查的 JavaScript，也不会修改安装或用户数据。

缺少导出时，输出相对的包 ID 和导出名并以非零状态退出。无法识别、重复或缺失的导出表、动态属性访问及空扫描也不能作为通过结果。工具不依赖固定的压缩符号或 asset 文件名，但宿主若改变导出表的构建形式，可能需要更新解析器。

## 本次验证

在 macOS Apple Silicon、Harness Desktop 0.2.2-rc.3 上，使用仓库提交 `59debd9e5ea20c2b42dda72c3e8b76e637382fa0` 的源码构建并安装：输入框、输入后的发送按钮、CLI Worker 面板及设置页均可用，控制台未再观察到 `useAnchoredPosition` / `slot entry crashed` 原故障。

具备 rc.1 runtime 基线的旧 0.8.9 安装产物可被此工具检出：ui-conversation 和 ui-chat 均要求宿主未导出的 `useAnchoredPosition`。当前仓库 rc.2 runtime 基线通过同一 rc.3 前端的具名导出检查。该结果不等同于声称所有标注 0.8.9 的分发产物都已修复；发布前仍应对实际 tgz 执行第二条命令。

## 验证边界

这是具名导出存在性检查，不验证函数签名、语义、其他浏览器模块、所有 CLI 的模型调用或完整运行时兼容性。仍需在候选包上执行 Desktop 冷启动、已有会话打开、输入/清除文字、发送按钮状态变化、Worker 面板及设置页检查。上述 Desktop 验收没有发送消息或启动真实外部 CLI；Windows 和真实模型任务不在本次验证范围内。

本次仅整理开发检查工具、回归和脱敏验收说明，不修改生产界面代码、runtime 清单、插件权限或发布版本。
