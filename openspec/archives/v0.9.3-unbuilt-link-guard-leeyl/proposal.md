# Proposal

## Why

2026-11-22 用户反馈（Windows 10，DSH Desktop 0.2.2-rc.5，插件 0.9.2）：启用插件后对话区右侧整体不可操作、输入栏消失，没有可见报错，重启仍在，停用并重启后恢复。用户用 AI 助手只读采集的诊断报告显示：profile 里插件是 `link:` 到一个 `dsh-cliworker-now-main` 源码目录（推测为 GitHub「Download ZIP」），目录里没有 `lib/` 构建产物，也没装依赖。

2026-11-22 在 Mac 隔离 web profile（DSH 0.2.2-rc.5）复现（Codex gpt-6.2-astra high）：

- `git archive v0.9.2` 导出的源码树以本地目录安装后启用：管理器返回 failed（operation-error），但启用列表已写入、官方 `ui-session`、`ui-conversation`、`ui-subagent`、`ui-chat` 四行已禁用；预检 `lib/native-runtime-guard/index.mjs` 和主入口不存在，两个替代界面又因缺少依赖导入失败。对话区和输入栏消失，重启 Host 后仍然缺失；停用后恢复。
- npm 0.9.2 正式包热启用、冷启动都正常。

根因：rc.5 启用插件时先保存启用选择、再验收各行能否启动；失败后保留了已保存的选择。插件的 `cordis.patch.yml` 一启用就静态关闭官方四行，替代界面却依赖构建产物，于是未构建的源码目录也能把官方对话界面关掉，并且跨重启延续。

## What Changes

- `package.json` 的 `dsh.bundle.patch` 改为两个文件：现有 `./cordis.patch.yml`，加上构建最后一步才生成的 `./lib/build-complete.patch.yml`（内容为空列表）。
- 新增 `scripts/build-complete-marker.mjs`：核对 Host、Client、预检、协议和四个随包界面的入口全部存在后，原子写入标记；缺任何一个就让构建失败，不写标记。`scripts/build.mjs` 开头本来就清空 `lib/`，失败的构建不会留下旧标记。
- 效果（依据 rc.5 源码）：启用时插件管理器在保存选择前读取每个声明的补丁（`selectBundle` → `bundleRows` → `loadOverlayPatches`），标记缺失即拒绝、不改 profile；冷启动时 `loadProfileDirectory` 读不到补丁会整层跳过该插件，已误选中的旧目录自动恢复官方界面。
- 预览构建与 Windows 远程构建的文件清单加入新脚本；README（中英）与安装细节文档说明未构建的源码目录不能使用及恢复方式。

## Capabilities

### Modified Capabilities

- `package-distribution`：新增「未构建的源码目录不得关闭官方界面」。

## Impact

- 构建与打包：`package.json`、`scripts/build.mjs`、`scripts/build-complete-marker.mjs`、`scripts/build-preview.mjs`、`scripts/windows-remote-common.mjs`、`scripts/windows-remote.mjs`。发布打包（`scripts/package-release.mjs`）已按 `dsh.bundle.patch` 逐项要求文件存在，无需修改。
- 运行时代码、协议、存储不变。
- 文档：`README.md`、`README.en.md`、`doc/usage-details.md`、`doc/usage-details.en.md`。
- 面板：REQ-0140（目标版本 0.9.3）。
- 不在本变更范围：rc.5 启用失败后不回滚已保存选择属于宿主行为；运行时验收失败后的独立可见提示另行评估。
